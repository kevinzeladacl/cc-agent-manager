import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type NodeType = 'category' | 'folder' | 'file';

export class MarkdownTreeProvider implements vscode.TreeDataProvider<MarkdownNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<MarkdownNode | undefined | null | void> = new vscode.EventEmitter<MarkdownNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<MarkdownNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private static readonly EXCLUDED_DIRS = new Set([
        'node_modules', '.git', 'out', 'dist', '.next', '.nuxt',
        'build', 'coverage', '.vscode', '.idea', '__pycache__',
        'vendor', '.cache', '.output'
    ]);

    private static readonly PROJECT_FILES = new Set([
        'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md',
        'CODE_OF_CONDUCT.md', 'SECURITY.md', 'AUTHORS.md'
    ]);

    private static readonly DOC_DIRS = new Set([
        'docs', 'documentation', 'wiki', 'guides', 'doc'
    ]);

    constructor(private workspaceRoot: string | undefined) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MarkdownNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: MarkdownNode): Promise<MarkdownNode[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        if (!element) {
            return this.getRootCategories();
        }

        if (element.nodeType === 'category') {
            return this.getCategoryChildren(element);
        }

        if (element.nodeType === 'folder') {
            return this.getFolderChildren(element.resourcePath);
        }

        return [];
    }

    private getRootCategories(): MarkdownNode[] {
        const categories: MarkdownNode[] = [];

        const claudeCodeChildren = this.getClaudeCodeItems();
        if (claudeCodeChildren.length > 0) {
            categories.push(new MarkdownNode(
                'Claude Code',
                '',
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                'claude-code'
            ));
        }

        const projectChildren = this.getProjectItems();
        if (projectChildren.length > 0) {
            categories.push(new MarkdownNode(
                'Project',
                '',
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                'project'
            ));
        }

        const docChildren = this.getDocumentationItems();
        if (docChildren.length > 0) {
            categories.push(new MarkdownNode(
                'Documentation',
                '',
                vscode.TreeItemCollapsibleState.Collapsed,
                'category',
                'documentation'
            ));
        }

        const otherChildren = this.getOtherItems();
        if (otherChildren.length > 0) {
            categories.push(new MarkdownNode(
                'Other',
                '',
                vscode.TreeItemCollapsibleState.Collapsed,
                'category',
                'other'
            ));
        }

        return categories;
    }

    private getCategoryChildren(element: MarkdownNode): MarkdownNode[] {
        switch (element.categoryId) {
            case 'claude-code': return this.getClaudeCodeItems();
            case 'project': return this.getProjectItems();
            case 'documentation': return this.getDocumentationItems();
            case 'other': return this.getOtherItems();
            default: return [];
        }
    }

    private getClaudeCodeItems(): MarkdownNode[] {
        if (!this.workspaceRoot) return [];
        const items: MarkdownNode[] = [];

        // CLAUDE.md at workspace root
        const claudeMd = path.join(this.workspaceRoot, 'CLAUDE.md');
        if (fs.existsSync(claudeMd)) {
            items.push(new MarkdownNode(
                'CLAUDE.md',
                claudeMd,
                vscode.TreeItemCollapsibleState.None,
                'file'
            ));
        }

        const claudeDir = path.join(this.workspaceRoot, '.claude');
        if (!fs.existsSync(claudeDir)) return items;

        // settings.json
        const settingsJson = path.join(claudeDir, 'settings.json');
        if (fs.existsSync(settingsJson)) {
            items.push(new MarkdownNode(
                'settings.json',
                settingsJson,
                vscode.TreeItemCollapsibleState.None,
                'file'
            ));
        }

        // .claude subdirectories that may contain .md files
        const subfolders = [
            'agents', 'agents-disabled',
            'commands', 'commands-disabled',
            'skills', 'skills-disabled'
        ];

        try {
            const entries = fs.readdirSync(claudeDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (!subfolders.includes(entry.name)) continue;

                const fullPath = path.join(claudeDir, entry.name);
                if (this.hasRelevantFiles(fullPath)) {
                    items.push(new MarkdownNode(
                        entry.name,
                        fullPath,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'folder'
                    ));
                }
            }
        } catch {
            // ignore
        }

        return items;
    }

    private getProjectItems(): MarkdownNode[] {
        if (!this.workspaceRoot) return [];
        const items: MarkdownNode[] = [];

        for (const fileName of MarkdownTreeProvider.PROJECT_FILES) {
            const filePath = path.join(this.workspaceRoot, fileName);
            if (fs.existsSync(filePath)) {
                items.push(new MarkdownNode(
                    fileName,
                    filePath,
                    vscode.TreeItemCollapsibleState.None,
                    'file'
                ));
            }
        }

        return items;
    }

    private getDocumentationItems(): MarkdownNode[] {
        if (!this.workspaceRoot) return [];
        const items: MarkdownNode[] = [];

        try {
            const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (!MarkdownTreeProvider.DOC_DIRS.has(entry.name.toLowerCase())) continue;

                const fullPath = path.join(this.workspaceRoot, entry.name);
                if (this.hasMarkdownFiles(fullPath)) {
                    items.push(new MarkdownNode(
                        entry.name,
                        fullPath,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'folder'
                    ));
                }
            }
        } catch {
            // ignore
        }

        return items;
    }

    private getOtherItems(): MarkdownNode[] {
        if (!this.workspaceRoot) return [];
        return this.scanOtherMarkdown(this.workspaceRoot);
    }

    private scanOtherMarkdown(dirPath: string): MarkdownNode[] {
        const items: MarkdownNode[] = [];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const folders: { name: string; fullPath: string }[] = [];
            const files: { name: string; fullPath: string }[] = [];

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    // Skip excluded dirs
                    if (MarkdownTreeProvider.EXCLUDED_DIRS.has(entry.name)) continue;
                    // Skip .claude (already in Claude Code category)
                    if (entry.name === '.claude') continue;
                    // Skip hidden dirs
                    if (entry.name.startsWith('.')) continue;
                    // Skip doc dirs at workspace root (already in Documentation category)
                    if (dirPath === this.workspaceRoot && MarkdownTreeProvider.DOC_DIRS.has(entry.name.toLowerCase())) continue;

                    if (this.hasMarkdownFiles(fullPath)) {
                        folders.push({ name: entry.name, fullPath });
                    }
                } else if (entry.name.endsWith('.md')) {
                    // Skip project files at workspace root (already in Project category)
                    if (dirPath === this.workspaceRoot && MarkdownTreeProvider.PROJECT_FILES.has(entry.name)) continue;
                    // Skip CLAUDE.md at workspace root (already in Claude Code category)
                    if (dirPath === this.workspaceRoot && entry.name === 'CLAUDE.md') continue;

                    files.push({ name: entry.name, fullPath });
                }
            }

            folders.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));

            for (const folder of folders) {
                items.push(new MarkdownNode(
                    folder.name,
                    folder.fullPath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'folder'
                ));
            }

            for (const file of files) {
                items.push(new MarkdownNode(
                    file.name,
                    file.fullPath,
                    vscode.TreeItemCollapsibleState.None,
                    'file'
                ));
            }
        } catch {
            // ignore
        }

        return items;
    }

    private getFolderChildren(dirPath: string): MarkdownNode[] {
        if (!fs.existsSync(dirPath)) return [];

        const items: MarkdownNode[] = [];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const folders: { name: string; fullPath: string }[] = [];
            const files: { name: string; fullPath: string }[] = [];

            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;
                if (MarkdownTreeProvider.EXCLUDED_DIRS.has(entry.name) && entry.isDirectory()) continue;

                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    if (this.hasRelevantFiles(fullPath)) {
                        folders.push({ name: entry.name, fullPath });
                    }
                } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
                    files.push({ name: entry.name, fullPath });
                }
            }

            folders.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));

            for (const folder of folders) {
                items.push(new MarkdownNode(
                    folder.name,
                    folder.fullPath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'folder'
                ));
            }

            for (const file of files) {
                items.push(new MarkdownNode(
                    file.name,
                    file.fullPath,
                    vscode.TreeItemCollapsibleState.None,
                    'file'
                ));
            }
        } catch {
            // ignore
        }

        return items;
    }

    private hasMarkdownFiles(dirPath: string): boolean {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.endsWith('.md') && !entry.isDirectory()) return true;
                if (entry.isDirectory()
                    && !MarkdownTreeProvider.EXCLUDED_DIRS.has(entry.name)
                    && !entry.name.startsWith('.')) {
                    if (this.hasMarkdownFiles(path.join(dirPath, entry.name))) return true;
                }
            }
        } catch {
            // ignore
        }
        return false;
    }

    private hasRelevantFiles(dirPath: string): boolean {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) return true;
                if (entry.isDirectory()
                    && !MarkdownTreeProvider.EXCLUDED_DIRS.has(entry.name)
                    && !entry.name.startsWith('.')) {
                    if (this.hasRelevantFiles(path.join(dirPath, entry.name))) return true;
                }
            }
        } catch {
            // ignore
        }
        return false;
    }
}

