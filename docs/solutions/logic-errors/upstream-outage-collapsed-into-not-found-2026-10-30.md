---
title: "A nutrition/barcode source that returns null for both 'no match' and 'could not ask' turns an upstream outage into a definitive 404 — return a three-way outcome and answer 503"
track: bug
category: logic-errors
tags: [api, architecture, external-api, nutrition, barcode, reliability, caching]
module: server
applies_to: ["server/services/barcode-lookup.ts", "server/services/usda-lookup.ts", "server/services/nutrition-lookup.ts", "server/services/cnf-lookup.ts", "server/services/nutrition-source-utils.ts", "server/routes/nutrition.ts"]
symptoms: ["Open Food Facts rate-limits or 5xxs and every barcode scan says 'Product not found'", "USDA 429 reads as 'Nutrition data not found' with nothing in the logs", "A fallback-only barcode row persisted during an OFF outage blocks the richer OFF row forever", "The client never retries direct OFF because the server answered 404, not 5xx"]
created: 2026-10-30
severity: medium
---

# An upstream outage collapsed into "not found"

## Problem

Every nutrition source adapter (`lookupBarcode`'s Open Food Facts loop, `lookupUSDA`, `lookupUSDAByUPC`, `lookupAPINinjas`) had the signature `Promise<NutritionData | null>`. `null` meant both "the source answered and has no match" and "the source could not be asked" (429, 403/bad key, 5xx, network error, timeout, schema drift). The OFF loop never checked `res.ok`, so a 429 HTML page went to `res.json()`, threw, and was logged as a fetch error and then treated as a miss. The routes turned `null` into `404 NOT_FOUND`. Reliability audit 2026-10-30, findings R08, R09 and R43.

## Symptoms

- During an OFF or USDA outage, users get a definitive "Product not found" or "Nutrition data not found" instead of a retryable error.
- The client's fallback to direct OFF only runs on 5xx, so a 404 never triggers it.
- `insertBarcodeNutritionIfAbsent` is first-write-wins. A row built only from the weaker sources during an OFF outage was persisted and blocked the full OFF row (allergens, NOVA, serving data) permanently.
- `fetchUSDA` logged nothing on non-OK, and `lookupUSDAByUPC` had an empty `catch`, so the outage left no trace.

## Root Cause

A `T | null` return in a fallback chain cannot carry "unavailable". When the chain ends with every source at `null`, the aggregator cannot tell "nobody has it" from "the source that has it was down". Every layer above (the route status, the cache write, the client retry) then made the wrong decision on that one bit.

## Solution

1. **Three-way outcome.** `NutritionLookupOutcome` in `server/services/nutrition-source-utils.ts` is `found | not-found | unavailable`. Classify at the adapter:
   - `404`, or a 200 with an empty match list → `not-found`
   - `429`, other non-OK statuses, a thrown fetch, a timeout, or a failed schema `safeParse` → `unavailable` (log the status or the zod issues)
   - an **optional** source that is deliberately unconfigured (no `API_NINJAS_KEY`) → `not-found`, not `unavailable`. Otherwise an absent optional key would make every miss a 503.
2. **Aggregate across the chain.** `fetchNutritionFromSources` returns the first `found`. With no hit, it returns `unavailable` if ANY source was unavailable, else `not-found`. The food may exist in the source you failed to ask.
3. **Keep the legacy contract at the edge.** `lookupNutrition` still returns `NutritionData | null` for existing callers. The new `lookupNutritionOutcome` is used by the route that needs the difference. Only `found` is cached.
4. **Barcode path: throw a typed error.** `lookupBarcode` tracks `offErrored` (a non-404 non-OK response or a thrown fetch). `offDegraded = offErrored && !offProduct`. With no data from any source and `offDegraded`, it throws `BarcodeUpstreamError` instead of returning `null`. A degraded hit from the fallback sources is still returned, but the first-write-wins `barcodeNutrition` insert is skipped.
5. **Routes.** `GET /api/nutrition/lookup` maps `unavailable` → `503 NUTRITION_LOOKUP_FAILED` and `not-found` → `404`. Both barcode routes route their catch through `handleBarcodeRouteError` (`BarcodeUpstreamError` → 503, everything else → `handleRouteError`).
6. **Don't hammer a rate-limited source.** In `fetchUSDA`, a 429 opens a 5-minute `CircuitBreaker` (threshold 1, no retry, because retrying a quota 429 only burns quota). A 5xx or a network error that is not a timeout gets one retry after 300ms. While the breaker is open, USDA reports `unavailable`.

## Prevention

- A source adapter in a fallback chain returns a discriminated outcome, never `T | null`, whenever the source can fail independently of "no match". Check `res.ok` before `res.json()` on every upstream fetch.
- Never persist or cache a result built while the primary source was degraded, if the write is first-write-wins or long-TTL.
- If a test asserts "network error → null" or "→ 404", it pins the defect. One legacy test in `nutrition-lookup.test.ts` did, and it was rewritten to the new contract.
- The route status must match the client's retry contract: the client falls back on 5xx, never on 404.

## Related Files

- `server/services/nutrition-source-utils.ts` — `NutritionLookupOutcome`
- `server/services/nutrition-lookup.ts` — `fetchNutritionFromSources`, `lookupNutritionOutcome`, `lookupAPINinjas`
- `server/services/usda-lookup.ts` — `fetchUSDA` (429 breaker, single 5xx retry, status logging), `lookupUSDAByUPC`
- `server/services/barcode-lookup.ts` — `BarcodeUpstreamError`, `offDegraded`, skipped insert, OFF `User-Agent`
- `server/routes/nutrition.ts` — `handleBarcodeRouteError`, 503 vs 404 on `/api/nutrition/lookup`

## See Also

- [A shared helper that returns an empty list on failure makes 'unavailable' read as 'no results'](./lenient-helper-returning-empty-on-failure-reads-as-no-results-2026-09-28.md) — the same conflation in a list-returning helper, fixed with an opt-in strict mode
- [OpenAI SDK timeout and tiered error handling](../design-patterns/openai-sdk-timeout-and-error-handling-2026-05-13.md) — the AI-side version ("required data: throw, don't return an empty valid-looking result")
- [Fetch timeout with AbortSignal for every external API call](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md)
