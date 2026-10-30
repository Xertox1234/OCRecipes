---
title: "A barcode lookup outage is shown as "Product not found""
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, reliability]
github_issue:
---

# A barcode lookup outage is shown as "Product not found"

## Summary

When Open Food Facts and USDA fail or rate-limit, the barcode route answers 404 "Product not found", so the user is told the product is unknown instead of being able to retry.

## Background

Audit finding M-rel-5. `server/services/barcode-lookup.ts` (~425-445) swallows OFF errors and doesn't check `res.ok`; `server/services/usda-lookup.ts` (~214-230) returns null for both a failure and no match; `server/routes/nutrition.ts` (~291-294, ~335) maps null to 404. Nothing is cached on this path.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] The lookup distinguishes "every source errored" from "no source had data"
- [ ] The error case returns 503 with a retryable `ErrorCode`; the client shows retry copy instead of the unknown-product flow
- [ ] Tests cover outage vs genuine miss for GET and POST barcode routes

## Implementation Notes

Check the client barcode flow (`client/hooks/useNutritionLookup.ts`, `nutrition-lookup-outcome.ts`) for how a 404 vs 503 is handled.

## Scope Contract

- **Files in scope:** `server/services/barcode-lookup.ts`, `server/services/usda-lookup.ts`, `server/routes/nutrition.ts`, the client barcode outcome code and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
