# CC-Agent Manager

VS Code extension that provides a sidebar UI for managing Claude Code agents, commands, skills, and usage metrics. Supports both project-level (`.claude/`) and global (`~/.claude/`) configurations with AI-powered generation via the Claude CLI.

## Key Conventions

- **Language**: TypeScript with strict mode enabled, targeting ES2021
- **Naming**: kebab-case for file names, PascalCase for classes and interfaces, camelCase for functions and variables
- **File organization**: Providers in `src/providers/`, services in `src/services/`, webviews in `src/webview/`
- **Item types**: Agents, commands, and skills follow the same enable/disable pattern using `-disabled` directory suffixes (e.g., `agents-disabled/`)
- **Frontmatter parsing**: All `.md` items use YAML frontmatter (`---` delimited) for metadata like `name`, `description`, `model`, `tools`, `permissionMode`
- **Tree providers**: Each sidebar section is a `TreeDataProvider` returning custom `TreeItem` subclasses
- **Error handling**: Silent `catch` blocks for filesystem operations; user-facing errors via `vscode.window.showErrorMessage`
- **No runtime dependencies**: Extension uses only Node.js built-ins (`fs`, `path`, `child_process`) and the VS Code API

## Architecture

### Tech Stack
- TypeScript 5.3+, VS Code Extension API (^1.85.0)
- Compiled to CommonJS (`out/` directory)
- Claude CLI (`~/.local/bin/claude`) for AI features

### Directory Structure

```
src/
  extension.ts              # Entry point: activate(), command registration, file watchers
  providers/
    ClaudeTreeProvider.ts    # Generic tree provider for agents, commands, skills, and teams
    MarkdownTreeProvider.ts  # Tree view for project markdown files (categorized)
    MetricsTreeProvider.ts   # Tree view for usage metrics (project, global, model, activity)
    QuickActionsProvider.ts  # Quick action buttons (AutoGenerate, Update CLAUDE.md)
  services/
    ClaudeCodeService.ts     # Claude CLI wrapper: execute prompts, suggest/generate items
    MetricsService.ts        # Reads ~/.claude/stats-cache.json and history.jsonl for metrics
  webview/
    MetricsDashboard.ts      # Full HTML webview with charts for metrics visualization
```

### Key Patterns

- **`ClaudeTreeProvider`** is parameterized by `itemType` (`agent` | `command` | `skill` | `team`) and reused for all four sidebar sections
- **Enable/disable** moves files between `<type>/` and `<type>-disabled/` directories (entire directories for skills)
- **`ClaudeCodeService`** invokes the Claude CLI via `spawn` with `--dangerously-skip-permissions` and `-p` (pipe mode), using delimiter-based parsing (`===AGENT===`, `===TEMPLATE===`, `===END===`) to extract structured suggestions from freeform output
- **Metrics** are read from `~/.claude/stats-cache.json` (global stats) and `~/.claude/history.jsonl` (per-project breakdown)
- **Activation**: Extension activates when workspace contains a `.claude` directory (`workspaceContains:.claude`)
- **File watchers** automatically refresh all tree views when `.claude/` contents change

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript to `out/` |
| `npm run watch` | Watch mode compilation |
| `npm run lint` | Run ESLint on `src/` |
| `npm run vscode:prepublish` | Pre-publish build (runs compile) |

To test: press `F5` in VS Code to launch the Extension Development Host.

## Claude Code Integration

### Agents
- `auto-context-ai-feature` — AI-powered features: agent suggestion, doc scanning, context injection
- `claude-config-specialist` — Manages Claude Code configuration files in `.claude/` directories
- `experto-cc` — General expert agent
- `metrics-dashboard-developer` — Develops metrics features (MetricsService, MetricsTreeProvider, MetricsDashboard)
- `vs-extension-expert` — VS Code extension development specialist

### Commands
- `add-provider` — Scaffold a new TreeDataProvider and register it
- `build-ext` — Compile and package the extension into a `.vsix` file
- `metrics-check` — Read and summarize Claude Code usage metrics
- `release` — Prepare a new release of the extension

### Skills
- `add-command` — Add a new VS Code command to the extension
- `add-metric` — Add a new metric type to MetricsService, tree view, and dashboard
- `add-webview` — Create a new webview panel following the MetricsDashboard pattern
- `new-agent-template` — Add a built-in agent template to the Create New Agent action