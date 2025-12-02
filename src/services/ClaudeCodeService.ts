import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ClaudeResponse {
    success: boolean;
    content: string;
    error?: string;
}

export class ClaudeCodeService {
    private skipPermissions: boolean = false;

    constructor(private workspaceRoot: string) {}

    /**
     * Set whether to skip permission prompts
     */
    setSkipPermissions(skip: boolean) {
        this.skipPermissions = skip;
    }

    /**
     * Read key project files to provide context (limited to ~8000 chars total)
     */
    getProjectContext(): string {
        const contextParts: string[] = [];
        const MAX_FILE_SIZE = 2000; // Max chars per file
        const MAX_TOTAL = 8000; // Max total chars
        let totalChars = 0;

        // Priority 1: CLAUDE.md (most important for agent context)
        const claudePath = path.join(this.workspaceRoot, 'CLAUDE.md');
        if (fs.existsSync(claudePath) && totalChars < MAX_TOTAL) {
            const content = fs.readFileSync(claudePath, 'utf-8');
            const trimmed = content.substring(0, MAX_FILE_SIZE);
            contextParts.push(`## CLAUDE.md\n${trimmed}`);
            totalChars += trimmed.length;
        }

        // Priority 2: README.md (project overview)
        const readmePath = path.join(this.workspaceRoot, 'README.md');
        if (fs.existsSync(readmePath) && totalChars < MAX_TOTAL) {
            const content = fs.readFileSync(readmePath, 'utf-8');
            const remaining = Math.min(MAX_FILE_SIZE, MAX_TOTAL - totalChars);
            const trimmed = content.substring(0, remaining);
            contextParts.push(`## README.md\n${trimmed}`);
            totalChars += trimmed.length;
        }

        // Priority 3: package.json (extract key info only)
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

        // Priority 4: pyproject.toml
        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        if (fs.existsSync(pyprojectPath) && totalChars < MAX_TOTAL) {
            const content = fs.readFileSync(pyprojectPath, 'utf-8');
            const remaining = Math.min(1000, MAX_TOTAL - totalChars);
            const trimmed = content.substring(0, remaining);
            contextParts.push(`## pyproject.toml\n${trimmed}`);
            totalChars += trimmed.length;
        }

        // Priority 5: Directory structure (2 levels)
        if (totalChars < MAX_TOTAL) {
            const structure = this.getDirectoryStructure(this.workspaceRoot, 0, 2);
            const remaining = Math.min(1000, MAX_TOTAL - totalChars);
            contextParts.push(`## Structure\n${structure.substring(0, remaining)}`);
        }

        return contextParts.join('\n\n');
    }

    /**
     * Get list of files being read for progress reporting
     */
    getReadableFiles(): string[] {
        const files: string[] = [];
        const checkFiles = ['README.md', 'CLAUDE.md', 'package.json', 'pyproject.toml', 'requirements.txt'];

        for (const file of checkFiles) {
            const filePath = path.join(this.workspaceRoot, file);
            if (fs.existsSync(filePath)) {
                files.push(file);
            }
        }
        return files;
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
        } catch (e) {
            // Ignore permission errors
        }

