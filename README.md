# CC-Agent Manager

A Visual Studio Code extension to manage Claude Code agents, commands, skills, and usage metrics directly from the sidebar.

## Features

### Agent Management
- **View Agents** - See all Claude Code agents in a dedicated tree view
- **Enable/Disable** - Toggle agents on/off without deleting them
- **Change Model** - Switch between Opus, Sonnet, and Haiku models per agent
- **Create New** - Create agents with ready-to-use templates
- **Rich Details** - See tools, permission mode, max turns, skills, and MCP servers in tooltips

### Command Management
- **View Commands** - See all Claude Code slash commands
- **Enable/Disable** - Toggle commands on/off
- **Create New** - Create commands with templates

### Skill Management
- **View Skills** - See all Claude Code skills (directory-based `SKILL.md`)
- **Enable/Disable** - Toggle skills on/off (moves entire skill directory)
- **Create New** - Create skills with frontmatter template (name, description, argument-hint, user-invocable)
- **Dual Support** - Project-level and global skills

### Usage Metrics
- **This Project** - Sessions and messages for the current workspace
- **Global Stats** - Total sessions, messages, longest session, active since date
- **Model Usage** - Token breakdown per model (Opus, Sonnet, Haiku)
- **Recent Activity** - Daily message and tool call counts (last 7 days)
- **Peak Hours** - Most active hours of the day
- **Dashboard** - Full webview with activity charts, model breakdown, peak hours, and project comparison

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
3. Expand **Agents**, **Commands**, **Skills**, or **Usage Metrics** sections
4. Use toolbar buttons:
   - **Auto Context** - Scan docs and update agents
   - **+** - Create new agent/command/skill
   - **Dashboard** - Open metrics dashboard (in Usage Metrics)
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
| Skills | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| Disabled Agents | `.claude/agents-disabled/*.md` | `~/.claude/agents-disabled/*.md` |
| Disabled Commands | `.claude/commands-disabled/*.md` | `~/.claude/commands-disabled/*.md` |
| Disabled Skills | `.claude/skills-disabled/<name>/SKILL.md` | `~/.claude/skills-disabled/<name>/SKILL.md` |

### Metrics Data Sources
| File | Description |
|------|-------------|
| `~/.claude/stats-cache.json` | Global session stats, model usage, daily activity, peak hours |
| `~/.claude/history.jsonl` | Per-project session and message history |

## Requirements

- Visual Studio Code 1.85.0 or higher
- Claude Code CLI installed and configured

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
