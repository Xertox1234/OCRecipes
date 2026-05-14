---
title: "Persistent monthly rate limiting (DB-backed, billing-period)"
track: knowledge
category: design-patterns
tags: [api, rate-limiting, billing, middleware, drizzle]
module: server
applies_to: ["server/middleware/**/*.ts", "server/storage/**/*.ts"]
created: 2026-05-13
---

# Persistent monthly rate limiting (DB-backed, billing-period)

## When this applies

For billing-period rate limits (monthly quotas per API key), use custom middleware with persistent DB counters instead of `express-rate-limit` (which uses in-memory sliding windows that reset on server restart).

## Why

`express-rate-limit` is designed for abuse prevention over short windows (60s to 15min). For monthly billing enforcement you need durability across restarts and consistency across multiple instances. A DB-backed counter (with an in-memory cache layer for read latency) is the right tool.

## Examples

```typescript
// Atomic upsert: INSERT or increment existing counter
await db
  .insert(apiKeyUsage)
  .values({ apiKeyId, yearMonth, requestCount: 1, lastRequestAt: now })
  .onConflictDoUpdate({
    target: [apiKeyUsage.apiKeyId, apiKeyUsage.yearMonth],
    set: {
      requestCount: sql`${apiKeyUsage.requestCount} + 1`,
      lastRequestAt: now,
    },
  });
```

The `(apiKeyId, yearMonth)` pair is enforced as a unique index (`api_key_usage_unique_idx` in `shared/schema.ts`) so the `onConflictDoUpdate` target is correct.

## Middleware flow

1. Read current usage from DB (or in-memory cache with 60s TTL)
2. Compare against `TIER_FEATURES[tier].requestsPerMonth`
3. Set headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
4. If over → 429 with `TIER_LIMIT_EXCEEDED`
5. If under → increment counter (fire-and-forget), call `next()`

## Key differences from express-rate-limit

| Aspect   | `express-rate-limit`          | Persistent monthly limiter   |
| -------- | ----------------------------- | ---------------------------- |
| Window   | Short (60s–15min)             | Monthly billing period       |
| Storage  | In-memory (resets on restart) | Database (survives restarts) |
| Key      | `req.userId` or IP            | `req.apiKeyId`               |
| Use case | Abuse prevention              | Billing enforcement          |

## Fail-open policy

If the DB is unreachable, let the request through. A few extra requests during an outage are better than blocking all API consumers. Log the error for investigation.

## Related Files

- `server/middleware/api-rate-limit.ts` — `apiRateLimiter` middleware
- `server/storage/api-keys.ts` — `incrementUsage`, `getUsage`
- `shared/constants/api-tiers.ts` — `TIER_FEATURES` config
- `shared/schema.ts` — `apiKeyUsage` table and `api_key_usage_unique_idx`

## See Also

- [createRateLimiter factory for consistent rate limiter defaults](create-rate-limiter-factory-2026-05-13.md)
- [Rate limiter fail-closed on error](../conventions/rate-limiter-fail-closed-on-error-2026-05-13.md)