        return lines.join('\n');
    }

    /**
     * Execute a prompt using Claude Code CLI
     */
    private outputChannel: any = null;

    setOutputChannel(channel: any) {
        this.outputChannel = channel;
    }

    private log(message: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    async execute(prompt: string, options?: {
        maxTokens?: number;
        timeout?: number;
    }): Promise<ClaudeResponse> {
        const timeout = options?.timeout || 300000; // 5 min default

        return new Promise((resolve) => {
            // Use stdin to pass prompt (avoids shell escaping issues)
            const args = [
                '-p',  // Print mode
                '--model', 'sonnet'
            ];

            // Only add skip-permissions flag if user has opted in
            if (this.skipPermissions) {
                args.push('--dangerously-skip-permissions');
            }

            this.log(`    [Claude] Starting process (model: sonnet)...`);
            this.log(`    [Claude] Prompt length: ${prompt.length} chars`);

            const startTime = Date.now();
            let lastUpdate = startTime;

            // Find claude executable
            const home = process.env.HOME || process.env.USERPROFILE || '';
            const claudePath = `${home}/.local/bin/claude`;

            const proc = spawn(claudePath, args, {
                cwd: this.workspaceRoot,
                env: { ...process.env },
                shell: false
            });

            // Send prompt via stdin
            proc.stdin.write(prompt);
            proc.stdin.end();

            // Show waiting indicator every 10 seconds
            const waitingInterval = setInterval(() => {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                this.log(`    [Claude] Waiting... ${elapsed}s elapsed`);
            }, 10000);

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                // Show live output
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
                    resolve({
                        success: true,
                        content: stdout.trim()
                    });
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
     * Check if Claude Code CLI is available
     */
    async isAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('claude', ['--version'], {
                shell: true
            });

            proc.on('close', (code) => {
                resolve(code === 0);
            });

            proc.on('error', () => {
                resolve(false);
            });

            // Timeout after 5 seconds
            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000);
        });
    }

    /**
     * Analyze project and suggest agents using Claude
     */
    async analyzeProjectForAgents(projectFiles: string[]): Promise<ClaudeResponse> {
        const projectContext = this.getProjectContext();

        const prompt = `You are analyzing a software project to suggest specialized Claude Code agents.

PROJECT CONTEXT:
${projectContext}

Based on this project's tech stack, structure, and purpose, suggest 2-4 highly specialized agents.

IMPORTANT:
- Each agent should be SPECIFIC to this project, not generic
- Focus on the actual technologies and patterns used
- Consider the project's domain (what it does)

For each agent provide:
1. name: kebab-case identifier (e.g., "fastapi-endpoints", "ionic-components", "sqlalchemy-models")
2. description: One specific line about what this agent handles IN THIS PROJECT
3. reason: Why this specific agent is valuable for THIS project's workflow

Format as JSON array ONLY (no markdown, no explanation):
[{"name": "...", "description": "...", "reason": "..."}]`;

        return this.execute(prompt, { timeout: 60000 });
    }

    /**
     * Generate complete agent (prompt + context) in a single call
     * NOTE: Claude Code already has access to the project files, so we just give instructions
     * Uses a 90-second timeout to avoid hanging on slow responses
     */
    async generateFullAgent(agentName: string, agentDescription: string, currentPrompt: string): Promise<ClaudeResponse> {
        const hasExistingPrompt = currentPrompt && currentPrompt.length > 50;

        const prompt = hasExistingPrompt
            ? `Read this project's CLAUDE.md and README.md, then improve this agent prompt.

AGENT: ${agentName}
CURRENT PROMPT:
${currentPrompt.substring(0, 500)}

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

        // Use 90-second timeout to avoid hanging
        return this.execute(prompt, { timeout: 90000 });
    }

    /**
     * Generate a complete agent prompt using Claude
     */
    async generateAgentPrompt(agentName: string, agentDescription: string, projectContextSummary: string): Promise<ClaudeResponse> {
        const projectContext = this.getProjectContext();

        const prompt = `Create a Claude Code agent prompt.

AGENT: ${agentName}
PURPOSE: ${agentDescription}

PROJECT:
${projectContext}

Write a specific agent prompt with:
- Role definition with project name and tech
- 4-5 specific responsibilities with real paths
- Guidelines with actual commands/patterns
- Constraints

Be SPECIFIC to this project. Use real paths and tech from above.
Output markdown only, start with "You are..."`;

        return this.execute(prompt);
    }

    /**
     * Generate project context summary using Claude
     */
    async generateProjectContext(readmeContent: string, claudeMdContent?: string, otherDocs?: string[]): Promise<ClaudeResponse> {
        const projectContext = this.getProjectContext();

        const prompt = `Create a context summary for Claude Code agents.

PROJECT:
${projectContext}

Write a concise context with:
- Overview (2 sentences)
- Tech stack
- Key directories and their purpose
- Main commands (run, test, build)

Use actual paths from above. Max 300 words.
Start with "## Project Context (Auto-generated)"`;

        return this.execute(prompt);
    }

    /**
     * Update an existing agent with better context
     */
    async enhanceAgentPrompt(currentPrompt: string, projectContextSummary: string): Promise<ClaudeResponse> {
        const projectContext = this.getProjectContext();

        const prompt = `Improve this agent prompt to be project-specific.

CURRENT:
${currentPrompt.substring(0, 500)}

PROJECT:
${projectContext}

Rewrite with:
- Real paths and tech from this project
- Specific commands and patterns
- Concrete responsibilities

Keep the core purpose. Output markdown only, start with "You are..."`;

        return this.execute(prompt);
    }
}
