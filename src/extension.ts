import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ClaudeTreeProvider, ClaudeItemNode } from './providers/ClaudeTreeProvider';
import { MetricsTreeProvider } from './providers/MetricsTreeProvider';
import { MarkdownTreeProvider, MarkdownNode } from './providers/MarkdownTreeProvider';
import { QuickActionsProvider } from './providers/QuickActionsProvider';
import { MetricsDashboard } from './webview/MetricsDashboard';
import { ClaudeCodeService, AgentSuggestion, CommandSuggestion, SkillSuggestion } from './services/ClaudeCodeService';

let quickActionsProvider: QuickActionsProvider;
let markdownProvider: MarkdownTreeProvider;
let agentsProvider: ClaudeTreeProvider;
let commandsProvider: ClaudeTreeProvider;
let skillsProvider: ClaudeTreeProvider;
let metricsProvider: MetricsTreeProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('CC-Agent Manager is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Create tree data providers
    quickActionsProvider = new QuickActionsProvider();
    markdownProvider = new MarkdownTreeProvider(workspaceRoot);
    agentsProvider = new ClaudeTreeProvider(workspaceRoot, 'agent');
    commandsProvider = new ClaudeTreeProvider(workspaceRoot, 'command');
    skillsProvider = new ClaudeTreeProvider(workspaceRoot, 'skill');
    metricsProvider = new MetricsTreeProvider(workspaceRoot);

    // Register tree views
    vscode.window.registerTreeDataProvider('claudeQuickActions', quickActionsProvider);
    vscode.window.registerTreeDataProvider('claudeMarkdownFiles', markdownProvider);
    vscode.window.registerTreeDataProvider('claudeAgents', agentsProvider);
    vscode.window.registerTreeDataProvider('claudeCommands', commandsProvider);
    vscode.window.registerTreeDataProvider('claudeSkills', skillsProvider);
    vscode.window.registerTreeDataProvider('claudeMetrics', metricsProvider);

    // Metrics dashboard instance
    let metricsDashboard: MetricsDashboard | undefined;

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeCodeManager.openMarkdown', (node: MarkdownNode) => {
            openFile(node.resourcePath);
        }),

        vscode.commands.registerCommand('claudeCodeManager.refreshMarkdown', () => {
            markdownProvider.refresh();
        }),

        vscode.commands.registerCommand('claudeCodeManager.openAgent', (node: ClaudeItemNode) => {
            openFile(node.item.filePath);
        }),

        vscode.commands.registerCommand('claudeCodeManager.openCommand', (node: ClaudeItemNode) => {
            openFile(node.item.filePath);
        }),

        vscode.commands.registerCommand('claudeCodeManager.openSkill', (node: ClaudeItemNode) => {
            openFile(node.item.filePath);
        }),

        vscode.commands.registerCommand('claudeCodeManager.createAgent', async () => {
            await createNewItem('agent', workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.createCommand', async () => {
            await createNewItem('command', workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.createSkill', async () => {
            await createNewSkill(workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.deleteItem', async (node: ClaudeItemNode) => {
            await deleteItem(node);
        }),

        vscode.commands.registerCommand('claudeCodeManager.refresh', () => {
            markdownProvider.refresh();
            agentsProvider.refresh();
            commandsProvider.refresh();
            skillsProvider.refresh();
            metricsProvider.refresh();
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
        }),

        vscode.commands.registerCommand('claudeCodeManager.openMetricsDashboard', () => {
            if (!metricsDashboard) {
                metricsDashboard = new MetricsDashboard(workspaceRoot);
            }
            metricsDashboard.show();
        }),

        vscode.commands.registerCommand('claudeCodeManager.suggestCommands', async () => {
            await runSuggestCommands(workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.suggestSkills', async () => {
            await runSuggestSkills(workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.autoGenerate', async () => {
            await runAutoGenerate(workspaceRoot);
        }),

        vscode.commands.registerCommand('claudeCodeManager.updateClaudeMd', async () => {
            await runUpdateClaudeMd(workspaceRoot);
        })
    );

    // Watch for changes in .claude directories
    const watcher = vscode.workspace.createFileSystemWatcher(
        '**/.claude/{agents,commands,skills,agents-disabled,commands-disabled,skills-disabled}/**/*.md'
    );
    watcher.onDidCreate(() => refreshAll());
    watcher.onDidChange(() => refreshAll());
    watcher.onDidDelete(() => refreshAll());
    context.subscriptions.push(watcher);

    // Watch for markdown file changes across the workspace
    const mdWatcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    mdWatcher.onDidCreate(() => markdownProvider.refresh());
    mdWatcher.onDidChange(() => markdownProvider.refresh());
    mdWatcher.onDidDelete(() => markdownProvider.refresh());
    context.subscriptions.push(mdWatcher);
}

function refreshAll() {
    markdownProvider.refresh();
    agentsProvider.refresh();
    commandsProvider.refresh();
    skillsProvider.refresh();
    metricsProvider.refresh();
}

async function runAutoGenerate(workspaceRoot: string | undefined) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    // Step 1: Confirmation
    const confirm = await vscode.window.showWarningMessage(
        'AutoGenerate will create Claude Code structure and use AI to suggest agents, commands, and skills. Proceed?',
        'Yes', 'Cancel'
    );
    if (confirm !== 'Yes') return;

    // Step 2: Model picker
    const modelPick = await vscode.window.showQuickPick([
        { label: '$(zap) Sonnet', description: 'Balanced speed & quality (Recommended)', value: 'sonnet' },
        { label: '$(sparkle) Opus', description: 'Most capable, best analysis', value: 'opus' },
        { label: '$(rocket) Haiku', description: 'Fastest and most economical', value: 'haiku' }
    ], { placeHolder: 'Select model for AI generation' });

    if (!modelPick) return;
    const model = modelPick.value;

    const claude = new ClaudeCodeService(workspaceRoot);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'AutoGenerate',
        cancellable: false
    }, async (progress) => {
        // Step 3: Create dirs (no CLAUDE.md yet)
        progress.report({ message: 'Creating Claude Code project structure...' });

        const dirs = [
            path.join(workspaceRoot, '.claude'),
            path.join(workspaceRoot, '.claude', 'agents'),
            path.join(workspaceRoot, '.claude', 'commands'),
            path.join(workspaceRoot, '.claude', 'skills')
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // Create settings.json if missing
        const settingsPath = path.join(workspaceRoot, '.claude', 'settings.json');
        if (!fs.existsSync(settingsPath)) {
            fs.writeFileSync(settingsPath, JSON.stringify({ permissions: {} }, null, 2));
        }

        refreshAll();

        // Step 4: Check Claude CLI
        progress.report({ message: 'Checking Claude Code CLI...' });
        const available = await claude.isAvailable();

        if (!available) {
            // Fallback: create basic CLAUDE.md template
            const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');
            if (!fs.existsSync(claudeMdPath)) {
                const projectName = path.basename(workspaceRoot);
                const template = `# ${projectName}\n\n## Project Overview\n\nDescribe your project here.\n\n## Key Conventions\n\n- [Add your conventions]\n\n## Architecture\n\n- [Describe your architecture]\n`;
                fs.writeFileSync(claudeMdPath, template);
            }
            vscode.window.showInformationMessage('Project structure created. Install Claude Code CLI to enable AI suggestions.');
            refreshAll();
            return;
        }

        const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
        outputChannel.show();
        claude.setOutputChannel(outputChannel);

        // Step 5: Suggest agents, commands, skills
        progress.report({ message: `Analyzing project for agent suggestions (${model})...` });
        const agentSuggestions = await claude.suggestAgents(model);
        await showAgentSuggestions(agentSuggestions, workspaceRoot);

        progress.report({ message: `Analyzing project for command suggestions (${model})...` });
        const commandSuggestions = await claude.suggestCommands(model);
        await showCommandSuggestions(commandSuggestions, workspaceRoot);

        progress.report({ message: `Analyzing project for skill suggestions (${model})...` });
        const skillSuggestions = await claude.suggestSkills(model);
        await showSkillSuggestions(skillSuggestions, workspaceRoot);

        // Step 6: Generate CLAUDE.md with AI
        progress.report({ message: `Generating CLAUDE.md with AI (${model})...` });
        const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');
        const claudeMdExists = fs.existsSync(claudeMdPath);

        let shouldGenerate = true;
        if (claudeMdExists) {
            const update = await vscode.window.showWarningMessage(
                'CLAUDE.md already exists. Update it with AI-generated content?',
                'Yes', 'No'
            );
            shouldGenerate = update === 'Yes';
        }

        if (shouldGenerate) {
            const generatedMd = await claude.generateClaudeMd(model);
            if (generatedMd) {
                fs.writeFileSync(claudeMdPath, generatedMd);
                openFile(claudeMdPath);
            } else if (!claudeMdExists) {
                // Fallback template if AI generation failed and no file exists
                const projectName = path.basename(workspaceRoot);
                const template = `# ${projectName}\n\n## Project Overview\n\nDescribe your project here.\n\n## Key Conventions\n\n- [Add your conventions]\n\n## Architecture\n\n- [Describe your architecture]\n`;
                fs.writeFileSync(claudeMdPath, template);
            }
        }
    });

    refreshAll();
    vscode.window.showInformationMessage('AutoGenerate complete!');
}

async function runUpdateClaudeMd(workspaceRoot: string | undefined) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    // Confirmation
    const confirm = await vscode.window.showWarningMessage(
        'This will use AI to analyze your project and generate/update CLAUDE.md. Proceed?',
        'Yes', 'Cancel'
    );
    if (confirm !== 'Yes') return;

    // Model picker
    const modelPick = await vscode.window.showQuickPick([
        { label: '$(zap) Sonnet', description: 'Balanced speed & quality (Recommended)', value: 'sonnet' },
        { label: '$(sparkle) Opus', description: 'Most capable, best analysis', value: 'opus' },
        { label: '$(rocket) Haiku', description: 'Fastest and most economical', value: 'haiku' }
    ], { placeHolder: 'Select model for CLAUDE.md generation' });

    if (!modelPick) return;
    const model = modelPick.value;

    const claude = new ClaudeCodeService(workspaceRoot);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Update CLAUDE.md',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Checking Claude Code CLI...' });
        const available = await claude.isAvailable();

        if (!available) {
            vscode.window.showErrorMessage('Claude Code CLI not found. Please install it to use AI features.');
            return;
        }

        const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
        outputChannel.show();
        claude.setOutputChannel(outputChannel);

        progress.report({ message: `Generating CLAUDE.md with AI (${model})...` });
        const generatedMd = await claude.generateClaudeMd(model);

        if (generatedMd) {
            const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');
            fs.writeFileSync(claudeMdPath, generatedMd);
            openFile(claudeMdPath);
            vscode.window.showInformationMessage('CLAUDE.md updated with AI-generated content.');
        } else {
            vscode.window.showErrorMessage('Failed to generate CLAUDE.md. Check Output for details.');
        }
    });

    refreshAll();
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

    const claude = new ClaudeCodeService(workspaceRoot);

    // Show options
    const action = await vscode.window.showQuickPick([
        { label: '$(sync) Update All Agents', description: 'Add project context to all existing agents', value: 'update' },
        { label: '$(lightbulb) Suggest New Agents', description: 'Analyze project and suggest new agents', value: 'suggest' },
        { label: '$(checklist) Both', description: 'Update existing agents and suggest new ones', value: 'both' }
    ], { placeHolder: 'What would you like to do?' });

    if (!action) return;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Auto Context',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Checking Claude Code CLI...' });
        const available = await claude.isAvailable();

        if (!available) {
            vscode.window.showErrorMessage('Claude Code CLI not found. Please install it to use AI features.');
            return;
        }

        if (action.value === 'update' || action.value === 'both') {
            progress.report({ message: 'Claude Code is updating agents...' });
            await updateAllAgentsContext(workspaceRoot, claude);
        }

        if (action.value === 'suggest' || action.value === 'both') {
            progress.report({ message: 'Claude Code is analyzing project...' });
            const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
            outputChannel.show();
            claude.setOutputChannel(outputChannel);
            const suggestions = await claude.suggestAgents();
            await showAgentSuggestions(suggestions, workspaceRoot);
        }
    });

    agentsProvider.refresh();
}

