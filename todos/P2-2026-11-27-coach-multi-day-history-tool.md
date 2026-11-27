---
title: "Coach: a tool that returns several days of intake at once, for trend charts"
status: backlog
priority: medium
created: 2026-11-27
updated: 2026-11-27
assignee:
labels: [deferred, server, ai]
github_issue:
---

# Coach: a tool that returns several days of intake at once, for trend charts

## Summary

Coach roadmap T4 added ring, sparkline and heatmap charts to inline_chart.
Sparklines and heatmaps exist to show many days, but the Coach can only read
one day per tool call (`get_daily_log_details` in
`server/services/coach-tools/nutrition.ts`) and has no weight history at all
(the context carries only the current `weightKg` and `goalWeightKg`, in
`server/services/coach-context-builder.ts`). A month-long heatmap would take
up to 35 calls, so in practice the model either skips the chart or, worse,
fills it in. The T4 prompt rule (`MORE_CHARTS_RULE` in
`server/services/coach-blocks.ts`) now forbids drawing a chart without every
point, which keeps it honest but leaves the trend charts mostly unused.
Found by the ai-reviewer on the T4 part 1 PR.

## Fix

A read-only tool, for example `get_intake_history({ days, from? })`, that
returns per-day calories, protein, carbs, fat and whether each met its goal
for up to 35 days in one call (in the user's timezone, the way
`server/services/week-progress.ts` reads its seven days). Then loosen the
rule's examples to point at it. Weight history needs a stored weight log
first, which is a separate question.

## Acceptance Criteria

- [ ] The Coach can draw a 4-week protein heatmap from one tool call, with real numbers.
- [ ] The tool is read-only, rate- and size-bounded, and scoped to the requesting user.
