import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ClaudeTreeProvider, ClaudeItemNode } from './providers/ClaudeTreeProvider';
import { AutoContextService, AgentSuggestion } from './services/AutoContextService';

let agentsProvider: ClaudeTreeProvider;
let commandsProvider: ClaudeTreeProvider;

/**
 * Check if user has accepted skip permissions, or ask them
 * Returns true if accepted, false if declined
 */
async function ensureSkipPermissionsAccepted(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('ccAgentManager');
    const alreadyAsked = config.get<boolean>('skipPermissionPromptsAsked', false);
    const skipEnabled = config.get<boolean>('skipPermissionPrompts', false);

    // If already asked and accepted, return true
    if (alreadyAsked && skipEnabled) {
        return true;
    }

    // If already asked and declined, return false
    if (alreadyAsked && !skipEnabled) {
        return false;
    }

    // First time: show explanation dialog
    const result = await vscode.window.showInformationMessage(
        'Auto Context uses Claude Code to generate agent prompts. ' +
        'For non-interactive execution, it needs to skip permission prompts. ' +
        'This only reads project files (README.md, CLAUDE.md, etc.) to generate context.\n\n' +
        'Allow skipping permission prompts?',
        { modal: true },
        'Allow',
        'Deny'
    );

    // Save the decision
    const accepted = result === 'Allow';
    await config.update('skipPermissionPromptsAsked', true, vscode.ConfigurationTarget.Global);
    await config.update('skipPermissionPrompts', accepted, vscode.ConfigurationTarget.Global);

    if (!accepted) {
        vscode.window.showWarningMessage(
            'Auto Context will run without skip-permissions flag. ' +
            'This may cause timeouts if Claude Code waits for interactive prompts. ' +
            'You can change this in Settings > CC-Agent Manager.'
        );
    }

    return accepted;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CC-Agent Manager is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Create tree data providers
    agentsProvider = new ClaudeTreeProvider(workspaceRoot, 'agent');
    commandsProvider = new ClaudeTreeProvider(workspaceRoot, 'command');

    // Register tree views
    vscode.window.registerTreeDataProvider('claudeAgents', agentsProvider);
    vscode.window.registerTreeDataProvider('claudeCommands', commandsProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeCodeManager.openAgent', (node: ClaudeItemNode) => {
            openFile(node.item.filePath);
        }),

        vscode.commands.registerCommand('claudeCodeManager.openCommand', (node: ClaudeItemNode) => {
            openFile(node.item.filePath);
        }),

        vscode.commands.registerCommand('claudeCodeManager.createAgent', async () => {
            await createNewItem('agent', workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.createCommand', async () => {
            await createNewItem('command', workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.deleteItem', async (node: ClaudeItemNode) => {
            await deleteItem(node);
        }),

        vscode.commands.registerCommand('claudeCodeManager.refresh', () => {
            agentsProvider.refresh();
            commandsProvider.refresh();
        }),

        vscode.commands.registerCommand('claudeCodeManager.enableItem', async (node: ClaudeItemNode) => {
            await toggleItemState(node, true);
        }),

        vscode.commands.registerCommand('claudeCodeManager.disableItem', async (node: ClaudeItemNode) => {
            await toggleItemState(node, false);
        }),

        vscode.commands.registerCommand('claudeCodeManager.autoContext', async () => {
            await runAutoContext(workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.updateAgentContext', async (node: ClaudeItemNode) => {
            await updateSingleAgentContext(node, workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.changeModel', async (node: ClaudeItemNode) => {
            await changeAgentModel(node);
        })
    );

    // Watch for changes in .claude directories (including disabled folders)
    const watcher = vscode.workspace.createFileSystemWatcher('**/.claude/{agents,commands,agents-disabled,commands-disabled}/**/*.md');
    watcher.onDidCreate(() => {
        agentsProvider.refresh();
        commandsProvider.refresh();
    });
    watcher.onDidChange(() => {
        agentsProvider.refresh();
        commandsProvider.refresh();
    });
    watcher.onDidDelete(() => {
        agentsProvider.refresh();
        commandsProvider.refresh();
    });
    context.subscriptions.push(watcher);
}

function openFile(filePath: string) {
    const uri = vscode.Uri.file(filePath);
    vscode.window.showTextDocument(uri);
}

async function runAutoContext(workspaceRoot: string | undefined) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    const autoContext = new AutoContextService(workspaceRoot);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Auto Context',
        cancellable: false
    }, async (progress) => {
        // Check Claude Code availability
        progress.report({ message: 'Checking Claude Code CLI...' });
        const claudeAvailable = await autoContext.checkClaudeAvailability();

        if (!claudeAvailable) {
            vscode.window.showWarningMessage('Claude Code CLI not found. Install it for AI-powered features. Using static analysis as fallback.');
        }

        // Scan markdown files
        progress.report({ message: 'Scanning project files...' });
        const files = await autoContext.scanMarkdownFiles();

        if (files.length === 0) {
            vscode.window.showWarningMessage('No markdown files found in the project.');
            return;
        }

        // Show options
        const action = await vscode.window.showQuickPick([
            { label: '$(sync) Update All Agents', description: 'Add project context to all existing agents', value: 'update' },
            { label: '$(lightbulb) Suggest New Agents', description: 'Analyze project and suggest new agents', value: 'suggest' },
            { label: '$(checklist) Both', description: 'Update existing agents and suggest new ones', value: 'both' }
        ], { placeHolder: 'What would you like to do?' });

        if (!action) return;

        if (action.value === 'update' || action.value === 'both') {
            progress.report({ message: claudeAvailable ? 'Claude Code is updating agents...' : 'Updating agents...' });
            await updateAllAgentsContext(workspaceRoot, autoContext, files, claudeAvailable);
        }

        if (action.value === 'suggest' || action.value === 'both') {
            progress.report({ message: claudeAvailable ? 'Claude Code is analyzing project...' : 'Analyzing project...' });
            const suggestions = claudeAvailable
                ? await autoContext.suggestAgentsWithAI(files)
                : autoContext.suggestAgents(files);
            await showAgentSuggestions(suggestions, workspaceRoot);
        }
    });

    agentsProvider.refresh();
}