async function updateAllAgentsContext(workspaceRoot: string, claude: ClaudeCodeService) {
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

    // Ask which agents to update
    const selected = await vscode.window.showQuickPick(
        agentFiles.map(f => ({ label: f.replace('.md', ''), picked: true })),
        {
            canPickMany: true,
            placeHolder: 'Select agents to update with project context'
        }
    );

    if (!selected || selected.length === 0) return;

    // Create output channel for live progress
    const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
    outputChannel.show();
    outputChannel.appendLine('=== Auto Context Update ===\n');

    claude.setOutputChannel(outputChannel);

    const results: { name: string; success: boolean; method: string; error?: string }[] = [];

    for (let i = 0; i < selected.length; i++) {
        const agent = selected[i];
        const agentPath = path.join(agentsDir, `${agent.label}.md`);
        const progress = `[${i + 1}/${selected.length}]`;

        outputChannel.appendLine(`${progress} Updating: ${agent.label}...`);
        outputChannel.appendLine(`    -> Sending to Claude Code...`);

        const result = await claude.updateAgentContext(agentPath);
        results.push({ name: agent.label, ...result });

        if (result.success) {
            outputChannel.appendLine(`    -> Done: ${result.method}`);
        } else {
            outputChannel.appendLine(`    -> Failed: ${result.error || 'Unknown error'}`);
        }
        outputChannel.appendLine('');
    }

    // Show summary
    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    outputChannel.appendLine('=== Summary ===\n');
    outputChannel.appendLine(`Total: ${results.length} | Success: ${succeeded.length} | Failed: ${failed.length}\n`);

    for (const r of succeeded) {
        outputChannel.appendLine(`[OK] ${r.name} (${r.method})`);
    }
    for (const r of failed) {
        outputChannel.appendLine(`[FAILED] ${r.name}: ${r.error || 'Unknown error'}`);
    }

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

    const claude = new ClaudeCodeService(workspaceRoot);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Updating agent context...',
        cancellable: false
    }, async () => {
        const available = await claude.isAvailable();
        if (!available) {
            vscode.window.showErrorMessage('Claude Code CLI not found. Please install it to use AI features.');
            return;
        }

        const result = await claude.updateAgentContext(node.item.filePath);

        if (result.success) {
            vscode.window.showInformationMessage(`Updated "${node.item.name}" with project context.`);
            openFile(node.item.filePath);
        } else {
            vscode.window.showErrorMessage(`Failed to update "${node.item.name}": ${result.error || 'Unknown error'}`);
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

    if (createdAgents.length > 0) {
        const agentList = createdAgents.join(', ');
        vscode.window.showInformationMessage(`Created ${createdAgents.length} agent(s): ${agentList}`);
        agentsProvider.refresh();
        openFile(path.join(agentsDir, `${createdAgents[0]}.md`));
    }

    if (skippedAgents.length > 0 && createdAgents.length === 0) {
        vscode.window.showInformationMessage('No agents were created.');
    }
}

async function runSuggestCommands(workspaceRoot: string | undefined) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    const claude = new ClaudeCodeService(workspaceRoot);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Suggest Commands',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Checking Claude Code CLI...' });
        const available = await claude.isAvailable();

        if (!available) {
            vscode.window.showErrorMessage('Claude Code CLI not found. Please install it to use AI features.');
            return;
        }

        progress.report({ message: 'Claude Code is analyzing project...' });
        const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
        outputChannel.show();
        claude.setOutputChannel(outputChannel);
        const suggestions = await claude.suggestCommands();
        await showCommandSuggestions(suggestions, workspaceRoot);
    });

    commandsProvider.refresh();
}

