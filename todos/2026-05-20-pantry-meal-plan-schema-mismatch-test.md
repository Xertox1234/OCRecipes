---
title: "Test the pantry-meal-plan AI shape-mismatch (ZodError) branch"
status: backlog
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, testing]
github_issue:
---

# Test the pantry-meal-plan AI shape-mismatch (ZodError) branch

## Summary

`aiResponseSchema.parse(parsed)` in `server/services/pantry-meal-plan.ts:250`
throws a raw `ZodError` when the AI returns valid JSON of the wrong shape (→ 500
by design). This boundary branch has no test; the suite covers empty-content and
invalid-JSON only.

## Background

Found in the 2026-05-20 full audit (L9). Behavior is correct (the route
deliberately keeps a shape-mismatch a 500), but the branch is untested per
`docs/rules/testing.md` ("cover new boundary branches").

## Acceptance Criteria

- [ ] A test feeds the AI mock a syntactically-valid JSON payload of the wrong
      shape and asserts the function throws (ZodError) / the route returns 500
- [ ] Existing pantry-meal-plan tests still pass

## Implementation Notes

File under test: `server/services/pantry-meal-plan.ts`. Test file:
`server/services/__tests__/pantry-meal-plan.test.ts`. Mock the OpenAI call to
return wrong-shape JSON (e.g. `{ unexpected: true }`).

## Risks

- None — additive test only.

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, finding L9).
