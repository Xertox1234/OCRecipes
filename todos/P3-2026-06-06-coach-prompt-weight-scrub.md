---
title: "Scrub residual weight references from the nutrition-coach prompt"
status: backlog
priority: low
created: 2026-06-06
updated: 2026-06-06
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Scrub residual weight references from the nutrition-coach prompt

## Summary

PR #384 removed `weightTrend` from `CoachContext` but left several prompt
instructions and few-shot examples in `server/services/nutrition-coach.ts` that
still tell the model to anchor to / cite weight data the context no longer
provides. Finish the scrub so the prompt matches the trimmed context.

## Background

The health-feature removal (#384, merged 2026-06-06) deleted weight tracking and
stripped `weightTrend` from the coach context object and the weight-display block.
A code review caught that the surrounding prompt was only partially updated: some
weight clauses were removed (clause [3], the "what you DO have" line) but others
were left. Not a functional break — there is no weight number in context and the
prompt hard-forbids fabricating numbers, so the model falls back to intake
anchoring — but it is inconsistent with the PR's intent and may subtly degrade
coach output by instructing it to use absent data.

## Acceptance Criteria

- [ ] Remove the dangling instruction at `nutrition-coach.ts:151` ("Weight trend direction (losing/gaining/stable) is more important than the exact number — use it to frame whether the user is on track.")
- [ ] Remove "current weight" / "weight trend" clauses from the refusal-template opener `:69` (clause [1]) and the citable-numbers list `:143`.
- [ ] Re-anchor the few-shot example responses at `:94`, `:97`, `:175` away from "weight trending down" to today's intake (carefully — these are tuned safety examples; preserve the three-clause refusal structure).
- [ ] Confirm the GLP-1 / extreme-fasting refusal examples and the `extreme_fasting` intent behavior are unchanged.
- [ ] `grep -ni "weight" server/services/nutrition-coach.ts` returns only the false-positive at `:152` ("**Weight** recent entries..." — a verb about notebook recency).

## Implementation Notes

- Only edit prompt text; do not touch refusal _structure_ or safety guardrails.
- `coach-pro-chat.ts` delegates to this prompt builder, so the fix flows through to Coach Pro automatically.
- After editing, re-run the coach evals if convenient (`evals/runner.ts`) to confirm tone/quality didn't regress; CI does not run evals.

## Dependencies

- None (PR #384 merged).

## Risks

- The few-shot examples are carefully tuned for safety behavior — edit conservatively and keep the opener → refusal+referral → safe-alternative shape intact.

## Updates

### 2026-06-06

- Initial creation — deferred from the #384 review (user merged as-is).
