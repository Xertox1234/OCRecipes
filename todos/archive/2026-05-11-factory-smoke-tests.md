---
title: "Add smoke tests for all factories under server/__tests__/factories/"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, code-quality, audit-2026-05-11-review-feedback]
github_issue:
---

# Add smoke tests for all factories under server/**tests**/factories/

## Summary

The 5 factories added in PR #148 (`createMockTastePick`, `createMockRecipeDismissal`, `createMockCoachResponseCache`, `createMockCarouselSuggestionCache`, `createMockPushToken`) are currently only validated by `tsc --noEmit`. If a factory has a subtle type-narrowing bug (e.g., a JSONB field missing a required key, a date that's actually `string` not `Date` per the Drizzle inference), it won't surface until a future test imports the factory and the assertion fails confusingly.

Add a single smoke-test file that calls every factory with no args and asserts the returned shape passes the schema-derived type (which TypeScript already enforces, but the test also verifies _runtime_ shape).

## Background

Raised by review of PR #148 (testing audit, suggestion 2). Audits 2026-04-17 and 2026-04-18 both added new factories without smoke tests; this gap has been a recurring oversight.

## Acceptance Criteria

- [ ] `server/__tests__/factories/__tests__/factories.test.ts` exists
- [ ] One `describe` block per factory file (`cache`, `recipes`, `reminders`, etc.)
- [ ] Each factory has at minimum:
  - `it("creates valid defaults", () => { const obj = createMockX(); expect(obj).toMatchObject({ id: 1 }); /* + other invariants */ })`
  - `it("merges overrides", () => { const obj = createMockX({ id: 99 }); expect(obj.id).toBe(99); })`
- [ ] Date fields are checked to be `instanceof Date` (catches accidental string defaults)
- [ ] Required not-null fields are non-null and non-undefined (`expect(obj.X).not.toBeNull()`)
- [ ] Test runs in <100ms total (factories are pure data construction)

## Implementation Notes

- Don't try to validate via Zod — the factory returns Drizzle `$inferSelect` types, not insert schemas. Use `toMatchObject` for shape and explicit assertions for non-null invariants.
- Group by domain file (one describe block per `cache.ts`, `recipes.ts`, etc.) so future factory additions have a clear place to land.
- Consider a meta-test that imports `server/__tests__/factories/index.ts` and asserts every export starts with `createMock` (catches export typos).

## Dependencies

None.

## Risks

- Negligible. Pure test infrastructure addition.
