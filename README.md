# CC-Agent Manager

A Visual Studio Code extension to manage Claude Code agents and commands directly from the sidebar.

## Features

### Agent Management
- **View Agents** - See all Claude Code agents in a dedicated tree view
- **Enable/Disable** - Toggle agents on/off without deleting them
- **Change Model** - Switch between Opus, Sonnet, and Haiku models per agent
- **Create New** - Create agents with ready-to-use templates

### Command Management
- **View Commands** - See all Claude Code slash commands
- **Enable/Disable** - Toggle commands on/off
- **Create New** - Create commands with templates

### Auto Context
- **Scan Documentation** - Automatically reads all `.md` files in your project
- **Update Agents** - Inject project context into existing agents
- **Suggest Agents** - Get AI-powered suggestions for new agents based on your docs

### Additional Features
- **Dual Support** - Shows both project-level (`.claude/`) and global (`~/.claude/`) items
- **Quick Edit** - Click any item to open for editing
- **Visual Indicators** - See model type, enabled status, and source at a glance

## Installation

### From VS Code Marketplace
Search for "CC-Agent Manager" in the Extensions view.

### From VSIX
1. Download the `.vsix` file from [Releases](https://github.com/kevinzeladacl/cc-agent-manager/releases)
2. In VS Code: Extensions > `...` > Install from VSIX

### From Source
```bash
git clone https://github.com/kevinzeladacl/cc-agent-manager.git
cd cc-agent-manager
npm install
npm run compile
npx @vscode/vsce package
```

## Usage

1. Open a project with a `.claude` folder (or Claude Code configured globally)
2. Click the Claude Code icon in the Activity Bar (left sidebar)
3. Expand **Agents** or **Commands** sections
4. Use toolbar buttons:
   - **Auto Context** - Scan docs and update agents
   - **+** - Create new agent/command
   - **Refresh** - Reload the list

### Item Actions
- **Click** - Open file for editing
- **Model icon** - Change AI model (agents only)
- **Enable/Disable** - Toggle item state
- **Right-click** - Context menu with all options

## File Locations

| Type | Project Level | Global Level |
|------|--------------|--------------|
| Agents | `.claude/agents/*.md` | `~/.claude/agents/*.md` |
| Commands | `.claude/commands/*.md` | `~/.claude/commands/*.md` |
| Disabled Agents | `.claude/agents-disabled/*.md` | `~/.claude/agents-disabled/*.md` |
| Disabled Commands | `.claude/commands-disabled/*.md` | `~/.claude/commands-disabled/*.md` |

## Requirements

- Visual Studio Code 1.85.0 or higher
- Claude Code CLI installed and configured

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
