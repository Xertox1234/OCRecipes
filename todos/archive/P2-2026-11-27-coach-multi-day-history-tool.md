---
title: "Coach: a tool that returns several days of intake at once, for trend charts"
status: done
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
- [x] The tool is read-only, rate- and size-bounded, and scoped to the requesting user.

## Updates

- 2026-11-27: Added `get_intake_history({ days ≤ 35, endDate? })` (`server/services/coach-tools/intake-history.ts`). It is offered with write cards and returns each day's totals, read the way Home's daily summary reads them in the user's zone. It also returns protein and calorie goal flags, using the weekly report's rules, now shared from `weekly-report/facts.ts`. Like the weekly report, it leaves the numbers out when most fully logged days are under the safe line. `MORE_CHARTS_RULE` now points sparklines and heatmaps at it. Tests: `server/services/__tests__/coach-intake-history.test.ts` (28 days in one call, scoped to the user, bounded at 35, no future days).
- Criterion 1 needs a person: on the phone, ask the Coach for a 4-week protein heatmap and check that it makes one get_intake_history call and the squares match the logs.
- Weight history still needs a stored weight log first. That is a separate question, as this todo said.
- Review fixes:
  - An unlogged day has no numbers (it doesn't come back as 0).
  - The description states the goal rules, the today limit, and that "not met" can mean a value was not recorded.
  - The guard always judges the last 7 days as well as the requested range.
- Accepted cost: each call makes up to 35 sequential day reads (at most 10 calls per reply). Each read is the same as Home's, one connection at a time.
- Deferred: the guard skips one-item days → `todos/P3-2026-11-27-low-intake-guard-ignores-partial-days.md`.