async function showCommandSuggestions(suggestions: CommandSuggestion[], workspaceRoot: string) {
    if (suggestions.length === 0) {
        vscode.window.showInformationMessage('No command suggestions based on project analysis.');
        return;
    }

    const items = suggestions.map(s => ({
        label: `$(terminal) ${s.name}`,
        description: s.description,
        detail: s.reason,
        suggestion: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select commands to create'
    });

    if (!selected || selected.length === 0) return;

    const commandsDir = path.join(workspaceRoot, '.claude', 'commands');
    if (!fs.existsSync(commandsDir)) {
        fs.mkdirSync(commandsDir, { recursive: true });
    }

    const created: string[] = [];

    for (const item of selected) {
        const filePath = path.join(commandsDir, `${item.suggestion.name}.md`);

        if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `Command "${item.suggestion.name}" already exists. Overwrite?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') continue;
        }

        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(item.suggestion.template));
        created.push(item.suggestion.name);
    }

    if (created.length > 0) {
        vscode.window.showInformationMessage(`Created ${created.length} command(s): ${created.join(', ')}`);
        commandsProvider.refresh();
        openFile(path.join(commandsDir, `${created[0]}.md`));
    }
}

async function runSuggestSkills(workspaceRoot: string | undefined) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    const claude = new ClaudeCodeService(workspaceRoot);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Suggest Skills',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Checking Claude Code CLI...' });
        const available = await claude.isAvailable();

        if (!available) {
            vscode.window.showErrorMessage('Claude Code CLI not found. Please install it to use AI features.');
            return;
        }

        progress.report({ message: 'Claude Code is analyzing project...' });
        const outputChannel = vscode.window.createOutputChannel('CC Agent Manager');
        outputChannel.show();
        claude.setOutputChannel(outputChannel);
        const suggestions = await claude.suggestSkills();
        await showSkillSuggestions(suggestions, workspaceRoot);
    });

    skillsProvider.refresh();
}

async function showSkillSuggestions(suggestions: SkillSuggestion[], workspaceRoot: string) {
    if (suggestions.length === 0) {
        vscode.window.showInformationMessage('No skill suggestions based on project analysis.');
        return;
    }

    const items = suggestions.map(s => ({
        label: `$(symbol-method) ${s.name}`,
        description: s.description,
        detail: s.reason,
        suggestion: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select skills to create'
    });

    if (!selected || selected.length === 0) return;

    const skillsBase = path.join(workspaceRoot, '.claude', 'skills');
    if (!fs.existsSync(skillsBase)) {
        fs.mkdirSync(skillsBase, { recursive: true });
    }

    const created: string[] = [];

    for (const item of selected) {
        const skillDir = path.join(skillsBase, item.suggestion.name);
        const filePath = path.join(skillDir, 'SKILL.md');

        if (fs.existsSync(skillDir)) {
            const overwrite = await vscode.window.showWarningMessage(
                `Skill "${item.suggestion.name}" already exists. Overwrite?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') continue;
        }

        fs.mkdirSync(skillDir, { recursive: true });
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(item.suggestion.template));
        created.push(item.suggestion.name);
    }

    if (created.length > 0) {
        vscode.window.showInformationMessage(`Created ${created.length} skill(s): ${created.join(', ')}`);
        skillsProvider.refresh();
        openFile(path.join(skillsBase, created[0], 'SKILL.md'));
    }
}