export class MarkdownNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourcePath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly nodeType: NodeType,
        public readonly categoryId?: string
    ) {
        super(label, collapsibleState);

        switch (nodeType) {
            case 'category':
                this.contextValue = 'markdown-category';
                this.setCategoryIcon(categoryId);
                break;
            case 'folder':
                this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
                this.contextValue = 'markdown-folder';
                break;
            case 'file':
                this.setFileIcon(label);
                this.contextValue = 'markdown-file';
                this.tooltip = resourcePath;
                this.command = {
                    command: 'claudeCodeManager.openMarkdown',
                    title: 'Open File',
                    arguments: [this]
                };
                break;
        }
    }

    private setCategoryIcon(categoryId?: string): void {
        switch (categoryId) {
            case 'claude-code':
                this.iconPath = new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('charts.blue'));
                break;
            case 'project':
                this.iconPath = new vscode.ThemeIcon('home', new vscode.ThemeColor('charts.green'));
                break;
            case 'documentation':
                this.iconPath = new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.purple'));
                break;
            case 'other':
                this.iconPath = new vscode.ThemeIcon('file');
                break;
        }
    }

    private setFileIcon(label: string): void {
        if (label.endsWith('.json')) {
            this.iconPath = new vscode.ThemeIcon('settings-gear', new vscode.ThemeColor('charts.yellow'));
        } else {
            this.iconPath = new vscode.ThemeIcon('markdown', new vscode.ThemeColor('charts.purple'));
        }
    }
}
