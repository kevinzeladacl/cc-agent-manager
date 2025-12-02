import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ClaudeCodeService } from './ClaudeCodeService';

export interface ProjectContext {
    files: MarkdownFile[];
    summary: string;
    suggestedAgents: AgentSuggestion[];
}

export interface MarkdownFile {
    name: string;
    path: string;
    content: string;
    title?: string;
    description?: string;
}

export interface AgentSuggestion {
    name: string;
    description: string;
    reason: string;
    template: string;
}

export class AutoContextService {
    private claudeService: ClaudeCodeService;
    private useClaudeCode: boolean = true;

    constructor(private workspaceRoot: string) {
        this.claudeService = new ClaudeCodeService(workspaceRoot);
    }

    /**
     * Check if Claude Code CLI is available and set flag
     */
    async checkClaudeAvailability(): Promise<boolean> {
        this.useClaudeCode = await this.claudeService.isAvailable();
        return this.useClaudeCode;
    }

    /**
     * Get list of project files that will be read for context
     */
    getReadableProjectFiles(): string[] {
        return this.claudeService.getReadableFiles();
    }

    /**
     * Set output channel for logging
     */
    setOutputChannel(channel: any) {
        this.claudeService.setOutputChannel(channel);
    }

    /**
     * Set whether to skip permission prompts
     */
    setSkipPermissions(skip: boolean) {
        this.claudeService.setSkipPermissions(skip);
    }

    async scanMarkdownFiles(): Promise<MarkdownFile[]> {
        const files: MarkdownFile[] = [];
        await this.findMarkdownFiles(this.workspaceRoot, files);
        return files;
    }