async function toggleItemState(node: ClaudeItemNode, enable: boolean) {
    const item = node.item;

    if (item.type === 'skill') {
        const skillDir = path.dirname(item.filePath);
        const skillName = path.basename(skillDir);
        const baseDir = path.dirname(path.dirname(skillDir));
        const targetFolder = enable ? 'skills' : 'skills-disabled';
        const targetDir = path.join(baseDir, targetFolder, skillName);

        if (!fs.existsSync(path.join(baseDir, targetFolder))) {
            fs.mkdirSync(path.join(baseDir, targetFolder), { recursive: true });
        }

        if (fs.existsSync(targetDir)) {
            vscode.window.showErrorMessage(`A skill with this name already exists in the ${enable ? 'enabled' : 'disabled'} folder.`);
            return;
        }

        try {
            const sourceUri = vscode.Uri.file(skillDir);
            const targetUri = vscode.Uri.file(targetDir);
            await vscode.workspace.fs.rename(sourceUri, targetUri);

            const action = enable ? 'Enabled' : 'Disabled';
            vscode.window.showInformationMessage(`${action} skill: ${item.name}`);
            refreshAll();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to ${enable ? 'enable' : 'disable'}: ${error}`);
        }
        return;
    }

    const currentDir = path.dirname(item.filePath);
    const fileName = path.basename(item.filePath);
    const baseDir = path.dirname(currentDir);

    let targetFolder: string;
    if (item.type === 'agent') {
        targetFolder = enable ? 'agents' : 'agents-disabled';
    } else {
        targetFolder = enable ? 'commands' : 'commands-disabled';
    }

    const targetDir = path.join(baseDir, targetFolder);
    const targetPath = path.join(targetDir, fileName);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(targetPath)) {
        vscode.window.showErrorMessage(`A ${item.type} with this name already exists in the ${enable ? 'enabled' : 'disabled'} folder.`);
        return;
    }

    try {
        const sourceUri = vscode.Uri.file(item.filePath);
        const targetUri = vscode.Uri.file(targetPath);
        await vscode.workspace.fs.rename(sourceUri, targetUri);

        const action = enable ? 'Enabled' : 'Disabled';
        vscode.window.showInformationMessage(`${action} ${item.type}: ${item.name}`);
        refreshAll();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to ${enable ? 'enable' : 'disable'}: ${error}`);
    }
}

