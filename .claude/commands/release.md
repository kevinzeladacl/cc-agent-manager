---
description: Prepare a new release of the CC-Agent Manager extension
argument-hint: <semver bump: patch|minor|major>
---

# release Command

Prepare a release build:

1. Read `package.json` and show the current version
2. Calculate the new version based on the requested bump (`$ARGUMENTS`)
3. Update the `version` field in `package.json`
4. Run `npm run compile` — stop and report errors if it fails
5. Run `vsce package` to produce `cc-agent-manager-<new-version>.vsix`
6. Print a summary: old version → new version, output file path, file size

Do NOT commit or push. Leave that for the user to review first.