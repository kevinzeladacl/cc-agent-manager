---
description: Compile and package the VS Code extension into a .vsix file
---

# build-ext Command

Compile the TypeScript source and package the extension:

1. Run `npm run compile` and fix any TypeScript errors before proceeding
2. Check the version in `package.json`
3. Run `vsce package` to produce the `.vsix` file
4. Confirm the output file name matches the version (e.g. `cc-agent-manager-X.Y.Z.vsix`)
5. Report any warnings from the packaging step

Do not bump the version — just build what is currently in `package.json`.