async function createNewItem(type: 'agent' | 'command', workspaceRoot: string | undefined) {
    const location = await vscode.window.showQuickPick(
        [
            { label: 'Project', description: 'Create in .claude folder of current workspace', value: 'project' },
            { label: 'Global', description: 'Create in ~/.claude folder (available everywhere)', value: 'global' }
        ],
        { placeHolder: `Where do you want to create the ${type}?` }
    );

    if (!location) return;

    if (location.value === 'project' && !workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first or choose Global location.');
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: `Enter the ${type} name (without .md extension)`,
        placeHolder: type === 'agent' ? 'my-agent' : 'my-command',
        validateInput: (value) => {
            if (!value) return 'Name is required';
            if (!/^[a-z0-9-]+$/.test(value)) return 'Name should only contain lowercase letters, numbers, and hyphens';
            return null;
        }
    });

    if (!name) return;

    const basePath = location.value === 'global'
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude')
        : path.join(workspaceRoot!, '.claude');

    const folder = type === 'agent' ? 'agents' : 'commands';
    const dirPath = path.join(basePath, folder);
    const filePath = path.join(dirPath, `${name}.md`);

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`A ${type} with this name already exists.`);
        return;
    }

    const template = type === 'agent' ? getAgentTemplate(name) : getCommandTemplate(name);
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(template));

    openFile(filePath);
    refreshAll();
    vscode.window.showInformationMessage(`Created new ${type}: ${name}`);
}