async function updateAllAgentsContext(workspaceRoot: string, autoContext: AutoContextService, files: ReturnType<typeof autoContext.scanMarkdownFiles> extends Promise<infer T> ? T : never, useAI: boolean) {
    const agentsDir = path.join(workspaceRoot, '.claude', 'agents');

    if (!fs.existsSync(agentsDir)) {
        vscode.window.showWarningMessage('No agents folder found. Create some agents first.');
        return;
    }

    const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));

    if (agentFiles.length === 0) {
        vscode.window.showWarningMessage('No agents found to update.');
        return;
    }

    // If using AI, check/request skip permissions
    if (useAI) {
        const skipPermissions = await ensureSkipPermissionsAccepted();
        autoContext.setSkipPermissions(skipPermissions);
    }

    // Ask which agents to update
    const selected = await vscode.window.showQuickPick(
        agentFiles.map(f => ({ label: f.replace('.md', ''), picked: true })),
        {
            canPickMany: true,
            placeHolder: 'Select agents to update with project context'
        }
    );

    if (!selected || selected.length === 0) return;

    const results: { name: string; success: boolean; method: string; error?: string }[] = [];

    // Create output channel for live progress
    const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
    outputChannel.show();
    outputChannel.appendLine('=== Auto Context Update ===\n');

    // Pass output channel to service for live logging
    autoContext.setOutputChannel(outputChannel);

    // Show what files will be read
    const projectFiles = autoContext.getReadableProjectFiles();
    outputChannel.appendLine('Reading project files:');
    for (const file of projectFiles) {
        outputChannel.appendLine(`  - ${file}`);
    }
    outputChannel.appendLine('');

    // Process each agent with progress updates
    for (let i = 0; i < selected.length; i++) {
        const agent = selected[i];
        const agentPath = path.join(agentsDir, `${agent.label}.md`);
        const progress = `[${i + 1}/${selected.length}]`;

        outputChannel.appendLine(`${progress} Updating: ${agent.label}...`);

        if (useAI) {
            outputChannel.appendLine(`    -> Sending to Claude Code...`);
            const result = await autoContext.updateAgentWithContextAI(agentPath, files);
            results.push({
                name: agent.label,
                success: result.success,
                method: result.method,
                error: result.error
            });

            if (result.success) {
                outputChannel.appendLine(`    -> Done: ${result.method}`);
            } else {
                outputChannel.appendLine(`    -> Failed: ${result.error || 'Unknown error'}`);
            }
        } else {
            const success = await autoContext.updateAgentWithContext(agentPath, files);
            results.push({
                name: agent.label,
                success,
                method: 'static analysis'
            });
            outputChannel.appendLine(`    -> Done: static analysis`);
        }
        outputChannel.appendLine('');
    }

    // Show summary
    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    outputChannel.appendLine('=== Summary ===\n');
    outputChannel.appendLine(`Total: ${results.length} | Success: ${succeeded.length} | Failed: ${failed.length}\n`);

    for (const r of succeeded) {
        outputChannel.appendLine(`[OK] ${r.name}`);
        outputChannel.appendLine(`     Method: ${r.method}`);
    }
    for (const r of failed) {
        outputChannel.appendLine(`[FAILED] ${r.name}`);
        outputChannel.appendLine(`     Error: ${r.error || 'Unknown error'}`);
    }

    // Show notification
    if (succeeded.length > 0) {
        vscode.window.showInformationMessage(`Updated ${succeeded.length} agent(s). Check Output for details.`);
    }

    if (failed.length > 0) {
        vscode.window.showErrorMessage(`Failed ${failed.length} agent(s). Check Output for details.`);
    }
}

