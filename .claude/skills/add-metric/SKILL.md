---
name: add-metric
description: Add a new metric type to MetricsService, tree view, and dashboard
argument-hint: "[metric-name]"
user-invocable: true
model: sonnet
---

Add a new usage metric to the CC-Agent Manager extension.

## Steps

1. **Read the data layer** - Read `src/services/MetricsService.ts` to understand where Claude Code usage data lives (typically `~/.claude/usage.json` or similar) and what the return types look like.

2. **MetricsService.ts** - Add a new method or extend an existing return type to expose the new data. Keep it a pure data transform — no VS Code API calls here.

3. **MetricsTreeProvider.ts** - Read `src/providers/MetricsTreeProvider.ts`. Add a new `TreeItem` (or child items under an existing section) that calls the new service method. Follow the existing label/description/tooltip pattern.

4. **MetricsDashboard.ts** - Read `src/webview/MetricsDashboard.ts`. Add the metric to:
   - The data object passed into `_getHtmlForWebview()`
   - The HTML template (a new card, chart section, or table row)
   - Any JS chart initialization if visualisation is needed

5. **Refresh** - Ensure `MetricsTreeProvider.refresh()` is called wherever metrics data is invalidated (e.g., after a session ends or on the existing refresh command).

## Notes
- Keep MetricsService free of VS Code dependencies so it stays testable
- Tree labels should be short; put verbose breakdowns in the tooltip
- Dashboard charts use inline `<canvas>` + vanilla JS — no external CDN (CSP blocks it)