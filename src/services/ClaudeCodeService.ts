import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ClaudeResponse {
    success: boolean;
    content: string;
    error?: string;
}

export interface AgentSuggestion {
    name: string;
    description: string;
    reason: string;
    template: string;
}

export interface CommandSuggestion {
    name: string;
    description: string;
    reason: string;
    template: string;
}

export interface SkillSuggestion {
    name: string;
    description: string;
    reason: string;
    template: string;
}

export class ClaudeCodeService {
    private outputChannel: any = null;

    constructor(private workspaceRoot: string) {}

    setOutputChannel(channel: any) {
        this.outputChannel = channel;
    }

    private log(message: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    /**
     * Check if Claude Code CLI is available
     */
    async isAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('claude', ['--version'], { shell: true });

            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));

            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000);
        });
    }

    /**
     * Execute a prompt using Claude Code CLI
     * Always uses --dangerously-skip-permissions (Claude Code is required)
     */
    async execute(prompt: string, options?: {
        timeout?: number;
        model?: string;
    }): Promise<ClaudeResponse> {
        const timeout = options?.timeout || 300000;
        const model = options?.model || 'sonnet';

        return new Promise((resolve) => {
            const args = [
                '-p',
                '--model', model,
                '--dangerously-skip-permissions'
            ];

            this.log(`    [Claude] Starting process (model: ${model})...`);
            this.log(`    [Claude] Prompt length: ${prompt.length} chars`);

            const startTime = Date.now();

            const home = process.env.HOME || process.env.USERPROFILE || '';
            const claudePath = `${home}/.local/bin/claude`;

            const proc = spawn(claudePath, args, {
                cwd: this.workspaceRoot,
                env: { ...process.env },
                shell: false
            });

            proc.stdin.write(prompt);
            proc.stdin.end();

            const waitingInterval = setInterval(() => {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                this.log(`    [Claude] Waiting... ${elapsed}s elapsed`);
            }, 10000);

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                if (this.outputChannel && chunk.trim()) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    this.log(`    [Claude ${elapsed}s] Receiving response...`);
                }
            });

            proc.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                if (this.outputChannel && chunk.trim()) {
                    this.log(`    [Claude ERR] ${chunk.trim()}`);
                }
            });

            const timeoutId = setTimeout(() => {
                clearInterval(waitingInterval);
                this.log(`    [Claude] TIMEOUT after ${timeout / 1000}s - killing process`);
                proc.kill();
                resolve({
                    success: false,
                    content: stdout,
                    error: `Timeout after ${timeout / 1000}s. Partial output: ${stdout.substring(0, 200)}`
                });
            }, timeout);

            proc.on('close', (code) => {
                clearInterval(waitingInterval);
                clearTimeout(timeoutId);
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                this.log(`    [Claude] Process ended with code ${code} (${elapsed}s)`);
                if (code === 0) {
                    resolve({ success: true, content: stdout.trim() });
                } else {
                    resolve({
                        success: false,
                        content: stdout.trim(),
                        error: stderr || `Process exited with code ${code}`
                    });
                }
            });

            proc.on('error', (err) => {
                clearInterval(waitingInterval);
                clearTimeout(timeoutId);
                this.log(`    [Claude] ERROR: ${err.message}`);
                resolve({
                    success: false,
                    content: '',
                    error: `Failed to execute Claude Code: ${err.message}. Make sure 'claude' CLI is installed.`
                });
            });
        });
    }

    /**
     * Read key project files to provide context (limited to ~8000 chars total)
     */
    getProjectContext(): string {
        const contextParts: string[] = [];
        const MAX_FILE_SIZE = 2000;
        const MAX_TOTAL = 8000;
        let totalChars = 0;

        const claudePath = path.join(this.workspaceRoot, 'CLAUDE.md');
        if (fs.existsSync(claudePath) && totalChars < MAX_TOTAL) {
            const content = fs.readFileSync(claudePath, 'utf-8');
            const trimmed = content.substring(0, MAX_FILE_SIZE);
            contextParts.push(`## CLAUDE.md\n${trimmed}`);
            totalChars += trimmed.length;
        }

        const readmePath = path.join(this.workspaceRoot, 'README.md');
        if (fs.existsSync(readmePath) && totalChars < MAX_TOTAL) {
            const content = fs.readFileSync(readmePath, 'utf-8');
            const remaining = Math.min(MAX_FILE_SIZE, MAX_TOTAL - totalChars);
            const trimmed = content.substring(0, remaining);
            contextParts.push(`## README.md\n${trimmed}`);
            totalChars += trimmed.length;
        }

        const packagePath = path.join(this.workspaceRoot, 'package.json');
        if (fs.existsSync(packagePath) && totalChars < MAX_TOTAL) {
            try {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
                const summary = JSON.stringify({
                    name: pkg.name,
                    description: pkg.description,
                    scripts: pkg.scripts,
                    dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : [],
                    devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies) : []
                }, null, 2);
                contextParts.push(`## package.json\n${summary}`);
                totalChars += summary.length;
            } catch { /* skip */ }
        }

        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        if (fs.existsSync(pyprojectPath) && totalChars < MAX_TOTAL) {
            const content = fs.readFileSync(pyprojectPath, 'utf-8');
            const remaining = Math.min(1000, MAX_TOTAL - totalChars);
            const trimmed = content.substring(0, remaining);
            contextParts.push(`## pyproject.toml\n${trimmed}`);
            totalChars += trimmed.length;
        }

        if (totalChars < MAX_TOTAL) {
            const structure = this.getDirectoryStructure(this.workspaceRoot, 0, 2);
            const remaining = Math.min(1000, MAX_TOTAL - totalChars);
            contextParts.push(`## Structure\n${structure.substring(0, remaining)}`);
        }

        return contextParts.join('\n\n');
    }

    /**
     * Get directory structure as tree
     */
    private getDirectoryStructure(dir: string, depth: number, maxDepth: number): string {
        if (depth > maxDepth) return '';

        const skipDirs = ['node_modules', '.git', 'dist', 'out', 'build', '__pycache__', 'venv', '.venv', '.idea', '.vscode'];
        const lines: string[] = [];
        const indent = '  '.repeat(depth);

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name.startsWith('.') && depth === 0) continue;
                if (skipDirs.includes(entry.name)) continue;

                if (entry.isDirectory()) {
                    lines.push(`${indent}${entry.name}/`);
                    const subTree = this.getDirectoryStructure(path.join(dir, entry.name), depth + 1, maxDepth);
                    if (subTree) lines.push(subTree);
                } else {
                    lines.push(`${indent}${entry.name}`);
                }
            }
        } catch {
            // Ignore permission errors
        }

        return lines.join('\n');
    }

    // ── Suggest methods (1 CLI call each, delimiter-based parsing) ──

    /**
     * Suggest agents for the project in a single CLI call.
     * Returns complete templates ready to write to disk.
     */
    async suggestAgents(model?: string): Promise<AgentSuggestion[]> {
        const projectContext = this.getProjectContext();

        const prompt = `Analyze this project and suggest 2-4 specialized Claude Code agents.

PROJECT:
${projectContext}

For each agent, output EXACTLY this format (no other text, no code fences):

===AGENT===
name: kebab-case-name
description: What this agent does
reason: Why it's useful
===TEMPLATE===
---
name: kebab-case-name
description: What this agent does
model: sonnet
---

You are a [role] for this project...

## Your Responsibilities
- [responsibility]

## Guidelines
- [guideline]
===END===`;

        const response = await this.execute(prompt, { timeout: 120000, model });
        if (!response.success) {
            this.log(`    [suggestAgents] CLI failed: ${response.error}`);
            return [];
        }

        this.log(`    [suggestAgents] Raw response length: ${response.content.length}`);
        const suggestions = this.parseAgentSuggestions(response.content);
        this.log(`    [suggestAgents] Parsed ${suggestions.length} suggestions`);
        return suggestions;
    }

    /**
     * Suggest commands for the project in a single CLI call.
     */
    async suggestCommands(model?: string): Promise<CommandSuggestion[]> {
        const projectContext = this.getProjectContext();

        const prompt = `Analyze this project and suggest 2-4 slash commands for daily workflow.

PROJECT:
${projectContext}

For each command, output EXACTLY this format (no other text, no code fences):

===COMMAND===
name: kebab-case-name
description: What this command does
reason: Why it saves time
===TEMPLATE===
---
description: What this command does
---

# command-name Command

Instructions for the command...
===END===`;

        const response = await this.execute(prompt, { timeout: 120000, model });
        if (!response.success) {
            this.log(`    [suggestCommands] CLI failed: ${response.error}`);
            return [];
        }

        this.log(`    [suggestCommands] Raw response length: ${response.content.length}`);
        const suggestions = this.parseCommandSuggestions(response.content);
        this.log(`    [suggestCommands] Parsed ${suggestions.length} suggestions`);
        return suggestions;
    }

    /**
     * Suggest skills for the project in a single CLI call.
     */
    async suggestSkills(model?: string): Promise<SkillSuggestion[]> {
        const projectContext = this.getProjectContext();

        const prompt = `Analyze this project and suggest 2-4 reusable skills (SKILL.md files).

PROJECT:
${projectContext}

For each skill, output EXACTLY this format (no other text, no code fences):

===SKILL===
name: kebab-case-name
description: What this skill does
reason: Why it's useful
===TEMPLATE===
---
name: kebab-case-name
description: What this skill does
argument-hint: "[args]"
user-invocable: true
model: sonnet
---

Instructions for the skill...
===END===`;

        const response = await this.execute(prompt, { timeout: 120000, model });
        if (!response.success) {
            this.log(`    [suggestSkills] CLI failed: ${response.error}`);
            return [];
        }

        this.log(`    [suggestSkills] Raw response length: ${response.content.length}`);
        const suggestions = this.parseSkillSuggestions(response.content);
        this.log(`    [suggestSkills] Parsed ${suggestions.length} suggestions`);
        return suggestions;
    }

    /**
     * Update an existing agent's prompt and context in a single CLI call.
     * Claude Code reads the project files directly.
     */
    async updateAgentContext(agentPath: string): Promise<{ success: boolean; method: string; error?: string }> {
        const agentName = path.basename(agentPath, '.md');

        try {
            let content = fs.readFileSync(agentPath, 'utf-8');

            // Parse frontmatter
            const { frontmatter, body } = this.parseFrontmatter(content, agentName);

            // Remove old auto-generated context
            let cleanBody = body;
            const contextMarker = '## Project Context (Auto-generated)';
            const markerIndex = cleanBody.indexOf(contextMarker);
            if (markerIndex !== -1) {
                cleanBody = cleanBody.substring(0, markerIndex).trimEnd();
            }

            // Get description from frontmatter
            const descMatch = frontmatter.match(/description:\s*(.+)/);
            const agentDescription = descMatch ? descMatch[1].trim() : `Specialized agent for ${agentName}`;

            const hasExistingPrompt = cleanBody.length > 50;

            const prompt = hasExistingPrompt
                ? `Read this project's CLAUDE.md and README.md, then improve this agent prompt.

AGENT: ${agentName}
CURRENT PROMPT:
${cleanBody.substring(0, 500)}

TASK:
1. Read CLAUDE.md and README.md to understand the project
2. Rewrite the agent prompt to be specific to this project
3. Add a "## Project Context (Auto-generated)" section

OUTPUT (markdown only):
- Start with "You are..."
- Include specific paths, commands, and tech from the project
- End with "## Project Context (Auto-generated)" section containing overview, tech stack, key directories, and commands`
                : `Read this project's CLAUDE.md and README.md, then create an agent prompt.

AGENT: ${agentName}
PURPOSE: ${agentDescription}

TASK:
1. Read CLAUDE.md and README.md to understand the project
2. Create a specialized agent prompt for "${agentName}"
3. Add a "## Project Context (Auto-generated)" section

OUTPUT (markdown only):
- Start with "You are..."
- Role definition with project name and actual tech stack
- 4-5 specific responsibilities with real file paths
- Guidelines with actual commands from the project
- End with "## Project Context (Auto-generated)" section containing overview, tech stack, key directories, and commands`;

            const response = await this.execute(prompt, { timeout: 90000 });

            if (!response.success) {
                return {
                    success: false,
                    method: 'failed',
                    error: response.error || 'Claude Code execution failed'
                };
            }

            // Rebuild file: frontmatter + new prompt from Claude
            const newContent = `${frontmatter}\n\n${response.content}`;
            fs.writeFileSync(agentPath, newContent);

            return { success: true, method: 'AI generated' };
        } catch (error) {
            return {
                success: false,
                method: 'failed',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Generate a CLAUDE.md tailored to the project by analyzing
     * project context + what was just created in .claude/
     */
    async generateClaudeMd(model?: string): Promise<string | null> {
        const projectContext = this.getProjectContext();

        // Scan what exists in .claude/ dirs
        const createdItems: string[] = [];
        const scanDirs = [
            { dir: path.join(this.workspaceRoot, '.claude', 'agents'), label: 'Agents' },
            { dir: path.join(this.workspaceRoot, '.claude', 'commands'), label: 'Commands' },
            { dir: path.join(this.workspaceRoot, '.claude', 'skills'), label: 'Skills' }
        ];

        for (const { dir, label } of scanDirs) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') || fs.statSync(path.join(dir, f)).isDirectory());
            if (files.length > 0) {
                createdItems.push(`${label}: ${files.map(f => f.replace('.md', '')).join(', ')}`);
            }
        }

        const itemsSummary = createdItems.length > 0
            ? `\n\nClaude Code items in this project:\n${createdItems.join('\n')}`
            : '';

        const prompt = `You are writing the actual content of a CLAUDE.md file for a project. This file will be saved directly to disk.

PROJECT:
${projectContext}${itemsSummary}

Write the CLAUDE.md with these sections:
1. "# <project-name>" — brief overview of what the project does
2. "## Key Conventions" — coding style, naming patterns, file organization
3. "## Architecture" — tech stack, directory structure with descriptions, key patterns
4. "## Development Commands" — build, test, lint commands as a table
5. "## Claude Code Integration" — list agents, commands, skills if they exist

CRITICAL RULES:
- Your entire response will be saved as CLAUDE.md verbatim. Do NOT include any preamble, explanation, or summary of what you did.
- Do NOT wrap the output in code fences.
- Do NOT start with "Here is..." or "The CLAUDE.md has been generated..." or any meta-commentary.
- Start your response DIRECTLY with "# " followed by the project name.
- Write concrete, specific content based on actual files — not placeholders like "[Add your conventions]".`;

        const response = await this.execute(prompt, { timeout: 120000, model });
        if (!response.success) {
            this.log(`    [generateClaudeMd] CLI failed: ${response.error}`);
            return null;
        }

        return response.content;
    }

    // ── Parsers ──

    /**
     * Parse frontmatter from agent file content.
     * Returns the frontmatter block (with ---) and the body after it.
     * If no frontmatter exists, creates a minimal one.
     */
    private parseFrontmatter(content: string, agentName: string): { frontmatter: string; body: string } {
        const match = content.match(/^(---\n[\s\S]*?\n---)/);
        if (match) {
            const frontmatter = match[1];
            const body = content.substring(match[0].length).trim();
            return { frontmatter, body };
        }

        // No frontmatter - create one
        const frontmatter = `---\nname: ${agentName}\ndescription: Agent for ${agentName}\nmodel: sonnet\n---`;
        return { frontmatter, body: content.trim() };
    }

    /**
     * Parse ===AGENT=== delimited blocks from CLI output
     */
    private parseAgentSuggestions(raw: string): AgentSuggestion[] {
        return this.parseDelimitedBlocks(raw, 'AGENT').map(block => ({
            name: block.meta.name || 'unnamed-agent',
            description: block.meta.description || '',
            reason: block.meta.reason || '',
            template: block.template
        }));
    }

    /**
     * Parse ===COMMAND=== delimited blocks from CLI output
     */
    private parseCommandSuggestions(raw: string): CommandSuggestion[] {
        return this.parseDelimitedBlocks(raw, 'COMMAND').map(block => ({
            name: block.meta.name || 'unnamed-command',
            description: block.meta.description || '',
            reason: block.meta.reason || '',
            template: block.template
        }));
    }

    /**
     * Parse ===SKILL=== delimited blocks from CLI output
     */
    private parseSkillSuggestions(raw: string): SkillSuggestion[] {
        return this.parseDelimitedBlocks(raw, 'SKILL').map(block => ({
            name: block.meta.name || 'unnamed-skill',
            description: block.meta.description || '',
            reason: block.meta.reason || '',
            template: block.template
        }));
    }

    /**
     * Strip markdown code fences and normalize delimiters in raw CLI output
     */
    private cleanRawOutput(raw: string): string {
        // Remove markdown code fences (```...```)
        let cleaned = raw.replace(/```[\w]*\n?/g, '');
        // Normalize delimiter whitespace: "=== AGENT ===" -> "===AGENT==="
        cleaned = cleaned.replace(/===\s*(\w+)\s*===/g, '===$1===');
        return cleaned;
    }

    /**
     * Generic parser for delimiter-based blocks.
     * Handles code fences, extra whitespace, and slight format variations.
     */
    private parseDelimitedBlocks(raw: string, type: string): { meta: Record<string, string>; template: string }[] {
        const cleaned = this.cleanRawOutput(raw);
        const results: { meta: Record<string, string>; template: string }[] = [];
        const blockRegex = new RegExp(`===${type}===([\\s\\S]*?)===END===`, 'gi');

        let match;
        while ((match = blockRegex.exec(cleaned)) !== null) {
            const blockContent = match[1];
            const templateSplit = blockContent.split(/===TEMPLATE===/i);

            if (templateSplit.length < 2) continue;

            // Parse metadata lines (key: value)
            const metaLines = templateSplit[0].trim().split('\n');
            const meta: Record<string, string> = {};
            for (const line of metaLines) {
                const kvMatch = line.match(/^([a-z-]+):\s*(.+)$/i);
                if (kvMatch) {
                    meta[kvMatch[1].toLowerCase()] = kvMatch[2].trim();
                }
            }

            const template = templateSplit[1].trim();
            if (template) {
                results.push({ meta, template });
            }
        }

        if (results.length === 0) {
            this.log(`    [parser] No blocks found for type=${type}. First 500 chars of output:`);
            this.log(`    ${cleaned.substring(0, 500)}`);
        }

        return results;
    }
}
