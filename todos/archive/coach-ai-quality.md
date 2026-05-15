---
title: "Coach: AI response quality improvements"
status: done
priority: medium
created: 2026-04-29
updated: 2026-04-29
assignee:
labels: [coach, ai, prompts]
---

# Coach: AI response quality improvements

## Summary

Improve the Coach's response quality through better context injection, prompt engineering, and richer use of notebook memory — making advice feel more personalised and insightful.

## Background

The 2026-04-29 coach improvement pass focused on UX and feature completeness (B and C dimensions). AI quality (dimension A) was explicitly deferred. The existing system prompt and context injection are solid but have room for improvement: notebook memory is injected as a flat list, weight trends and meal patterns aren't surfaced, and there's no few-shot prompting for response style.

## Acceptance Criteria

- [x] Notebook entries injected with recency weighting (recent commitments surfaced first)
- [x] Weight trend summary included in context when available (direction + rate)
- [x] Meal pattern summary (common skipped meals, late-night eating, etc.) available as context
- [x] Response style is consistent across sessions (tone, length, structure)
- [ ] Eval scores improve measurably on the existing eval dataset after prompt changes
- [ ] No regression in safety filter pass rate

## Implementation Notes

- System prompt is in `server/services/nutrition-coach.ts` (`buildSystemPrompt()`) and `server/services/coach-pro-chat.ts`
- Notebook injection: currently flat list; weight by `updatedAt` and filter to active entries only
- Weight trend: `server/services/weight-trend.ts` already exists — wire output into context builder
- Meal patterns: derive from `dailyLogs` in the context-building step (skipped meals = 0-cal entries, late night = log after 9pm)
- Run evals (`npm run evals`) before and after to measure impact
- Consider few-shot examples in the system prompt for tone calibration

## Dependencies

- Existing eval dataset in `evals/`
- `server/services/weight-trend.ts`

## Risks

- Prompt changes can have unpredictable effects — eval before/after is essential
- More context tokens = higher cost per message
- Tone changes may feel jarring to returning users

## Updates

### 2026-04-29

- Deferred during initial coach improvement pass (user prioritised UX and features over AI quality)
