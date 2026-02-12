import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ClaudeItem {
    name: string;
    filePath: string;
    description?: string;
    type: 'agent' | 'command' | 'skill' | 'team';
    source: 'project' | 'global';
    enabled: boolean;
    model?: string;
    // Agent-specific new fields
    tools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
    maxTurns?: number;
    skills?: string[];
    mcpServers?: string[];
    // Skill-specific fields
    argumentHint?: string;
    userInvocable?: boolean;
    allowedTools?: string[];
    // Team-specific fields
    teamMembers?: string[];
}

export class ClaudeTreeProvider implements vscode.TreeDataProvider<ClaudeItemNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ClaudeItemNode | undefined | null | void> = new vscode.EventEmitter<ClaudeItemNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ClaudeItemNode | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private workspaceRoot: string | undefined,
        private itemType: 'agent' | 'command' | 'skill' | 'team'
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ClaudeItemNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ClaudeItemNode): Promise<ClaudeItemNode[]> {
        if (element) {
            return [];
        }

        if (this.itemType === 'skill') {
            return this.getSkillChildren();
        }

        if (this.itemType === 'team') {
            return this.getTeamChildren();
        }

        const items: ClaudeItem[] = [];
        const folder = this.itemType === 'agent' ? 'agents' : 'commands';
        const disabledFolder = this.itemType === 'agent' ? 'agents-disabled' : 'commands-disabled';

        // Project-level items (enabled)
        if (this.workspaceRoot) {
            const projectPath = path.join(this.workspaceRoot, '.claude', folder);
            const projectItems = await this.getItemsFromPath(projectPath, 'project', true);
            items.push(...projectItems);

            // Project-level items (disabled)
            const projectDisabledPath = path.join(this.workspaceRoot, '.claude', disabledFolder);
            const projectDisabledItems = await this.getItemsFromPath(projectDisabledPath, 'project', false);
            items.push(...projectDisabledItems);
        }

        // Global items (enabled)
        const homedir = process.env.HOME || process.env.USERPROFILE || '';
        const globalPath = path.join(homedir, '.claude', folder);
        const globalItems = await this.getItemsFromPath(globalPath, 'global', true);
        items.push(...globalItems);

        // Global items (disabled)
        const globalDisabledPath = path.join(homedir, '.claude', disabledFolder);
        const globalDisabledItems = await this.getItemsFromPath(globalDisabledPath, 'global', false);
        items.push(...globalDisabledItems);

        // Sort: enabled first, then by name
        items.sort((a, b) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return items.map(item => new ClaudeItemNode(item, this.itemType));
    }

    private async getSkillChildren(): Promise<ClaudeItemNode[]> {
        const items: ClaudeItem[] = [];

        // Project-level skills
        if (this.workspaceRoot) {
            const projectSkillsPath = path.join(this.workspaceRoot, '.claude', 'skills');
            const projectSkills = this.scanSkillsDir(projectSkillsPath, 'project', true);
            items.push(...projectSkills);

            const projectDisabledPath = path.join(this.workspaceRoot, '.claude', 'skills-disabled');
            const projectDisabledSkills = this.scanSkillsDir(projectDisabledPath, 'project', false);
            items.push(...projectDisabledSkills);
        }

        // Global skills
        const homedir = process.env.HOME || process.env.USERPROFILE || '';
        const globalSkillsPath = path.join(homedir, '.claude', 'skills');
        const globalSkills = this.scanSkillsDir(globalSkillsPath, 'global', true);
        items.push(...globalSkills);

        const globalDisabledPath = path.join(homedir, '.claude', 'skills-disabled');
        const globalDisabledSkills = this.scanSkillsDir(globalDisabledPath, 'global', false);
        items.push(...globalDisabledSkills);

        items.sort((a, b) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return items.map(item => new ClaudeItemNode(item, 'skill'));
    }

    private scanSkillsDir(basePath: string, source: 'project' | 'global', enabled: boolean): ClaudeItem[] {
        const items: ClaudeItem[] = [];

        if (!fs.existsSync(basePath)) {
            return items;
        }

        try {
            const entries = fs.readdirSync(basePath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                const skillMdPath = path.join(basePath, entry.name, 'SKILL.md');
                if (!fs.existsSync(skillMdPath)) {
                    continue;
                }

                const item = this.parseSkillFile(skillMdPath, entry.name, source, enabled);
                if (item) {
                    items.push(item);
                }
            }
        } catch {
            // Directory read failed
        }

        return items;
    }

    private parseSkillFile(filePath: string, dirName: string, source: 'project' | 'global', enabled: boolean): ClaudeItem | null {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');

            let name = dirName;
            let description = '';
            let argumentHint: string | undefined;
            let userInvocable: boolean | undefined;
            let allowedTools: string[] | undefined;
            let model: string | undefined;

            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
                const fm = frontmatterMatch[1];

                const nameMatch = fm.match(/name:\s*["']?([^"'\n]+)["']?/);
                if (nameMatch) { name = nameMatch[1].trim(); }

                const descMatch = fm.match(/description:\s*["']?([^"'\n]+)["']?/);
                if (descMatch) { description = descMatch[1].trim(); }

                const hintMatch = fm.match(/argument-hint:\s*["']?([^"'\n]+)["']?/);
                if (hintMatch) { argumentHint = hintMatch[1].trim(); }

                const invocableMatch = fm.match(/user-invocable:\s*(true|false)/);
                if (invocableMatch) { userInvocable = invocableMatch[1] === 'true'; }

                const toolsMatch = fm.match(/allowed-tools:\s*\[([^\]]*)\]/);
                if (toolsMatch) {
                    allowedTools = toolsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean);
                }

                const modelMatch = fm.match(/model:\s*["']?([^"'\n]+)["']?/);
                if (modelMatch) { model = modelMatch[1].trim(); }
            }

            return {
                name,
                filePath,
                description,
                type: 'skill',
                source,
                enabled,
                model,
                argumentHint,
                userInvocable,
                allowedTools
            };
        } catch {
            return null;
        }
    }

    private async getTeamChildren(): Promise<ClaudeItemNode[]> {
        const items: ClaudeItem[] = [];

        // Teams are global-only
        const homedir = process.env.HOME || process.env.USERPROFILE || '';
        const teamsPath = path.join(homedir, '.claude', 'teams');

        if (fs.existsSync(teamsPath)) {
            try {
                const entries = fs.readdirSync(teamsPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) {
                        continue;
                    }
                    const configPath = path.join(teamsPath, entry.name, 'config.json');
                    if (!fs.existsSync(configPath)) {
                        continue;
                    }

                    try {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        const config = JSON.parse(content);

                        const teamMembers: string[] = [];
                        if (Array.isArray(config.members)) {
                            for (const m of config.members) {
                                teamMembers.push(typeof m === 'string' ? m : m.name || m.agent || 'unknown');
                            }
                        }

                        items.push({
                            name: config.name || entry.name,
                            filePath: configPath,
                            description: config.description || `${teamMembers.length} member(s)`,
                            type: 'team',
                            source: 'global',
                            enabled: true,
                            teamMembers
                        });
                    } catch {
                        // JSON parse failed
                    }
                }
            } catch {
                // Directory read failed
            }
        }

        items.sort((a, b) => a.name.localeCompare(b.name));
        return items.map(item => new ClaudeItemNode(item, 'team'));
    }

    private async getItemsFromPath(basePath: string, source: 'project' | 'global', enabled: boolean): Promise<ClaudeItem[]> {
        const items: ClaudeItem[] = [];

        if (!fs.existsSync(basePath)) {
            return items;
        }

        const files = await this.getMarkdownFiles(basePath, basePath);

        for (const filePath of files) {
            const item = await this.parseItem(filePath, source, enabled);
            if (item) {
                items.push(item);
            }
        }

        return items;
    }

    private async getMarkdownFiles(dir: string, basePath: string): Promise<string[]> {
        const files: string[] = [];

        if (!fs.existsSync(dir)) {
            return files;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const subFiles = await this.getMarkdownFiles(fullPath, basePath);
                files.push(...subFiles);
            } else if (entry.name.endsWith('.md')) {
                files.push(fullPath);
            }
        }

        return files;
    }

    private async parseItem(filePath: string, source: 'project' | 'global', enabled: boolean): Promise<ClaudeItem | null> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileName = path.basename(filePath, '.md');

            let description = '';
            let model: string | undefined;
            let agentName: string | undefined;
            let tools: string[] | undefined;
            let disallowedTools: string[] | undefined;
            let permissionMode: string | undefined;
            let maxTurns: number | undefined;
            let skills: string[] | undefined;
            let mcpServers: string[] | undefined;

            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
                const frontmatter = frontmatterMatch[1];

                const descMatch = frontmatter.match(/description:\s*["']?([^"'\n]+)["']?/);
                if (descMatch) {
                    description = descMatch[1].trim();
                }

                const modelMatch = frontmatter.match(/model:\s*["']?([^"'\n]+)["']?/);
                if (modelMatch) {
                    model = modelMatch[1].trim();
                }

                const nameMatch = frontmatter.match(/name:\s*["']?([^"'\n]+)["']?/);
                if (nameMatch && this.itemType === 'agent') {
                    agentName = nameMatch[1].trim();
                }

                // Parse new agent frontmatter fields
                if (this.itemType === 'agent') {
                    tools = this.parseYamlList(frontmatter, 'tools');
                    disallowedTools = this.parseYamlList(frontmatter, 'disallowedTools');
                    skills = this.parseYamlList(frontmatter, 'skills');
                    mcpServers = this.parseYamlList(frontmatter, 'mcpServers');

                    const permMatch = frontmatter.match(/permissionMode:\s*["']?([^"'\n]+)["']?/);
                    if (permMatch) {
                        permissionMode = permMatch[1].trim();
                    }

                    const turnsMatch = frontmatter.match(/maxTurns:\s*(\d+)/);
                    if (turnsMatch) {
                        maxTurns = parseInt(turnsMatch[1], 10);
                    }
                }
            }

            return {
                name: agentName || fileName,
                filePath,
                description,
                type: this.itemType as 'agent' | 'command',
                source,
                enabled,
                model,
                tools,
                disallowedTools,
                permissionMode,
                maxTurns,
                skills,
                mcpServers
            };
        } catch {
            return null;
        }
    }

    private parseYamlList(frontmatter: string, key: string): string[] | undefined {
        // Try inline format: key: [a, b, c]
        const inlineMatch = frontmatter.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
        if (inlineMatch) {
            const items = inlineMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean);
            return items.length > 0 ? items : undefined;
        }

        // Try multiline YAML list format:
        // key:
        //   - item1
        //   - item2
        const multilineMatch = frontmatter.match(new RegExp(`${key}:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`));
        if (multilineMatch) {
            const items = multilineMatch[1]
                .split('\n')
                .map(line => line.replace(/^\s*-\s*/, '').trim().replace(/["']/g, ''))
                .filter(Boolean);
            return items.length > 0 ? items : undefined;
        }

        return undefined;
    }
}

export class ClaudeItemNode extends vscode.TreeItem {
    constructor(
        public readonly item: ClaudeItem,
        private itemType: 'agent' | 'command' | 'skill' | 'team'
    ) {
        super(item.name, vscode.TreeItemCollapsibleState.None);

        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = item.enabled
            ? `${itemType}-enabled`
            : `${itemType}-disabled`;

        this.iconPath = this.getIcon();

        this.command = {
            command: this.getOpenCommand(),
            title: 'Open',
            arguments: [this]
        };
    }

    private getOpenCommand(): string {
        switch (this.itemType) {
            case 'agent': return 'claudeCodeManager.openAgent';
            case 'command': return 'claudeCodeManager.openCommand';
            case 'skill': return 'claudeCodeManager.openSkill';
            case 'team': return 'claudeCodeManager.openTeam';
        }
    }

    private buildTooltip(): string {
        let tooltip = `${this.item.name}`;
        tooltip += `\nType: ${this.itemType}`;
        tooltip += `\nStatus: ${this.item.enabled ? 'Enabled' : 'Disabled'}`;

        if (this.item.model) {
            tooltip += `\nModel: ${this.item.model}`;
        }
        if (this.item.description) {
            tooltip += `\n${this.item.description}`;
        }

        // Agent-specific fields
        if (this.item.tools && this.item.tools.length > 0) {
            tooltip += `\nTools: ${this.item.tools.join(', ')}`;
        }
        if (this.item.permissionMode) {
            tooltip += `\nPermission Mode: ${this.item.permissionMode}`;
        }
        if (this.item.maxTurns) {
            tooltip += `\nMax Turns: ${this.item.maxTurns}`;
        }
        if (this.item.skills && this.item.skills.length > 0) {
            tooltip += `\nSkills: ${this.item.skills.join(', ')}`;
        }
        if (this.item.mcpServers && this.item.mcpServers.length > 0) {
            tooltip += `\nMCP Servers: ${this.item.mcpServers.join(', ')}`;
        }

        // Skill-specific fields
        if (this.item.argumentHint) {
            tooltip += `\nArgument Hint: ${this.item.argumentHint}`;
        }
        if (this.item.userInvocable !== undefined) {
            tooltip += `\nUser Invocable: ${this.item.userInvocable}`;
        }
        if (this.item.allowedTools && this.item.allowedTools.length > 0) {
            tooltip += `\nAllowed Tools: ${this.item.allowedTools.join(', ')}`;
        }

        // Team-specific fields
        if (this.item.teamMembers && this.item.teamMembers.length > 0) {
            tooltip += `\nMembers: ${this.item.teamMembers.join(', ')}`;
        }

        tooltip += `\n\nSource: ${this.item.source === 'global' ? 'Global (~/.claude)' : 'Project (.claude)'}`;
        tooltip += `\nPath: ${this.item.filePath}`;
        return tooltip;
    }

    private buildDescription(): string {
        const parts: string[] = [];

        // Show model for agents
        if (this.itemType === 'agent' && this.item.model) {
            const modelIcon = this.getModelIcon(this.item.model);
            parts.push(`[${modelIcon}]`);
        }

        // Agent: show tool count + permissionMode
        if (this.itemType === 'agent') {
            const extras: string[] = [];
            if (this.item.tools && this.item.tools.length > 0) {
                extras.push(`${this.item.tools.length} tools`);
            }
            if (this.item.permissionMode) {
                extras.push(this.item.permissionMode);
            }
            if (extras.length > 0) {
                parts.push(`(${extras.join(', ')})`);
            }
        }

        // Skill: show argument-hint
        if (this.itemType === 'skill' && this.item.argumentHint) {
            parts.push(this.item.argumentHint);
        }

        // Team: show member count
        if (this.itemType === 'team' && this.item.teamMembers) {
            parts.push(`${this.item.teamMembers.length} member(s)`);
        }

        if (!this.item.enabled) {
            parts.push('(disabled)');
        }
        if (this.item.source === 'global') {
            parts.push('(global)');
        }
        if (this.item.description) {
            const maxLen = 25;
            parts.push(this.item.description.substring(0, maxLen) + (this.item.description.length > maxLen ? '...' : ''));
        }
        return parts.join(' ');
    }

    private getModelIcon(model: string): string {
        switch (model.toLowerCase()) {
            case 'opus':
                return 'opus';
            case 'haiku':
                return 'haiku';
            case 'sonnet':
            default:
                return 'sonnet';
        }
    }

    private getIcon(): vscode.ThemeIcon {
        if (!this.item.enabled) {
            const iconId = this.getIconId();
            return new vscode.ThemeIcon(iconId, new vscode.ThemeColor('disabledForeground'));
        }

        const iconId = this.getIconId();
        const color = this.item.source === 'global'
            ? new vscode.ThemeColor('charts.yellow')
            : new vscode.ThemeColor('charts.blue');

        return new vscode.ThemeIcon(iconId, color);
    }

    private getIconId(): string {
        switch (this.itemType) {
            case 'agent': return 'account';
            case 'command': return 'terminal';
            case 'skill': return 'symbol-method';
            case 'team': return 'organization';
        }
    }
}
