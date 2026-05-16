---
title: "Clean up coach intent classifier post-PR-102 items"
status: in-progress
priority: low
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Clean up coach intent classifier post-PR-102 items

## Summary

Follow-up cleanup items from the code review of PR #102 (deterministic intent
router). None block functionality; they reduce redundant work and tighten
routing semantics.

## Background

Migrated from GitHub issue #103 when the GitHub Copilot delegation workflow was
parked (see CLAUDE.md "Copilot Infrastructure"). Verified 2026-05-15 that all
actionable items are still unaddressed in the current code on `main`.

## Acceptance Criteria

- [ ] Eliminate double intent classification in the Pro path: `handleCoachChat`
      in `coach-pro-chat.ts` classifies once (~line 357) for the cache key, then
      `generateCoachProResponse` classifies the same message again internally.
- [ ] Decide on the broad `do .*need` arm in `GENERAL_FACT_RE`
      (`coach-intent-classifier.ts:80`) — either tighten to nutrient words or
      drop the arm so questions fall through to `personalized_advice`.
- [ ] Bound the `[\s\S]*` quantifiers in injection/jailbreak patterns to cap
      backtracking depth (handle when input sanitization is reviewed).
- [ ] Add a JSDoc note to `hashCoachCacheKey` (`coach-pro-chat.ts:201`)
      clarifying the `intent = "personalized_advice"` default is a
      backward-compat fallback, not a meaningful routing decision.

## Implementation Notes

- **Double classification (Medium):** Add an optional `intent?: CoachIntent`
  param to `generateCoachResponse` (`nutrition-coach.ts:316`) and
  `generateCoachProResponse` (`nutrition-coach.ts:381`). If provided, skip the
  internal `classifyIntent` call. The Pro path passes its already-classified
  value; free-tier callers that omit it continue to self-classify.
- **`do .*need` arm (Low):** `coach-intent-classifier.ts:80` currently uses
  `do .*need`. Tighten to e.g.
  `do .*need\b.*(protein|carb|fiber|vitamin|supplement|calorie|fat|macro)/i`.
- **ReDoS `[\s\S]*` (Low):** Replace with a bounded `[\s\S]{0,500}` or
  pre-screen with `.includes("unrestricted")`. V8 handles this safely today and
  upstream sanitization bounds message length, so this is non-urgent.
- **Monitoring (no action):** The plateau few-shot example in the
  `personalized_advice` bundle uses 1,550/1,600 cal, 120/125g protein, 82kg.
  Spot-check production logs after a week — if the coach cites "82kg" for users
  at a very different weight, the model is anchoring on example numbers.

## Dependencies

- None blocking. The ReDoS item is best done alongside an input-sanitization
  review.

## Risks

- Low. Changes are localized to coach intent routing and caching.

## Updates

### 2026-05-15

- Migrated from GitHub issue #103. Confirmed all 4 actionable items still open
  in current code (`generateCoachProResponse` has no `intent?` param;
  `GENERAL_FACT_RE` still carries the broad `do .*need` arm).
