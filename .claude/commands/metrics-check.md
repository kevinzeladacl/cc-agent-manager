---
description: Read and summarize Claude Code usage metrics for this project
---

# metrics-check Command

1. Read `src/services/MetricsService.ts` to understand where metrics data is sourced
2. Locate the relevant Claude Code usage data files (check `~/.claude/` for stats files)
3. Summarize in a compact table:
   - Sessions and messages for this project
   - Global totals (sessions, messages, longest session)
   - Top model by token usage
   - Most active day in the last 7 days
4. Flag anything unusual (e.g. unusually high tool call counts, missing data files)