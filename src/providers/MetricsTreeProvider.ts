import * as vscode from 'vscode';
import * as path from 'path';
import { MetricsService } from '../services/MetricsService';

export class MetricsNode extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly category?: string,
        public readonly children?: MetricsNode[]
    ) {
        super(label, collapsibleState);
    }
}

export class MetricsTreeProvider implements vscode.TreeDataProvider<MetricsNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MetricsNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private metricsService: MetricsService;
    private workspaceRoot: string | undefined;

    constructor(workspaceRoot: string | undefined) {
        this.workspaceRoot = workspaceRoot;
        this.metricsService = new MetricsService();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MetricsNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: MetricsNode): Promise<MetricsNode[]> {
        if (element && element.children) {
            return element.children;
        }

        if (element) {
            return [];
        }

        const stats = this.metricsService.getGlobalStats();
        const nodes: MetricsNode[] = [];

        // This Project section (expanded, first)
        if (this.workspaceRoot) {
            nodes.push(this.buildProjectSection());
        }

        // Global Claude Usage section
        nodes.push(this.buildGlobalSection(stats));

        // Model Usage section
        nodes.push(this.buildModelUsageSection(stats));

        // Recent Activity (global)
        nodes.push(this.buildRecentActivitySection());

        // Peak Hours (global)
        nodes.push(this.buildPeakHoursSection(stats));

        return nodes;
    }

    private buildProjectSection(): MetricsNode {
        const children: MetricsNode[] = [];
        const projectStats = this.metricsService.getProjectStats(this.workspaceRoot!);
        const projectName = path.basename(this.workspaceRoot!);

        children.push(this.createLeaf(
            `Sessions: ${this.metricsService.formatNumber(projectStats.sessions)}`,
            '$(terminal)'
        ));
        children.push(this.createLeaf(
            `Messages: ${this.metricsService.formatNumber(projectStats.messages)}`,
            '$(comment)'
        ));

        const node = new MetricsNode(
            `This Project (${projectName})`,
            vscode.TreeItemCollapsibleState.Expanded,
            'project',
            children
        );
        node.iconPath = new vscode.ThemeIcon('folder-active');
        return node;
    }

    private buildGlobalSection(stats: ReturnType<MetricsService['getGlobalStats']>): MetricsNode {
        const children: MetricsNode[] = [];

        if (stats) {
            children.push(this.createLeaf(
                `Total Sessions: ${this.metricsService.formatNumber(stats.totalSessions)}`,
                '$(terminal)'
            ));
            children.push(this.createLeaf(
                `Total Messages: ${this.metricsService.formatNumber(stats.totalMessages)}`,
                '$(comment)'
            ));
            if (stats.firstSessionDate) {
                children.push(this.createLeaf(
                    `Active Since: ${this.metricsService.formatDate(stats.firstSessionDate)}`,
                    '$(calendar)'
                ));
            }
            if (stats.longestSession > 0) {
                children.push(this.createLeaf(
                    `Longest Session: ${this.metricsService.formatNumber(stats.longestSession)} messages`,
                    '$(flame)'
                ));
            }
        } else {
            children.push(this.createLeaf('No stats data found', '$(warning)'));
        }

        const node = new MetricsNode(
            'Global (All Claude Usage)',
            vscode.TreeItemCollapsibleState.Collapsed,
            'global',
            children
        );
        node.iconPath = new vscode.ThemeIcon('globe');
        return node;
    }

    private buildModelUsageSection(stats: ReturnType<MetricsService['getGlobalStats']>): MetricsNode {
        const children: MetricsNode[] = [];

        if (stats && stats.modelUsage) {
            const models = Object.entries(stats.modelUsage)
                .sort(([, a], [, b]) => b.outputTokens - a.outputTokens);

            for (const [modelId, tokens] of models) {
                const name = this.metricsService.formatModelName(modelId);
                const output = this.metricsService.formatNumber(tokens.outputTokens);
                children.push(this.createLeaf(
                    `${name}: ${output} output tokens`,
                    '$(symbol-enum)'
                ));
            }
        }

        if (children.length === 0) {
            children.push(this.createLeaf('No model data', '$(info)'));
        }

        const node = new MetricsNode(
            'Model Usage',
            vscode.TreeItemCollapsibleState.Collapsed,
            'models',
            children
        );
        node.iconPath = new vscode.ThemeIcon('symbol-enum');
        return node;
    }

    private buildRecentActivitySection(): MetricsNode {
        const children: MetricsNode[] = [];
        const recent = this.metricsService.getRecentActivity(7);

        for (const day of recent) {
            const msgs = this.metricsService.formatNumber(day.messageCount);
            const tools = this.metricsService.formatNumber(day.toolCallCount);
            children.push(this.createLeaf(
                `${day.date}: ${msgs} msgs, ${tools} tools`,
                '$(calendar)'
            ));
        }

        if (children.length === 0) {
            children.push(this.createLeaf('No recent activity', '$(info)'));
        }

        const node = new MetricsNode(
            'Recent Activity (Global)',
            vscode.TreeItemCollapsibleState.Collapsed,
            'recent',
            children
        );
        node.iconPath = new vscode.ThemeIcon('calendar');
        return node;
    }

    private buildPeakHoursSection(stats: ReturnType<MetricsService['getGlobalStats']>): MetricsNode {
        const children: MetricsNode[] = [];

        if (stats && stats.hourCounts) {
            const hours = Object.entries(stats.hourCounts)
                .map(([hour, count]) => ({ hour, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            for (const { hour, count } of hours) {
                const hourStr = hour.padStart(2, '0') + ':00';
                children.push(this.createLeaf(
                    `${hourStr} - ${count} sessions`,
                    '$(clock)'
                ));
            }
        }

        if (children.length === 0) {
            children.push(this.createLeaf('No hourly data', '$(info)'));
        }

        const node = new MetricsNode(
            'Peak Hours (Global)',
            vscode.TreeItemCollapsibleState.Collapsed,
            'peakhours',
            children
        );
        node.iconPath = new vscode.ThemeIcon('clock');
        return node;
    }

    private createLeaf(label: string, iconId: string): MetricsNode {
        const node = new MetricsNode(label, vscode.TreeItemCollapsibleState.None);
        node.iconPath = new vscode.ThemeIcon(iconId);
        return node;
    }
}
