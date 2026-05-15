---
title: "Test coverage for coach-context-builder and profile-hub services"
status: backlog
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, deferred, audit-2026-05-11]
github_issue:
---

# Test coverage for coach-context-builder and profile-hub services

## Summary

Two service modules have no test files: `coach-context-builder.ts` (96 LOC, used by the Coach Pro chat flow) and `profile-hub.ts` (59 LOC, wraps `storage/profile-hub.ts`).

## Background

Surfaced by audit 2026-05-11 (finding M6 in `docs/audits/2026-05-11-testing.md`). `coach-context-builder.ts` assembles the user/profile/dietary context that gets injected into Coach Pro prompts. A regression in this builder degrades personalization silently — users get generic advice instead of allergen-aware, goal-aware coaching. `profile-hub.ts` has indirect coverage via route tests but no unit-level edge case coverage.

## Acceptance Criteria

### coach-context-builder.ts

- [ ] `server/services/__tests__/coach-context-builder.test.ts` exists
- [ ] Tests cover: empty profile (no allergies, no goals), full profile (all fields populated), partial profile (some null fields), allergies array empty vs null, dietary restrictions formatting
- [ ] Output shape verified — the exact string format that gets injected into prompts (use snapshot or explicit assertions on key phrases)
- [ ] Coach Pro vs free-tier branching if applicable

### profile-hub.ts

- [ ] `server/services/__tests__/profile-hub.test.ts` exists
- [ ] Tests cover each exported function with at least happy path + one edge case
- [ ] Storage is mocked via `vi.mocked(storage.X)` + factories

## Implementation Notes

- For prompt-content assertions, prefer explicit string contains (`expect(result).toContain("allergens: peanuts")`) over snapshots — snapshots make prompt iteration noisy
- Don't test what the LLM does with the context — that's evals territory (`evals/`)

## Dependencies

None.

## Risks

- Low.
