import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ClaudeItem {
    name: string;
    filePath: string;
    description?: string;
    type: 'agent' | 'command';
    source: 'project' | 'global';
    enabled: boolean;
    model?: string;
}

export class ClaudeTreeProvider implements vscode.TreeDataProvider<ClaudeItemNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ClaudeItemNode | undefined | null | void> = new vscode.EventEmitter<ClaudeItemNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ClaudeItemNode | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private workspaceRoot: string | undefined,
        private itemType: 'agent' | 'command'
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

            // Parse YAML frontmatter
            let description = '';
            let model: string | undefined;
            let agentName: string | undefined;

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
            }

            return {
                name: agentName || fileName,
                filePath,
                description,
                type: this.itemType,
                source,
                enabled,
                model
            };
        } catch {
            return null;
        }
    }
}

export class ClaudeItemNode extends vscode.TreeItem {
    constructor(
        public readonly item: ClaudeItem,
        private itemType: 'agent' | 'command'
    ) {
        super(item.name, vscode.TreeItemCollapsibleState.None);

        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = item.enabled
            ? `${itemType}-enabled`
            : `${itemType}-disabled`;

        // Set icon based on type, source, and enabled state
        this.iconPath = this.getIcon();

        // Make item clickable to open file
        this.command = {
            command: itemType === 'agent'
                ? 'claudeCodeManager.openAgent'
                : 'claudeCodeManager.openCommand',
            title: 'Open',
            arguments: [this]
        };
    }

    private buildTooltip(): string {
        let tooltip = `${this.item.name}`;
        tooltip += `\nStatus: ${this.item.enabled ? 'Enabled' : 'Disabled'}`;
        if (this.item.model) {
            tooltip += `\nModel: ${this.item.model}`;
        }
        if (this.item.description) {
            tooltip += `\n${this.item.description}`;
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
            // Disabled items get a dimmed icon
            return this.itemType === 'agent'
                ? new vscode.ThemeIcon('account', new vscode.ThemeColor('disabledForeground'))
                : new vscode.ThemeIcon('terminal', new vscode.ThemeColor('disabledForeground'));
        }

        if (this.itemType === 'agent') {
            return this.item.source === 'global'
                ? new vscode.ThemeIcon('account', new vscode.ThemeColor('charts.yellow'))
                : new vscode.ThemeIcon('account', new vscode.ThemeColor('charts.blue'));
        } else {
            return this.item.source === 'global'
                ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('charts.yellow'))
                : new vscode.ThemeIcon('terminal', new vscode.ThemeColor('charts.blue'));
        }
    }
}
