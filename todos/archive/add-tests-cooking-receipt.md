---
title: "Add tests for cooking.ts route and receipt-analysis.ts service"
status: backlog
priority: high
created: 2026-03-25
updated: 2026-03-25
assignee:
labels: [testing, launch-readiness]
---

# Add tests for cooking.ts route and receipt-analysis.ts service

## Summary

The two most significant test coverage gaps found during the launch readiness audit. Adding these tests brings route coverage from 89% to 96% and service coverage to 100%.

## Background

A broad code audit identified 215 test files covering 25/28 routes and 28/29 services. Three files lack tests, with `cooking.ts` being the largest untested route at 931 lines.

## Acceptance Criteria

- [ ] `server/routes/__tests__/cooking.test.ts` — tests for all cooking route endpoints
- [ ] `server/services/__tests__/receipt-analysis.test.ts` — tests for receipt OCR parsing and analysis
- [ ] `server/routes/__tests__/receipt.test.ts` — tests for receipt scanning endpoints
- [ ] All new tests pass in `npm run test:run`
- [ ] Follow existing test patterns (see other route/service tests for mocking conventions)

## Implementation Notes

**cooking.ts (931 lines)** — Needs tests for:

- Cooking method endpoints
- Temperature/time adjustments
- Error handling for invalid cooking methods
- Auth/permission checks

**receipt-analysis.ts (172 lines)** — Needs tests for:

- Receipt OCR parsing
- Item extraction and validation
- Confidence scoring
- Edge cases (blurry text, unusual formats)

**receipt.ts (223 lines)** — Needs tests for:

- Receipt scanning endpoint happy path
- Validation errors (bad input)
- Auth checks

## Dependencies

- None — these are additive test files

## Risks

- Receipt analysis may depend on OpenAI Vision — mock appropriately
- Cooking adjustments may have complex calculation logic requiring careful edge case testing

## Updates

### 2026-03-25

- Initial creation from launch readiness audit
