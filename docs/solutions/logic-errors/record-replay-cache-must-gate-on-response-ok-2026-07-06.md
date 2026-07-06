---
title: 'Record/replay HTTP caches must gate writes on response.ok, not just response existing'
track: bug
category: logic-errors
tags: [caching, fetch, http, error-handling, dev-tooling]
module: server
symptoms: [A transient 429/500 from an external API gets replayed as a permanent success indefinitely, A dev-only fixture/replay cache never "fixes itself" even after the real upstream recovers, Debugging a "broken" barcode/query for a while only to find the local cache recorded a rate-limit response]
severity: medium
created: '2026-07-06'
---

# Record/replay HTTP caches must gate writes on response.ok, not just response existing

## Problem

A cache-writing fetch wrapper that persists whatever `response.status`/body came back — without checking `response.ok` — will happily memorize a transient failure (429 rate limit, 500 upstream error) exactly like it would a real success. Because a "recorded once, replayed forever" cache has no TTL and no distinction between "verified good data" and "whatever we happened to get last time," that one bad response becomes a permanent local fixture.

## Symptoms

- A dev-only record/replay cache (or any write-through cache fed directly from an external API response) returns the SAME error/empty result for a request that would succeed if retried live.
- The only way out is a human noticing and manually forcing a re-fetch (e.g. an explicit `refresh` mode).
- Two independent code reviewers flagged the identical root cause on the same diff (`server/services/dev-api-cache.ts`), which is itself a signal this is an easy trap to fall into when writing any success/miss caching wrapper.

## Root Cause

The natural first implementation of `if (miss) { call real API; store result; }` treats "the API call completed" as the caching trigger, when the actual invariant that must hold is "the API call SUCCEEDED." `fetch()` does not throw on a non-2xx status — `response.ok` is the only signal, and it's easy to omit when the immediate focus is wiring up the JSON parse + INSERT, not the failure path.

## Solution

Gate the cache write on `response.ok` (or `status >= 200 && status < 300` if `Response` isn't available): only persist a response the caller would actually treat as a success. Still RETURN the real (possibly failing) response to the caller unmodified — the gate is only about what gets memorized, not about suppressing the failure from the current request.

```typescript
const response = await fetch(url, init);
if (response.ok) {
  // ...cache write only happens here...
}
return response; // caller still sees the real status either way
```

## Prevention

- Any time you write "cache the result of an external call," ask explicitly: does this include error responses? Default answer should be no.
- For a record/replay-style cache with no TTL, this matters more than for a short-TTL cache (a short TTL self-heals in minutes; "recorded once, replayed forever" self-heals never).
- Cover it with a test: mock a non-2xx response and assert no cache-write query fired.

## Related Files

- `server/services/dev-api-cache.ts` — `cachedFetch()`'s `if (response.ok)` gate around `recordToCache(...)`
- `server/services/__tests__/dev-api-cache.test.ts` — "does not cache a non-2xx response" test

## See Also

- [Multi-source lookup chain with priority fallback](../design-patterns/multi-source-nutrition-lookup-chain-2026-05-13.md)
- [PostgreSQL Cache Tables for AI-Generated Content](../design-patterns/postgres-cache-table-ai-content-2026-05-13.md)