    private async findMarkdownFiles(dir: string, files: MarkdownFile[], depth: number = 0): Promise<void> {
        // Limit depth to avoid scanning too deep
        if (depth > 5) return;

        // Skip certain directories
        const skipDirs = ['node_modules', '.git', 'dist', 'out', 'build', '.claude'];

        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                    await this.findMarkdownFiles(fullPath, files, depth + 1);
                }
            } else if (entry.name.endsWith('.md')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const parsed = this.parseMarkdown(content);
                    files.push({
                        name: entry.name,
                        path: fullPath,
                        content: content,
                        title: parsed.title,
                        description: parsed.description
                    });
                } catch (error) {
                    console.error(`Error reading ${fullPath}:`, error);
                }
            }
        }
    }

    private parseMarkdown(content: string): { title?: string; description?: string } {
        // Extract title from first # heading
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : undefined;

        // Extract description from first paragraph after title
        const lines = content.split('\n');
        let description: string | undefined;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Skip empty lines and headings
            if (!line || line.startsWith('#')) continue;
            // Skip frontmatter
            if (line === '---') {
                // Skip until next ---
                while (i < lines.length && lines[++i]?.trim() !== '---') {}
                continue;
            }
            // First non-empty, non-heading line is the description
            description = line.substring(0, 200);
            break;
        }

        return { title, description };
    }

    generateProjectSummary(files: MarkdownFile[]): string {
        const summaryParts: string[] = [];

        // Prioritize README
        const readme = files.find(f => f.name.toLowerCase() === 'readme.md');
        if (readme) {
            summaryParts.push(`## Project Overview\n${readme.content.substring(0, 1000)}`);
        }

        // Add other relevant files
        const otherFiles = files.filter(f => f.name.toLowerCase() !== 'readme.md').slice(0, 10);
        if (otherFiles.length > 0) {
            summaryParts.push('\n## Documentation Files');
            for (const file of otherFiles) {
                const relativePath = path.relative(this.workspaceRoot, file.path);
                summaryParts.push(`\n### ${relativePath}`);
                if (file.title) {
                    summaryParts.push(`Title: ${file.title}`);
                }
                if (file.description) {
                    summaryParts.push(`${file.description}`);
                }
            }
        }

        return summaryParts.join('\n');
    }

    /**
     * Suggest agents using Claude Code (AI-powered) or fallback to static analysis
     */
    async suggestAgentsWithAI(files: MarkdownFile[]): Promise<AgentSuggestion[]> {
        const projectName = path.basename(this.workspaceRoot);

        if (!this.useClaudeCode) {
            return this.suggestAgents(files);
        }

        try {
            // Get list of all project files (not just markdown)
            const allFiles = await this.getAllProjectFiles();
            const response = await this.claudeService.analyzeProjectForAgents(allFiles);

            if (!response.success) {
                console.error('Claude Code analysis failed:', response.error);
                return this.suggestAgents(files);
            }

            // Parse JSON response
            const parsed = JSON.parse(response.content);
            const suggestions: AgentSuggestion[] = [];

            for (const item of parsed) {
                // Generate full template using Claude
                const templateResponse = await this.claudeService.generateAgentPrompt(
                    item.name,
                    item.description,
                    this.generateProjectSummary(files)
                );

                const promptContent = templateResponse.success
                    ? templateResponse.content
                    : this.getDefaultPromptContent(item.name, projectName);

                suggestions.push({
                    name: item.name,
                    description: item.description,
                    reason: item.reason,
                    template: this.buildAgentTemplate(item.name, item.description, promptContent)
                });
            }

            return suggestions;
        } catch (error) {
            console.error('Error in AI agent suggestion:', error);
            return this.suggestAgents(files);
        }
    }

    /**
     * Generate project context using Claude Code (AI-powered)
     */
    async generateContextWithAI(files: MarkdownFile[]): Promise<string> {
        if (!this.useClaudeCode) {
            return this.generateContextSection(files);
        }

        try {
            const readme = files.find(f => f.name.toLowerCase() === 'readme.md');
            const claudeMd = files.find(f => f.name.toLowerCase() === 'claude.md');
            const otherDocs = files
                .filter(f => !['readme.md', 'claude.md'].includes(f.name.toLowerCase()))
                .map(f => path.relative(this.workspaceRoot, f.path));

            const response = await this.claudeService.generateProjectContext(
                readme?.content || '',
                claudeMd?.content,
                otherDocs
            );

            if (response.success) {
                return '\n\n' + response.content;
            }

            return this.generateContextSection(files);
        } catch (error) {
            console.error('Error generating AI context:', error);
            return this.generateContextSection(files);
        }
    }

    /**
     * Get all project files (not just markdown) for analysis
     */
    private async getAllProjectFiles(): Promise<string[]> {
        const files: string[] = [];
        await this.collectProjectFiles(this.workspaceRoot, files, 0);
        return files;
    }

    private async collectProjectFiles(dir: string, files: string[], depth: number): Promise<void> {
        if (depth > 4) return;

        const skipDirs = ['node_modules', '.git', 'dist', 'out', 'build', '.claude', '__pycache__', 'venv', '.venv'];

        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.workspaceRoot, fullPath);

            if (entry.isDirectory()) {
                if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                    files.push(relativePath + '/');
                    await this.collectProjectFiles(fullPath, files, depth + 1);
                }
            } else {
                // Include key file types
                const ext = path.extname(entry.name).toLowerCase();
                const importantExts = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.json', '.yaml', '.yml', '.md', '.toml'];
                const importantFiles = ['package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'requirements.txt', 'pyproject.toml'];

                if (importantExts.includes(ext) || importantFiles.includes(entry.name)) {
                    files.push(relativePath);
                }
            }
        }
    }

    private buildAgentTemplate(name: string, description: string, promptContent: string): string {
        return `---
name: ${name}
description: ${description}
model: sonnet
---

${promptContent}
`;
    }

    private getDefaultPromptContent(agentName: string, projectName: string): string {
        return `You are the ${agentName} for the **${projectName}** project.

## Your Responsibilities

- Assist with tasks related to your area of expertise
- Follow project conventions and patterns
- Provide accurate, helpful information

## Guidelines

- Always consider existing codebase patterns
- Ask clarifying questions when needed
- Be concise and practical
`;
    }

    /**
     * Static fallback: Suggest agents based on keyword analysis
     */
    suggestAgents(files: MarkdownFile[]): AgentSuggestion[] {
        const suggestions: AgentSuggestion[] = [];
        const projectName = path.basename(this.workspaceRoot);

        // Analyze files to suggest relevant agents
        const contentLower = files.map(f => f.content.toLowerCase()).join(' ');

        // Documentation agent if there are many .md files
        if (files.length >= 3) {
            suggestions.push({
                name: 'docs-expert',
                description: `Expert in ${projectName} documentation and project structure`,
                reason: `Found ${files.length} documentation files in the project`,
                template: this.getDocsAgentTemplate(projectName, files)
            });
        }

        // API agent if there's API documentation
        if (contentLower.includes('api') || contentLower.includes('endpoint') || contentLower.includes('rest')) {
            suggestions.push({
                name: 'api-expert',
                description: `Expert in ${projectName} API and endpoints`,
                reason: 'Found API-related documentation',
                template: this.getApiAgentTemplate(projectName)
            });
        }

        // Testing agent if there's test documentation
        if (contentLower.includes('test') || contentLower.includes('jest') || contentLower.includes('mocha')) {
            suggestions.push({
                name: 'test-expert',
                description: `Expert in testing for ${projectName}`,
                reason: 'Found testing-related documentation',
                template: this.getTestAgentTemplate(projectName)
            });
        }

        // Architecture agent if there's architecture docs
        if (contentLower.includes('architecture') || contentLower.includes('design') || contentLower.includes('structure')) {
            suggestions.push({
                name: 'architecture-expert',
                description: `Expert in ${projectName} architecture and design`,
                reason: 'Found architecture-related documentation',
                template: this.getArchitectureAgentTemplate(projectName)
            });
        }

        return suggestions;
    }

    private getDocsAgentTemplate(projectName: string, files: MarkdownFile[]): string {
        const fileList = files.slice(0, 10).map(f => `- ${path.relative(this.workspaceRoot, f.path)}`).join('\n');
        return `---
name: docs-expert
description: Expert in ${projectName} documentation and project structure
model: sonnet
---

You are a documentation expert for the ${projectName} project.

## Your Knowledge Base

The project has the following documentation files:
${fileList}

## Your Responsibilities

- Answer questions about the project based on documentation
- Help users find relevant documentation
- Explain project structure and conventions
- Assist with understanding the codebase

## Guidelines

- Always reference specific documentation files when answering
- If information is not in the docs, say so clearly
- Suggest improvements to documentation when appropriate
`;
    }

    private getApiAgentTemplate(projectName: string): string {
        return `---
name: api-expert
description: Expert in ${projectName} API and endpoints
model: sonnet
---

You are an API expert for the ${projectName} project.

## Your Responsibilities

- Help users understand API endpoints and their usage
- Assist with API integration and troubleshooting
- Explain request/response formats
- Guide users through authentication and authorization

## Guidelines

- Provide working code examples when possible
- Warn about breaking changes or deprecated endpoints
- Consider security best practices
`;
    }

    private getTestAgentTemplate(projectName: string): string {
        return `---
name: test-expert
description: Expert in testing for ${projectName}
model: sonnet
---

You are a testing expert for the ${projectName} project.

## Your Responsibilities

- Help write and improve tests
- Debug failing tests
- Suggest test coverage improvements
- Guide testing best practices

## Guidelines

- Follow existing test patterns in the project
- Prioritize meaningful tests over coverage numbers
- Consider edge cases and error scenarios
`;
    }

    private getArchitectureAgentTemplate(projectName: string): string {
        return `---
name: architecture-expert
description: Expert in ${projectName} architecture and design
model: sonnet
---

You are an architecture expert for the ${projectName} project.

## Your Responsibilities

- Explain architectural decisions and patterns
- Help with system design questions
- Guide refactoring efforts
- Identify potential improvements

## Guidelines

- Consider scalability and maintainability
- Respect existing patterns unless there's good reason to change
- Document architectural decisions
`;
    }

    generateContextSection(files: MarkdownFile[]): string {
        const projectName = path.basename(this.workspaceRoot);

        let context = `\n\n## Project Context (Auto-generated)\n\n`;
        context += `Project: **${projectName}**\n\n`;

        // Categorize files by importance/type
        const readme = files.find(f => f.name.toLowerCase() === 'readme.md');
        const claudeFile = files.find(f => f.name.toLowerCase() === 'claude.md');
        const changelog = files.find(f => f.name.toLowerCase() === 'changelog.md');
        const contributing = files.find(f => f.name.toLowerCase() === 'contributing.md');
        const otherDocs = files.filter(f =>
            !['readme.md', 'claude.md', 'changelog.md', 'contributing.md'].includes(f.name.toLowerCase())
        );

        // 1. Project Overview from README
        if (readme) {
            const summary = this.extractReadmeSummary(readme.content);
            if (summary) {
                context += `### Overview\n${summary}\n\n`;
            }
        }

        // 2. CLAUDE.md is critical - extract key instructions
        if (claudeFile) {
            const claudeContext = this.extractClaudeContext(claudeFile.content);
            if (claudeContext) {
                context += `### Project Guidelines (from CLAUDE.md)\n${claudeContext}\n\n`;
            }
        }

        // 3. Tech Stack / Architecture detection
        const techStack = this.detectTechStack(files);
        if (techStack.length > 0) {
            context += `### Tech Stack\n${techStack.join(', ')}\n\n`;
        }

        // 4. Key documentation with summaries
        const keyDocs = otherDocs.slice(0, 5);
        if (keyDocs.length > 0 || changelog || contributing) {
            context += `### Documentation\n`;

            if (changelog) {
                context += `- \`CHANGELOG.md\` - Project version history\n`;
            }
            if (contributing) {
                context += `- \`CONTRIBUTING.md\` - Contribution guidelines\n`;
            }

            for (const file of keyDocs) {
                const relativePath = path.relative(this.workspaceRoot, file.path);
                context += `- \`${relativePath}\``;
                if (file.description) {
                    // Short description from first paragraph
                    const shortDesc = file.description.substring(0, 80);
                    context += ` - ${shortDesc}${file.description.length > 80 ? '...' : ''}`;
                } else if (file.title && file.title !== file.name.replace('.md', '')) {
                    context += ` - ${file.title}`;
                }
                context += '\n';
            }
        }

        return context;
    }

    private extractClaudeContext(content: string): string {
        // Extract key sections from CLAUDE.md
        const lines = content.split('\n');
        const relevantLines: string[] = [];
        let inCodeBlock = false;
        let lineCount = 0;

        for (const line of lines) {
            if (line.trim().startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                continue;
            }
            if (inCodeBlock) continue;

            // Skip frontmatter
            if (line.trim() === '---') continue;

            // Include headings and key content
            if (line.startsWith('#') || line.trim().startsWith('-') || line.trim().startsWith('*')) {
                relevantLines.push(line);
                lineCount++;
            } else if (line.trim() && lineCount < 15) {
                relevantLines.push(line);
                lineCount++;
            }

            if (lineCount >= 15) break;
        }

        return relevantLines.join('\n');
    }

    private detectTechStack(files: MarkdownFile[]): string[] {
        const allContent = files.map(f => f.content.toLowerCase()).join(' ');
        const stack: string[] = [];

        // Backend
        if (allContent.includes('fastapi')) stack.push('FastAPI');
        else if (allContent.includes('express')) stack.push('Express');
        else if (allContent.includes('django')) stack.push('Django');
        else if (allContent.includes('flask')) stack.push('Flask');
        else if (allContent.includes('nestjs')) stack.push('NestJS');

        // Frontend
        if (allContent.includes('ionic')) stack.push('Ionic');
        if (allContent.includes('angular')) stack.push('Angular');
        else if (allContent.includes('react')) stack.push('React');
        else if (allContent.includes('vue')) stack.push('Vue');
        else if (allContent.includes('svelte')) stack.push('Svelte');

        // Database
        if (allContent.includes('sqlite')) stack.push('SQLite');
        else if (allContent.includes('postgresql') || allContent.includes('postgres')) stack.push('PostgreSQL');
        else if (allContent.includes('mongodb')) stack.push('MongoDB');
        else if (allContent.includes('mysql')) stack.push('MySQL');

        // ORM
        if (allContent.includes('sqlalchemy')) stack.push('SQLAlchemy');
        else if (allContent.includes('prisma')) stack.push('Prisma');
        else if (allContent.includes('typeorm')) stack.push('TypeORM');

        // Auth
        if (allContent.includes('jwt')) stack.push('JWT');
        if (allContent.includes('oauth')) stack.push('OAuth');

        // Other
        if (allContent.includes('typescript')) stack.push('TypeScript');
        if (allContent.includes('graphql')) stack.push('GraphQL');
        if (allContent.includes('docker')) stack.push('Docker');

        return stack;
    }

    private extractReadmeSummary(content: string): string {
        const lines = content.split('\n');
        const summaryLines: string[] = [];
        let inCodeBlock = false;
        let inFrontmatter = false;
        let passedTitle = false;
        let emptyLineCount = 0;

        for (const line of lines) {
            // Track frontmatter
            if (line.trim() === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
            }
            if (inFrontmatter) continue;

            // Track code blocks
            if (line.trim().startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                continue;
            }
            if (inCodeBlock) continue;

            // Skip main title (first # heading)
            if (line.startsWith('# ') && !passedTitle) {
                passedTitle = true;
                continue;
            }

            // Stop at next heading (## or lower)
            if (line.startsWith('#')) break;

            // Handle empty lines
            if (!line.trim()) {
                emptyLineCount++;
                // Allow up to 2 consecutive empty lines, then stop
                if (emptyLineCount > 2 && summaryLines.length > 0) break;
                continue;
            }

            // Reset empty line counter when we find content
            emptyLineCount = 0;

            // Skip lines that are just version badges or short metadata
            if (line.match(/^Version:\s*\*?\*?[\d.]+\*?\*?\s*$/i)) continue;
            if (line.match(/^\[!\[/)) continue; // Skip badge images
            if (line.match(/^>\s*$/)) continue; // Skip empty blockquotes

            // Add content lines
            summaryLines.push(line.trim());

            // Stop after getting enough meaningful content
            if (summaryLines.length >= 6) break;
        }

        return summaryLines.join('\n');
    }

    /**
     * Update agent with context using Claude Code AI (single call)
     * Returns object with success status and details
     */
    async updateAgentWithContextAI(agentPath: string, files: MarkdownFile[]): Promise<{ success: boolean; method: string; error?: string }> {
        const agentName = path.basename(agentPath, '.md');
        const projectName = path.basename(this.workspaceRoot);

        try {
            let content = fs.readFileSync(agentPath, 'utf-8');

            // 1. Fix frontmatter format
            content = this.fixFrontmatterFormat(content, agentPath);

            // 2. Remove old auto-generated context
            const contextMarker = '## Project Context (Auto-generated)';
            if (content.includes(contextMarker)) {
                const markerIndex = content.indexOf(contextMarker);
                content = content.substring(0, markerIndex).trimEnd();
            }

            // 3. Extract current prompt (after frontmatter) and frontmatter
            const frontmatterEnd = content.indexOf('---', 4);
            let currentPrompt = '';
            let frontmatter = '';
            if (frontmatterEnd !== -1) {
                frontmatter = content.substring(0, frontmatterEnd + 3);
                currentPrompt = content.substring(frontmatterEnd + 3).trim();
            }

            // 4. Get description from frontmatter for context
            const descMatch = content.match(/description:\s*(.+)/);
            const agentDescription = descMatch ? descMatch[1].trim() : `Specialized agent for ${agentName}`;

            // 5. Generate BOTH prompt AND context in a SINGLE Claude call
            const response = await this.claudeService.generateFullAgent(
                agentName,
                agentDescription,
                currentPrompt
            );

            let newPrompt: string;
            let contextSection: string;
            let method: string;

            if (response.success) {
                // Parse response - expect prompt and context separated by marker
                const responseContent = response.content;
                const contextMarkerIndex = responseContent.indexOf('## Project Context');

                if (contextMarkerIndex > 0) {
                    newPrompt = responseContent.substring(0, contextMarkerIndex).trim();
                    contextSection = '\n\n' + responseContent.substring(contextMarkerIndex);
                    method = 'AI generated';
                } else {
                    // No context section in response, use static
                    newPrompt = responseContent;
                    contextSection = this.generateContextSection(files);
                    method = 'AI prompt + static context';
                }
            } else {
                // Fallback to static
                newPrompt = currentPrompt.length > 50 ? currentPrompt : this.generateDefaultAgentPrompt(agentName, projectName);
                contextSection = this.generateContextSection(files);
                method = 'fallback (AI failed: ' + (response.error || 'unknown') + ')';
            }

            // 6. Rebuild content
            content = frontmatter + '\n\n' + newPrompt + contextSection;

            fs.writeFileSync(agentPath, content);
            return {
                success: true,
                method
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                method: 'failed',
                error: errorMsg
            };
        }
    }

    /**
     * Update agent with context using static analysis (fallback)
     */
    async updateAgentWithContext(agentPath: string, files: MarkdownFile[]): Promise<boolean> {
        try {
            let content = fs.readFileSync(agentPath, 'utf-8');
            const agentName = path.basename(agentPath, '.md');
            const projectName = path.basename(this.workspaceRoot);

            // 1. Fix frontmatter format to be Claude Code compatible
            content = this.fixFrontmatterFormat(content, agentPath);

            // 2. Remove old auto-generated context if present
            const contextMarker = '## Project Context (Auto-generated)';
            if (content.includes(contextMarker)) {
                const markerIndex = content.indexOf(contextMarker);
                content = content.substring(0, markerIndex).trimEnd();
            }

            // 3. Check if agent has actual prompt content (not just frontmatter)
            const frontmatterEnd = content.indexOf('---', 4);
            if (frontmatterEnd !== -1) {
                const bodyContent = content.substring(frontmatterEnd + 3).trim();
                // If no meaningful content after frontmatter, add default prompt
                if (!bodyContent || bodyContent.length < 20) {
                    const defaultPrompt = this.generateDefaultAgentPrompt(agentName, projectName);
                    content = content.substring(0, frontmatterEnd + 3) + '\n\n' + defaultPrompt;
                }
            }

            // 4. Generate and add new context from ALL markdown files
            const contextSection = this.generateContextSection(files);
            content += contextSection;

            fs.writeFileSync(agentPath, content);
            return true;
        } catch (error) {
            console.error(`Error updating agent ${agentPath}:`, error);
            return false;
        }
    }

    private generateDefaultAgentPrompt(agentName: string, projectName: string): string {
        return `You are a specialized agent for the **${projectName}** project.

## Your Role

As the ${agentName} agent, you help with tasks related to this project. You have knowledge of the project structure, conventions, and codebase.

## Your Responsibilities

- Assist with development tasks within your area of expertise
- Follow project conventions and patterns
- Provide accurate information based on the project context below
- Ask clarifying questions when requirements are unclear

## Guidelines

- Always consider the existing codebase patterns before suggesting changes
- Prioritize maintainability and readability
- Test your suggestions mentally before recommending them
`;
    }

    private fixFrontmatterFormat(content: string, agentPath: string): string {
        const agentName = path.basename(agentPath, '.md');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        // If no frontmatter exists, create a valid one
        if (!frontmatterMatch) {
            const newFrontmatter = `---\nname: ${agentName}\ndescription: Agent for ${agentName}\nmodel: sonnet\n---\n\n`;
            return newFrontmatter + content;
        }

        const frontmatter = frontmatterMatch[1];
        const lines = frontmatter.split('\n');

        // Parse existing values
        let hasName = false;
        let hasDescription = false;
        let hasModel = false;

        const fixedLines: string[] = [];

        for (const line of lines) {
            // Skip invalid fields for Claude Code agents
            if (line.match(/^\s*tools:\s*/)) continue;
            if (line.match(/^\s*allowed-tools:\s*/)) continue;

            // Check what fields exist
            if (line.match(/^\s*name:\s*/)) hasName = true;
            if (line.match(/^\s*description:\s*/)) hasDescription = true;
            if (line.match(/^\s*model:\s*/)) hasModel = true;

            // Fix quoted values: field: "value" -> field: value
            const match = line.match(/^(\s*)([a-zA-Z_-]+):\s*["']([^"']+)["']\s*$/);
            if (match) {
                const [, indent, field, value] = match;
                // Keep quotes only if value contains special YAML characters
                const needsQuotes = /[:#\[\]{}|>&*!?,]/.test(value) ||
                                   /^[@`'"]/.test(value) ||
                                   value.trim() !== value;
                if (!needsQuotes) {
                    fixedLines.push(`${indent}${field}: ${value}`);
                    continue;
                }
            }

            fixedLines.push(line);
        }

        // Add missing required fields
        if (!hasName) {
            fixedLines.unshift(`name: ${agentName}`);
        }
        if (!hasDescription) {
            fixedLines.push(`description: Agent for ${agentName}`);
        }
        if (!hasModel) {
            fixedLines.push(`model: sonnet`);
        }

        // Rebuild content with fixed frontmatter
        const fixedFrontmatter = fixedLines.join('\n');
        return content.replace(
            /^---\n[\s\S]*?\n---/,
            `---\n${fixedFrontmatter}\n---`
        );
    }
}
