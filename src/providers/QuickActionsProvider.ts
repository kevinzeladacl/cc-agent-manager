import * as vscode from 'vscode';

export class QuickActionsProvider implements vscode.TreeDataProvider<QuickActionNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickActionNode | undefined | null | void> = new vscode.EventEmitter<QuickActionNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickActionNode | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QuickActionNode): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<QuickActionNode[]> {
        return [
            new QuickActionNode(
                'AutoGenerate',
                'Init + suggest agents, commands & skills',
                'claudeCodeManager.autoGenerate',
                'sparkle'
            ),
            new QuickActionNode(
                'Update CLAUDE.md',
                'Regenerate CLAUDE.md with AI analysis',
                'claudeCodeManager.updateClaudeMd',
                'file-text'
            )
        ];
    }
}

export class QuickActionNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        commandId: string,
        icon: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor('charts.blue'));
        this.tooltip = description;
        this.command = {
            command: commandId,
            title: label,
            arguments: []
        };
    }
}
