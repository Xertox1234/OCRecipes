---
title: "A shared helper that returns an empty list on a parse failure or missing key makes 'unavailable' read as 'no results' — add an opt-in strict mode for the caller that must tell them apart"
track: bug
category: logic-errors
tags: [api, testing, external-api, spoonacular, zod]
module: server
applies_to: ["server/services/recipe-catalog.ts", "server/services/recipe-finder/find-online.ts"]
symptoms: ["A Spoonacular 200 carrying its error envelope ({\"status\":\"failure\",\"code\":401}) shows the user \"no matches\" instead of \"not available right now\"", "A caller's catch block maps every failure to 'unavailable', yet some failures never reach it"]
created: 2026-09-28
severity: medium
---

# A shared helper that returns an empty list on failure makes "unavailable" read as "no results"

## Problem

`searchCatalogRecipes` (`server/services/recipe-catalog.ts`) throws on a 402 or a non-OK status. But it **returns an empty result** in two other cases: when the API key was missing at module load, and when a 200 body fails `catalogSearchResponseSchema`. That's right for the Recipe Browser, where an empty list is a fine degraded view. It was wrong for the recipe finder: `findOnline` (spec §6) must say "not available right now" for any failure and "no matches" only for a genuine empty result. Its `catch` could not see failures that never threw.

## Symptoms

- Measured: `{"status":"failure","code":401}` with HTTP 200 → `{status:"ok", items:[]}` → the "no matches" notice.

## Root Cause

A lenient fallback in a shared helper erases the difference between "failed" and "found nothing" for every caller. A caller that needs that difference cannot recover it downstream.

## Solution

(#1152) Add an opt-in second parameter, `searchCatalogRecipes(params, { strict: true })`. It throws where the default returns empty. Only `findOnline` passes it, so the Recipe Browser and coach tools keep their current behaviour.

The test (`find-online-strict.test.ts`) drives the **real** `searchCatalogRecipes` through a stubbed `global.fetch`, re-importing the module per case because the key is captured at module load. It has a positive control (a valid 200 → items) so the harness provably reaches the real path. Mocking `searchCatalogRecipes` itself would have tested nothing.

## Prevention

- When a helper returns an empty value on failure, check each caller: does it need to tell "failed" from "empty"? If one does, give that caller an explicit mode. Don't widen the lenient behaviour, and don't break the other callers.
- For "failure reads as empty" bugs, test through the lowest boundary you can stub (`fetch`) with a positive control, not by mocking the helper whose fallback is the bug.

## Related Files

- `server/services/recipe-catalog.ts` — `searchCatalogRecipes(params, opts)`
- `server/services/recipe-finder/find-online.ts` — the only strict caller
- `server/services/recipe-finder/__tests__/find-online-strict.test.ts`

## See Also

- [Zod safeParse for external API responses](../conventions/zod-safeparse-external-api-responses-2026-05-13.md) — return a structured error, not a silent default
