---
name: add-command
description: Add a new VS Code command to the extension
argument-hint: "[command-id] [title]"
user-invocable: true
model: sonnet
---

Add a new VS Code command to the CC-Agent Manager extension.

## Steps

1. **Read current state** - Read `package.json`, `src/extension.ts`, and `src/services/ClaudeCodeService.ts` to understand existing patterns.

2. **package.json** - Add the command to `contributes.commands`:
      { "command": "cc-agent-manager.<command-id>", "title": "<Title>", "icon": "$(symbol-misc)" }
      If it appears in a tree view context menu, also add it to `contributes.menus`.

3. **ClaudeCodeService.ts** - Add the implementation method. Follow the existing async method pattern, use `vscode.window.showErrorMessage` for errors and `vscode.window.showInformationMessage` for success.

4. **extension.ts** - Register the command inside `activate()`:
      vscode.commands.registerCommand('cc-agent-manager.<command-id>', async (item) => {
     await claudeService.<methodName>(item);
   });
      Push the disposable to `context.subscriptions`.

5. **Refresh** - If the command mutates tree data, call the appropriate provider's `refresh()` after the service call.

## Notes
- Command IDs must match exactly between package.json and registerCommand
- Tree item commands also need `command` set on the TreeItem object in the provider