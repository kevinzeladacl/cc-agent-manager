---
description: Scaffold a new TreeDataProvider and register it in extension.ts
argument-hint: <ProviderName> <viewId>
---

# add-provider Command

Create a new VS Code sidebar tree provider.

Steps:
1. Read `src/providers/ClaudeTreeProvider.ts` to understand the existing pattern
2. Read `src/extension.ts` to see how providers are registered
3. Create `src/providers/$ARGUMENTSTreeProvider.ts` following the same structure:
   - Implement `vscode.TreeDataProvider<T>`
   - Export the class
4. Register the new provider in `src/extension.ts` under the correct view ID
5. If a new view is needed, remind the user to add it to `package.json` under `contributes.views`