---
title: 'Barcode lookup trusts unvalidated server JSON — a malformed 200 is shown to the user as "couldn''t reach our service" and produces no production signal'
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, code-quality]
github_issue:
---

# Barcode lookup trusts unvalidated server JSON — a malformed 200 is shown to the user as "couldn't reach our service" and produces no production signal

## Summary

The barcode lookup success path destructures `serverRes.json()` (typed `any`) with no validation. A shape mismatch throws inside the try block, is caught by the network-failure catch, falls back to Open Food Facts, and tells the user the service was unreachable. The only log is a dev-only `logger.warn`.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M7** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/hooks/useNutritionLookup.ts:483-524` (e.g. :495 dereferences `data.servingInfo.wasCorrected`), :619-621 (`verificationLevel as VerificationLevel`), :525-527/:564-566 (`flags` checked only with `Array.isArray`), catch :666-671, user copy :765-785.
- Research (Zod 3.25 `.safeParse`): `confirmed`.

## Acceptance Criteria

- [x] The server response is validated with a Zod schema (reuse or derive from `shared/` types if one exists) via `safeParse`
- [x] A validation failure is reported with `logger.error` (reaches Sentry) and is distinguished from a network failure, with no false "couldn't reach our service" copy
- [x] The allergen fail-safe flag behavior on failure is preserved
- [x] Tests: a malformed 200 produces the correct state and copy plus a logger.error call
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

If the useNutritionLookup refactor lands first, put the schema in `lookupBarcode()`. Otherwise add it at the current call site, keeping the diff small.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/hooks/useNutritionLookup.ts`
  - `shared/ (schema, only if a shared response type already exists)`
  - `client/hooks/__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Too strict a schema could reject currently-working partial responses — make optional fields optional.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M7).

### 2026-09-25

- Implemented. `client/hooks/useNutritionLookup.ts`'s `fetchBarcodeData` now
  validates the `/api/nutrition/barcode/:code` 200 body with
  `barcodeLookupResponseSchema.safeParse` before dereferencing it. On
  validation failure: `logger.error` (reaches Sentry) fires once, a local
  `serverResponseInvalid` flag (set before a plain `throw new Error(...)` —
  no new Error subclass, per the Scope Contract) suppresses the pre-existing
  network-outage `logger.warn`, and the allergen-unavailable fail-safe flag's
  `detail` text switches to copy that doesn't claim the service was
  unreachable, on both the OFF-fallback-recovers and total-outage paths. An
  unparseable-JSON 200 (`serverRes.json()` throwing) is folded into the same
  path via `.catch(() => undefined)` before `safeParse`. TDD: the new test
  file failed against unmodified `main` (verified via a saved-patch
  revert/reapply, not just reasoning) and passes after the fix.
- **Scope Contract exceeded by two files**, both required by a repo-wide
  gate the contract's author could not have anticipated:
  `scripts/__tests__/contract-coverage-guard.test.ts` requires every
  client-parsed `<name>Schema` to have a provider-side assertion in a
  `server/`/`test/` test (its `CONTRACT_ALLOWLIST` is an empty ratchet that
  must stay empty). Fix: relocated `barcodeLookupResponseSchema` from the
  hook into `shared/types/barcode-lookup.ts` (following the existing
  `@shared/types/recipe-search` pattern) and added two
  `expectResponseToMatch(res.body, barcodeLookupResponseSchema)` assertions
  to the existing `server/routes/__tests__/nutrition.test.ts`. A second
  opinion was sought before making this change; two review rounds
  (code-reviewer + mobile-reviewer, then a code-reviewer confirmation pass)
  returned no blocking findings on the full diff.
- Full suite (`npm run test:run` — 550 files / 8724 tests, `check:types`,
  `lint`) passes clean at the final head.