async function createNewSkill(workspaceRoot: string | undefined) {
    const location = await vscode.window.showQuickPick(
        [
            { label: 'Project', description: 'Create in .claude/skills of current workspace', value: 'project' },
            { label: 'Global', description: 'Create in ~/.claude/skills (available everywhere)', value: 'global' }
        ],
        { placeHolder: 'Where do you want to create the skill?' }
    );

    if (!location) return;

    if (location.value === 'project' && !workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first or choose Global location.');
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: 'Enter the skill name',
        placeHolder: 'my-skill',
        validateInput: (value) => {
            if (!value) return 'Name is required';
            if (!/^[a-z0-9-]+$/.test(value)) return 'Name should only contain lowercase letters, numbers, and hyphens';
            return null;
        }
    });

    if (!name) return;

    const basePath = location.value === 'global'
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude')
        : path.join(workspaceRoot!, '.claude');

    const skillDir = path.join(basePath, 'skills', name);
    const filePath = path.join(skillDir, 'SKILL.md');

    if (fs.existsSync(skillDir)) {
        vscode.window.showErrorMessage(`A skill with this name already exists.`);
        return;
    }

    fs.mkdirSync(skillDir, { recursive: true });

    const template = getSkillTemplate(name);
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(template));

    openFile(filePath);
    refreshAll();
    vscode.window.showInformationMessage(`Created new skill: ${name}`);
}

function getAgentTemplate(name: string): string {
    return `---
name: ${name}
description: Description of what this agent does and when to use it
model: sonnet
# tools: [Bash, Read, Write]
# permissionMode: default
# maxTurns: 10
# skills: []
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

function getSkillTemplate(name: string): string {
    return `---
name: ${name}
description: What this skill does
argument-hint: "[args]"
user-invocable: true
model: sonnet
---

Instructions for the skill...
`;
}

async function deleteItem(node: ClaudeItemNode) {
    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete "${node.item.name}"?`,
        { modal: true },
        'Delete'
    );

    if (confirm !== 'Delete') return;

    try {
        if (node.item.type === 'skill') {
            const skillDir = path.dirname(node.item.filePath);
            const uri = vscode.Uri.file(skillDir);
            await vscode.workspace.fs.delete(uri, { recursive: true });
        } else {
            const uri = vscode.Uri.file(node.item.filePath);
            await vscode.workspace.fs.delete(uri);
        }

        vscode.window.showInformationMessage(`Deleted ${node.item.type}: ${node.item.name}`);
        refreshAll();
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

    const content = fs.readFileSync(node.item.filePath, 'utf-8');
    const currentModelMatch = content.match(/model:\s*["']?([^"'\n]+)["']?/);
    const currentModel = currentModelMatch ? currentModelMatch[1].trim() : 'sonnet';

    const items = models.map(m => ({
        ...m,
        description: m.value === currentModel ? `${m.description} (current)` : m.description
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select model for "${node.item.name}" (current: ${currentModel})`
    });

    if (!selected || selected.value === currentModel) return;

    try {
        let newContent: string;

        if (currentModelMatch) {
            newContent = content.replace(
                /model:\s*["']?[^"'\n]+["']?/,
                `model: ${selected.value}`
            );
        } else {
            const frontmatterMatch = content.match(/^(---\n[\s\S]*?)(---)/);
            if (frontmatterMatch) {
                newContent = content.replace(
                    /^(---\n[\s\S]*?)(---)/,
                    `$1model: ${selected.value}\n$2`
                );
            } else {
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
