---
title: "Restore unit tests for generateCoachResponse (standard coach path)"
status: in-progress
priority: medium
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [testing, coach-pro]
---

# Restore unit tests for generateCoachResponse (standard coach path)

## Summary

When the `nutrition-coach.test.ts` file was rewritten to cover `generateCoachProResponse` (the Pro path), the existing tests for `generateCoachResponse` (the standard, non-Pro path) were removed. The standard path still exists and handles input sanitization, dangerous dietary content detection, system prompt boundaries, and screenContext injection — all untested after the rewrite.

## Background

The original `nutrition-coach.test.ts` tested `generateCoachResponse` with cases for: input sanitization, `containsDangerousDietaryAdvice` detection, `SYSTEM_PROMPT_BOUNDARY` enforcement, and `screenContext` injection into the system prompt. During the coach-pro-test-coverage todo (2026-04-12), the file was rewritten from scratch to test `generateCoachProResponse` instead. The standard coach tests were collateral damage.

## Acceptance Criteria

- [ ] `server/services/__tests__/nutrition-coach.test.ts` includes a `describe("generateCoachResponse")` block
- [ ] Tests cover input sanitization (user content is passed through `sanitizeUserInput`)
- [ ] Tests cover dangerous dietary advice detection (`containsDangerousDietaryAdvice` triggers disclaimer)
- [ ] Tests cover screenContext injection into system prompt
- [ ] Tests cover basic streaming (text content yielded from async generator)
- [ ] Existing `generateCoachProResponse` tests remain unchanged
- [ ] All tests pass

## Implementation Notes

- `generateCoachResponse` is simpler than the Pro variant — no tool-calling loop, just streaming text
- Follow the same `createMockStream` / `collectStream` helpers already in the test file
- The key behaviors to test are the safety-related ones: sanitization, dangerous content detection, system prompt construction

## Dependencies

- None

## Risks

- Low risk — these are additive tests for an existing, stable function

## Updates

### 2026-04-12

- Created from code review finding: standard coach path tests removed during Pro path test rewrite