async function updateSingleAgentContext(node: ClaudeItemNode, workspaceRoot: string | undefined) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const autoContext = new AutoContextService(workspaceRoot);

    // Check Claude availability and permissions
    const claudeAvailable = await autoContext.checkClaudeAvailability();
    if (claudeAvailable) {
        const skipPermissions = await ensureSkipPermissionsAccepted();
        autoContext.setSkipPermissions(skipPermissions);
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Updating agent context...',
        cancellable: false
    }, async () => {
        const files = await autoContext.scanMarkdownFiles();

        // Use AI if available
        let success: boolean;
        if (claudeAvailable) {
            const result = await autoContext.updateAgentWithContextAI(node.item.filePath, files);
            success = result.success;
        } else {
            success = await autoContext.updateAgentWithContext(node.item.filePath, files);
        }

        if (success) {
            vscode.window.showInformationMessage(`Updated "${node.item.name}" with project context.`);
            // Open the file to show changes
            openFile(node.item.filePath);
        } else {
            vscode.window.showErrorMessage(`Failed to update "${node.item.name}".`);
        }
    });
}

async function showAgentSuggestions(suggestions: AgentSuggestion[], workspaceRoot: string) {
    if (suggestions.length === 0) {
        vscode.window.showInformationMessage('No agent suggestions based on project analysis.');
        return;
    }

    const items = suggestions.map(s => ({
        label: `$(robot) ${s.name}`,
        description: s.description,
        detail: s.reason,
        suggestion: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select agents to create'
    });

    if (!selected || selected.length === 0) return;

    const agentsDir = path.join(workspaceRoot, '.claude', 'agents');
    if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true });
    }

    const createdAgents: string[] = [];
    const skippedAgents: string[] = [];

    for (const item of selected) {
        const filePath = path.join(agentsDir, `${item.suggestion.name}.md`);

        if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `Agent "${item.suggestion.name}" already exists. Overwrite?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') {
                skippedAgents.push(item.suggestion.name);
                continue;
            }
        }

        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(item.suggestion.template));
        createdAgents.push(item.suggestion.name);
    }

    // Show detailed result
    if (createdAgents.length > 0) {
        const agentList = createdAgents.join(', ');
        vscode.window.showInformationMessage(`Created ${createdAgents.length} agent(s): ${agentList}`);
        agentsProvider.refresh();

        // Open the first created agent
        const firstAgent = path.join(agentsDir, `${createdAgents[0]}.md`);
        openFile(firstAgent);
    }

    if (skippedAgents.length > 0 && createdAgents.length === 0) {
        vscode.window.showInformationMessage('No agents were created.');
    }
}

async function toggleItemState(node: ClaudeItemNode, enable: boolean) {
    const item = node.item;
    const currentDir = path.dirname(item.filePath);
    const fileName = path.basename(item.filePath);
    const baseDir = path.dirname(currentDir);

    // Determine source and target folders
    let targetFolder: string;
    if (item.type === 'agent') {
        targetFolder = enable ? 'agents' : 'agents-disabled';
    } else {
        targetFolder = enable ? 'commands' : 'commands-disabled';
    }

    const targetDir = path.join(baseDir, targetFolder);
    const targetPath = path.join(targetDir, fileName);

    // Create target directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // Check if target file already exists
    if (fs.existsSync(targetPath)) {
        vscode.window.showErrorMessage(`A ${item.type} with this name already exists in the ${enable ? 'enabled' : 'disabled'} folder.`);
        return;
    }

    try {
        // Move the file using VS Code API
        const sourceUri = vscode.Uri.file(item.filePath);
        const targetUri = vscode.Uri.file(targetPath);
        await vscode.workspace.fs.rename(sourceUri, targetUri);

        const action = enable ? 'Enabled' : 'Disabled';
        vscode.window.showInformationMessage(`${action} ${item.type}: ${item.name}`);

        // Refresh views
        agentsProvider.refresh();
        commandsProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to ${enable ? 'enable' : 'disable'}: ${error}`);
    }
}

