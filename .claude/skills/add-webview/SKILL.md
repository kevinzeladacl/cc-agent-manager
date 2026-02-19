---
name: add-webview
description: Create a new webview panel following the MetricsDashboard pattern
argument-hint: "[PanelName]"
user-invocable: true
model: sonnet
---

Create a new webview panel for the CC-Agent Manager extension.

## Steps

1. **Read existing webview** - Read `src/webview/MetricsDashboard.ts` in full to understand the current pattern (static `createOrShow`, panel lifecycle, `_getHtmlForWebview`, message passing).

2. **Create `src/webview/<PanelName>.ts`** with this structure:
   - `static currentPanel: <PanelName> | undefined`
   - `static createOrShow(extensionUri, data)` — reuse existing panel or create new
   - `_panel.webview.onDidReceiveMessage` for JS→extension messages
   - `_getHtmlForWebview()` returning a complete HTML string with:
     - Strict CSP: `default-src 'none'; script-src 'nonce-...'; style-src 'unsafe-inline'`
     - `acquireVsCodeApi()` for postMessage back
   - `dispose()` cleaning up all disposables

3. **Register a command** in `extension.ts` that calls `<PanelName>.createOrShow(context.extensionUri, data)`. Use the `add-command` skill if needed.

4. **Add to package.json** `contributes.commands` with an appropriate icon.

## CSP nonce pattern
const nonce = Math.random().toString(36).slice(2);
// Use in: <script nonce="${nonce}"> and CSP header

## Notes
- Never use `eval` or inline event handlers; keep all JS in the nonce-tagged script block
- Prefer embedding data as a JSON literal assigned to a `const` rather than postMessage on load