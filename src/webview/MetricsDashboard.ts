import * as vscode from 'vscode';
import { MetricsService, GlobalStats, ProjectBreakdownEntry } from '../services/MetricsService';

export class MetricsDashboard {
    private panel: vscode.WebviewPanel | undefined;
    private metricsService: MetricsService;
    private workspaceRoot: string | undefined;

    constructor(workspaceRoot: string | undefined) {
        this.workspaceRoot = workspaceRoot;
        this.metricsService = new MetricsService();
    }

    show() {
        if (this.panel) {
            this.panel.reveal();
            this.panel.webview.html = this.getHtml();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'claudeMetricsDashboard',
            'Claude Code Metrics',
            vscode.ViewColumn.One,
            { enableScripts: false }
        );

        this.panel.webview.html = this.getHtml();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private getHtml(): string {
        const stats = this.metricsService.getGlobalStats();
        const recentActivity = this.metricsService.getRecentActivity(30);
        const projectBreakdown = this.metricsService.getProjectBreakdown();
        const projectStats = this.workspaceRoot
            ? this.metricsService.getProjectStats(this.workspaceRoot)
            : null;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Code Metrics</title>
<style>
    body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 20px;
        margin: 0;
    }
    h1 {
        font-size: 1.6em;
        margin-bottom: 4px;
        color: var(--vscode-foreground);
    }
    h2 {
        font-size: 1.2em;
        margin-top: 24px;
        margin-bottom: 12px;
        color: var(--vscode-foreground);
        border-bottom: 1px solid var(--vscode-widget-border);
        padding-bottom: 4px;
    }
    .subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
        margin-bottom: 20px;
    }
    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-bottom: 24px;
    }
    .stat-card {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        padding: 16px;
        text-align: center;
    }
    .stat-value {
        font-size: 1.8em;
        font-weight: bold;
        color: var(--vscode-textLink-foreground);
    }
    .stat-label {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
    }
    .chart-container {
        margin-bottom: 24px;
    }
    .bar-chart {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 120px;
        border-bottom: 1px solid var(--vscode-widget-border);
        padding-bottom: 4px;
    }
    .bar-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
    }
    .bar {
        width: 100%;
        background: var(--vscode-textLink-foreground);
        border-radius: 2px 2px 0 0;
        min-height: 1px;
        transition: opacity 0.2s;
    }
    .bar:hover {
        opacity: 0.8;
    }
    .bar-label {
        font-size: 0.6em;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
        writing-mode: vertical-rl;
        text-orientation: mixed;
        max-height: 50px;
        overflow: hidden;
    }
    .model-bars {
        margin-bottom: 16px;
    }
    .model-row {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
        gap: 8px;
    }
    .model-name {
        width: 120px;
        font-size: 0.85em;
        text-align: right;
        flex-shrink: 0;
    }
    .model-bar-track {
        flex: 1;
        height: 20px;
        background: var(--vscode-editorWidget-background);
        border-radius: 4px;
        overflow: hidden;
    }
    .model-bar-fill {
        height: 100%;
        background: var(--vscode-textLink-foreground);
        border-radius: 4px;
    }
    .model-value {
        width: 100px;
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }
    .hour-chart {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .hour-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .hour-label {
        width: 50px;
        font-size: 0.85em;
        text-align: right;
        flex-shrink: 0;
    }
    .hour-bar-track {
        flex: 1;
        height: 16px;
        background: var(--vscode-editorWidget-background);
        border-radius: 3px;
        overflow: hidden;
    }
    .hour-bar-fill {
        height: 100%;
        background: var(--vscode-charts-green);
        border-radius: 3px;
    }
    .hour-value {
        width: 80px;
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85em;
    }
    th, td {
        padding: 6px 12px;
        text-align: left;
        border-bottom: 1px solid var(--vscode-widget-border);
    }
    th {
        color: var(--vscode-descriptionForeground);
        font-weight: 600;
    }
    td.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .no-data {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        padding: 12px 0;
    }
</style>
</head>
<body>
    <h1>Claude Code Metrics</h1>
    <p class="subtitle">Usage statistics from ~/.claude</p>

    ${this.renderStatsCards(stats, projectStats)}
    ${this.renderActivityChart(recentActivity)}
    ${this.renderModelBreakdown(stats)}
    ${this.renderPeakHours(stats)}
    ${this.renderProjectBreakdown(projectBreakdown)}
</body>
</html>`;
    }

    private renderStatsCards(stats: GlobalStats | null, projectStats: { sessions: number; messages: number } | null): string {
        if (!stats) {
            return '<p class="no-data">No stats data found. Stats are generated by Claude Code at ~/.claude/stats-cache.json</p>';
        }

        let cards = `
    <h2>Session Stats</h2>
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">${this.metricsService.formatNumber(stats.totalSessions)}</div>
            <div class="stat-label">Total Sessions</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${this.metricsService.formatNumber(stats.totalMessages)}</div>
            <div class="stat-label">Total Messages</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.longestSession}</div>
            <div class="stat-label">Longest Session (msgs)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.firstSessionDate || 'N/A'}</div>
            <div class="stat-label">Active Since</div>
        </div>`;

        if (projectStats) {
            cards += `
        <div class="stat-card">
            <div class="stat-value">${this.metricsService.formatNumber(projectStats.sessions)}</div>
            <div class="stat-label">This Project Sessions</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${this.metricsService.formatNumber(projectStats.messages)}</div>
            <div class="stat-label">This Project Messages</div>
        </div>`;
        }

        cards += '</div>';
        return cards;
    }

    private renderActivityChart(recentActivity: { date: string; messageCount: number; toolCallCount: number }[]): string {
        if (recentActivity.length === 0) {
            return '<h2>Daily Activity (Last 30 Days)</h2><p class="no-data">No daily activity data</p>';
        }

        const maxMessages = Math.max(...recentActivity.map(d => d.messageCount), 1);

        // Show newest on the right
        const days = [...recentActivity].reverse();

        const bars = days.map(d => {
            const height = Math.max(1, Math.round((d.messageCount / maxMessages) * 110));
            const dateShort = d.date.slice(5); // MM-DD
            return `<div class="bar-col" title="${d.date}: ${d.messageCount.toLocaleString()} msgs, ${d.toolCallCount.toLocaleString()} tools">
                <div class="bar" style="height: ${height}px;"></div>
                <div class="bar-label">${dateShort}</div>
            </div>`;
        }).join('');

        return `
    <h2>Daily Activity (Last 30 Days)</h2>
    <div class="chart-container">
        <div class="bar-chart">${bars}</div>
    </div>`;
    }

    private renderModelBreakdown(stats: GlobalStats | null): string {
        if (!stats || !stats.modelUsage || Object.keys(stats.modelUsage).length === 0) {
            return '<h2>Model Breakdown</h2><p class="no-data">No model usage data</p>';
        }

        const models = Object.entries(stats.modelUsage)
            .map(([id, tokens]) => ({
                name: this.metricsService.formatModelName(id),
                output: tokens.outputTokens,
                input: tokens.inputTokens
            }))
            .sort((a, b) => b.output - a.output);

        const maxTokens = Math.max(...models.map(m => m.output), 1);

        const rows = models.map(m => {
            const pct = Math.round((m.output / maxTokens) * 100);
            return `<div class="model-row">
                <div class="model-name">${this.escapeHtml(m.name)}</div>
                <div class="model-bar-track">
                    <div class="model-bar-fill" style="width: ${pct}%;"></div>
                </div>
                <div class="model-value">${this.metricsService.formatNumber(m.output)} out</div>
            </div>`;
        }).join('');

        return `<h2>Model Breakdown</h2><div class="model-bars">${rows}</div>`;
    }

    private renderPeakHours(stats: GlobalStats | null): string {
        if (!stats || !stats.hourCounts || Object.keys(stats.hourCounts).length === 0) {
            return '<h2>Peak Hours</h2><p class="no-data">No hourly data</p>';
        }

        const hours = Object.entries(stats.hourCounts)
            .map(([h, count]) => ({ hour: h, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const maxCount = Math.max(...hours.map(h => h.count), 1);

        const rows = hours.map(h => {
            const pct = Math.round((h.count / maxCount) * 100);
            const label = h.hour.padStart(2, '0') + ':00';
            return `<div class="hour-row">
                <div class="hour-label">${label}</div>
                <div class="hour-bar-track">
                    <div class="hour-bar-fill" style="width: ${pct}%;"></div>
                </div>
                <div class="hour-value">${h.count} sessions</div>
            </div>`;
        }).join('');

        return `<h2>Peak Hours</h2><div class="hour-chart">${rows}</div>`;
    }

    private renderProjectBreakdown(projects: ProjectBreakdownEntry[]): string {
        if (projects.length === 0) {
            return '<h2>Project Breakdown</h2><p class="no-data">No project data from history</p>';
        }

        const top = projects.slice(0, 15);

        const rows = top.map(p => {
            const name = p.project.split('/').slice(-2).join('/') || p.project;
            return `<tr>
                <td title="${this.escapeHtml(p.project)}">${this.escapeHtml(name)}</td>
                <td class="num">${p.sessions.toLocaleString()}</td>
                <td class="num">${p.messages.toLocaleString()}</td>
            </tr>`;
        }).join('');

        return `
    <h2>Project Breakdown</h2>
    <table>
        <thead>
            <tr><th>Project</th><th>Sessions</th><th>Messages</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
