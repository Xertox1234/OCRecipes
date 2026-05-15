---
title: "Test coverage for api-keys and verification storage modules"
status: in-progress
priority: high
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, security, deferred, audit-2026-05-11]
github_issue:
---

# Test coverage for api-keys and verification storage modules

## Summary

Add integration test suites for `server/storage/api-keys.ts` (11 exports, 182 LOC) and `server/storage/verification.ts` (9 exports, 279 LOC). Both modules currently have zero test coverage despite being security-sensitive and business-critical to the planned Verified Product API.

## Background

Surfaced by audit 2026-05-11 (findings H2, H3 in `docs/audits/2026-05-11-testing.md`). The `api-keys` module owns the full lifecycle of B2B API keys — creation, revocation, tier updates, usage counting, stats — and exposes the barcode nutrition cache (`upsertBarcodeNutrition`, `getBarcodeNutrition`). The `verification` module is the storage layer for the verified-product DB the project plans to sell as an API (per `memory/project_verified_product_api.md`): `submitVerification`, `getUserCompositeScore`, `confirmFrontLabelData`. Untested mutations in a concurrency-sensitive layer mean regressions are silent until a customer notices.

## Acceptance Criteria

### api-keys.ts

- [ ] `server/storage/__tests__/api-keys.test.ts` exists, using `setupTestTransaction`/`rollbackTestTransaction` from `test/db-test-utils.ts`
- [ ] Tests cover: `createApiKey` (unique prefix constraint, hashing), `getApiKeyByPrefix`, `getApiKey`, `revokeApiKey` (idempotent), `updateApiKeyTier`, `listApiKeys` (owner filtering, limit), `incrementUsage` (concurrent calls), `getUsage`, `getUsageStats`, `upsertBarcodeNutrition`, `getBarcodeNutrition` (variants resolution)
- [ ] Negative cases: missing/wrong owner (IDOR), revoked key behaviour, malformed prefix, duplicate prefix
- [ ] Factory `createMockApiKey` from `server/__tests__/factories/verification.ts` is used; no `as unknown as` casts

### verification.ts

- [ ] `server/storage/__tests__/verification.test.ts` exists
- [ ] Tests cover: `getVerification`, `getVerificationByBarcodes` (variants), `getVerificationHistory`, `hasUserVerified`, `getUserVerificationStats`, `submitVerification` (idempotency, duplicate prevention), `hasUserFrontLabelScanned`, `confirmFrontLabelData`, `getUserCompositeScore`
- [ ] Concurrency: two `submitVerification` calls from the same user for the same barcode must not double-count
- [ ] Composite score formula edge cases (zero verifications, single verification, mix of confirmed/disputed)

## Implementation Notes

- Use `setupTestTransaction()` in `beforeEach` and `rollbackTestTransaction()` in `afterEach` for DB isolation
- Follow the pattern in `server/storage/__tests__/users.test.ts` and `nutrition.test.ts` for transactional integration tests
- For composite-score floats, use `expect(value).toBeCloseTo(expected, 2)` not exact equality
- Don't extract pure functions just to test in Node — these are DB-heavy modules; integration tests are appropriate

## Dependencies

None — both modules already exist and have production callers.

## Risks

- DB integration tests are slower than unit tests; aim for <100ms per test on local Postgres
- Drizzle ORM upgrade could change query semantics; tests will catch that
