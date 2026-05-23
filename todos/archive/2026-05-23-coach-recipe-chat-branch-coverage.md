---
title: "Add branch tests for under-covered Coach UI, recipe-chat route, and canonical-enrichment"
status: done
priority: medium
created: 2026-05-23
updated: 2026-05-23
assignee:
labels: [deferred, testing, react-native, api]
github_issue:
---

# Add branch tests for under-covered Coach UI, recipe-chat route, and canonical-enrichment

## Summary

Several real-logic, real-feature files have weak branch coverage despite the healthy overall number. Add targeted tests for the Coach chat UI, the recipe-chat route, and the canonical-enrichment service.

## Background

Surfaced by the 2026-05-23 testing audit (weakest-branch ranking from a full coverage run). Coach is a primary tab and canonical-enrichment feeds the Verified Product API (a planned commercial product), so thin coverage there carries real risk.

Measured branch coverage at audit time:

- `client/components/coach/CoachChat.tsx` — 21.6% branch (139 branches, 210 lines)
- `client/components/coach/CoachMicButton.tsx`, `StreamingBubble.tsx`, and `coach/blocks/*` (CommitmentCard, MealPlanCard, SuggestionList, InlineChart, index) — 0%
- `server/routes/recipe-chat.ts` — 20.6% branch
- `server/services/canonical-enrichment.ts` — 27.9% branch

## Acceptance Criteria

- [ ] `CoachChat.tsx` — cover the main conditional rendering / state branches (streaming vs. idle, error states, empty vs. populated). Use the project's RN render-test pattern (`// @vitest-environment jsdom` + `@testing-library/react` web variant + `renderComponent` helper — NOT `@testing-library/react-native`)
- [ ] At least the higher-logic `coach/blocks/*` cards get render tests for their branch logic (props-driven variants); pure-presentational ones can be lower priority
- [ ] `server/routes/recipe-chat.ts` — route-level tests covering auth gate, premium gate (if any), validation failures, and the success path. Mock every `fireAndForget(...)` service the route invokes (see testing rules) to avoid cross-test leakage
- [ ] `server/services/canonical-enrichment.ts` — unit tests for its enrichment branches (matched vs. unmatched product, partial data, error handling)
- [ ] Branch coverage for each listed file meaningfully increases (target: clear the 70% branch floor)

## Implementation Notes

- Follow extracted-pure-function patterns where logic is tangled with rendering — see existing `client/screens/*-utils.ts` examples and their co-located tests.
- For `recipe-chat.ts`, grep the route for `fireAndForget(` and `vi.mock` each invoked service even if not asserted (background promises settle after `await request(app)` and leak into later tests — see `docs/rules/testing.md`).
- `canonical-enrichment.ts` is part of the Verified Product API pipeline; review `docs/rules/database.md` / nutrition rules for accuracy expectations before asserting enrichment output.
- Scope guard: this is additive test work on existing, presumed-correct code. Do not refactor the source files to make them testable unless a small pure-function extraction is clearly warranted.

## Dependencies

- None (the RN render-test harness already exists).

## Risks

- `CoachChat.tsx` likely depends on streaming/SSE state and TanStack Query; tests may need careful mock setup. Budget time for harness wiring.

## Updates

### 2026-05-23

- Initial creation (from testing audit).
