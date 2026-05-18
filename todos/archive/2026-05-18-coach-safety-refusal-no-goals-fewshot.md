---
title: "Add a no-goals few-shot example to the coach safety-refusal block"
status: done
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Add a no-goals few-shot example to the coach safety-refusal block

## Summary

The `safety_refusal` intent block in `buildIntentBlock` has instructions for
handling users with no daily goals set, but no worked example showing the
behavior. Add one few-shot exchange so the model has a concrete pattern.

## Background

Commits `f584dea4` and `025a82bb` added no-goals handling to the nutrition
coach: when no daily goals are set, the model must not invent goal or
"remaining" numbers and should instead anchor to logged intake and
weight-trend direction. The `personalized_advice` intent block already has a
matching few-shot exchange ("I've logged all my meals today. Am I eating
well?" with no goals set). The `safety_refusal` block got the instruction but
not the example, so the no-goals refusal behavior is instruction-only.

This was surfaced as a kimi-review SUGGESTION during the commit of
`025a82bb`. It is polish, not a defect — the instruction alone is expected to
work — so it was deferred.

## Acceptance Criteria

- [ ] Add one few-shot exchange to the `safety_refusal` branch of
      `buildIntentBlock` showing a safety refusal for a user with NO daily
      goals set.
- [ ] The example must anchor to today's logged intake and/or current weight
      (and weight-trend direction), and must not cite any goal or "remaining"
      figures.
- [ ] Keep it consistent in tone/format with the existing safety-refusal
      example exchanges.

## Implementation Notes

- File: `server/services/nutrition-coach.ts` — the `if (intent ===
"safety_refusal")` branch of `buildIntentBlock` (the `EXAMPLE EXCHANGES:`
  section).
- Mirror the structure of the no-goals example in the `personalized_advice`
  block (the "Am I eating well?" exchange) for consistency.
- Static strings only — `buildIntentBlock` returns a static string array.
- If coach evals have a safety-refusal-with-no-goals case, confirm it still
  passes; otherwise consider adding one to `evals/datasets/coach-cases.json`.

## Dependencies

- None.

## Risks

- Low. Prompt-string-only change. Keep the example short so it does not bloat
  the system prompt token count.

## Updates

### 2026-05-18

- Created from a deferred kimi-review SUGGESTION raised while committing
  `025a82bb` (coach safety-refusal no-goals guard).
