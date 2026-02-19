---
name: new-agent-template
description: Add a built-in agent template to the Create New Agent action
argument-hint: "[template-name] [description]"
user-invocable: true
model: sonnet
---

Add a new agent template to the CC-Agent Manager "Create New Agent" flow.

## Steps

1. **Read existing templates** - Read `src/services/ClaudeCodeService.ts` and search for where agent template content is defined (likely a `getAgentTemplate` method or a `templates` map).

2. **Define the template content** - Create the YAML/Markdown string for the new agent. Required frontmatter fields:
      ---
   name: <agent-name>
   description: <what the agent does>
   model: sonnet          # or opus / haiku
   tools: Read, Glob, Bash
   ---

   You are a specialized agent for...
      Include only tools the agent genuinely needs. Use `claude opus` only for complex reasoning tasks.

3. **Register the template** - Add an entry to the template list/map in `ClaudeCodeService.ts` so it appears in the quick-pick shown during "Create New Agent".

4. **Label and icon** - Ensure the template has a short display label and, if the quick-pick supports descriptions, a one-line summary.

5. **Test the flow** - Trace through `createAgent()` (or equivalent) in the service to confirm the new template is written to `.claude/agents/<name>.md` with correct formatting.

## Notes
- Agent files live in `.claude/agents/` (project) or `~/.claude/agents/` (global)
- The `tools` field must be a comma-separated list matching Claude Code's known tool names
- Prefer conservative permission modes (`default`) in templates; users can loosen later