async function createNewItem(type: 'agent' | 'command', workspaceRoot: string | undefined) {
    // Ask for location
    const location = await vscode.window.showQuickPick(
        [
            { label: 'Project', description: 'Create in .claude folder of current workspace', value: 'project' },
            { label: 'Global', description: 'Create in ~/.claude folder (available everywhere)', value: 'global' }
        ],
        { placeHolder: `Where do you want to create the ${type}?` }
    );

    if (!location) {
        return;
    }

    if (location.value === 'project' && !workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first or choose Global location.');
        return;
    }

    // Ask for name
    const name = await vscode.window.showInputBox({
        prompt: `Enter the ${type} name (without .md extension)`,
        placeHolder: type === 'agent' ? 'my-agent' : 'my-command',
        validateInput: (value) => {
            if (!value) {
                return 'Name is required';
            }
            if (!/^[a-z0-9-]+$/.test(value)) {
                return 'Name should only contain lowercase letters, numbers, and hyphens';
            }
            return null;
        }
    });

    if (!name) {
        return;
    }

    // Determine base path
    const basePath = location.value === 'global'
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude')
        : path.join(workspaceRoot!, '.claude');

    const folder = type === 'agent' ? 'agents' : 'commands';
    const dirPath = path.join(basePath, folder);
    const filePath = path.join(dirPath, `${name}.md`);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    // Check if file already exists
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`A ${type} with this name already exists.`);
        return;
    }

    // Create file with template
    const template = type === 'agent' ? getAgentTemplate(name) : getCommandTemplate(name);
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(template));

    // Open the file
    openFile(filePath);

    // Refresh views
    agentsProvider.refresh();
    commandsProvider.refresh();

    vscode.window.showInformationMessage(`Created new ${type}: ${name}`);
}

function getAgentTemplate(name: string): string {
    return `---
name: ${name}
description: Description of what this agent does and when to use it
model: sonnet
---

You are a specialized agent for [describe purpose].

## Your Responsibilities

- [List main responsibilities]

## Guidelines

- [Add specific guidelines]

## Constraints

- [Add any constraints or limitations]
`;
}

function getCommandTemplate(name: string): string {
    return `---
description: Description of what this command does
---

# ${name} Command

[Describe what this command should do]

## Instructions

When invoked, you should:

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Arguments

Use \$ARGUMENTS to access all arguments passed to this command.
Use \$1, \$2, etc. for specific positional arguments.
`;
}

async function deleteItem(node: ClaudeItemNode) {
    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete "${node.item.name}"?`,
        { modal: true },
        'Delete'
    );

    if (confirm !== 'Delete') {
        return;
    }

    try {
        const uri = vscode.Uri.file(node.item.filePath);
        await vscode.workspace.fs.delete(uri);
        vscode.window.showInformationMessage(`Deleted ${node.item.type}: ${node.item.name}`);
        agentsProvider.refresh();
        commandsProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete: ${error}`);
    }
}

async function changeAgentModel(node: ClaudeItemNode) {
    const models = [
        { label: '$(sparkle) Opus', description: 'Most capable, best for complex tasks', value: 'opus' },
        { label: '$(zap) Sonnet', description: 'Balanced performance and speed', value: 'sonnet' },
        { label: '$(rocket) Haiku', description: 'Fastest, best for simple tasks', value: 'haiku' }
    ];

    // Read current model from file
    const content = fs.readFileSync(node.item.filePath, 'utf-8');
    const currentModelMatch = content.match(/model:\s*["']?([^"'\n]+)["']?/);
    const currentModel = currentModelMatch ? currentModelMatch[1].trim() : 'sonnet';

    // Mark current model
    const items = models.map(m => ({
        ...m,
        description: m.value === currentModel ? `${m.description} (current)` : m.description
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select model for "${node.item.name}" (current: ${currentModel})`
    });

    if (!selected || selected.value === currentModel) {
        return;
    }

    try {
        let newContent: string;

        if (currentModelMatch) {
            // Replace existing model
            newContent = content.replace(
                /model:\s*["']?[^"'\n]+["']?/,
                `model: ${selected.value}`
            );
        } else {
            // Add model to frontmatter
            const frontmatterMatch = content.match(/^(---\n[\s\S]*?)(---)/);
            if (frontmatterMatch) {
                newContent = content.replace(
                    /^(---\n[\s\S]*?)(---)/,
                    `$1model: ${selected.value}\n$2`
                );
            } else {
                // No frontmatter, add it
                newContent = `---\nmodel: ${selected.value}\n---\n\n${content}`;
            }
        }

        const uri = vscode.Uri.file(node.item.filePath);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent));
        vscode.window.showInformationMessage(`Changed "${node.item.name}" model to ${selected.value}`);
        agentsProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to change model: ${error}`);
    }
}

export function deactivate() {}
