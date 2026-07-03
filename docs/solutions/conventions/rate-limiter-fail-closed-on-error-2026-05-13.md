---
title: Rate limiter must fail closed on backing-store error
track: knowledge
category: conventions
module: server
tags: [security, rate-limiting, fail-closed, error-handling]
applies_to: [server/middleware/api-rate-limit.ts, server/middleware/**/*.ts]
created: '2026-05-13'
---

# Rate limiter must fail closed on backing-store error

## Rule

When a rate limiter's backing store (Redis, database, in-memory Map) throws an error, reject the request with 503 instead of letting it through. Fail-open is the default in many libraries but creates an exploitable bypass.

## Examples

```typescript
// ✅ GOOD: Fail closed — reject when we can't verify limits
try {
  currentCount = await storage.getApiKeyUsage(apiKeyId, yearMonth);
} catch (err) {
  console.error("Rate limit check error:", err);
  sendError(res, 503, "Service temporarily unavailable", "SERVICE_UNAVAILABLE");
  return;
}

// ❌ BAD: Fail open — attacker can trigger store errors to bypass limits
try {
  currentCount = await storage.getApiKeyUsage(apiKeyId, yearMonth);
} catch (err) {
  console.error("Rate limit check error:", err);
  next(); // Let the request through!
  return;
}
```

## When to use

Any custom rate limiter or usage counter where the backing store can fail. This includes API key monthly usage checks, per-user daily quotas, and any middleware that reads counts from a database.

## When NOT to use

`express-rate-limit` with its default in-memory store (which cannot fail). If you use `express-rate-limit` with an external store (Redis), configure its `handler` option for fail-closed behavior.

## Why 503 not 429

The request is not over the limit — we simply cannot verify whether it is. 503 signals a temporary service issue, and clients with retry logic will back off. Conflating "we don't know your limit" with "you exceeded your limit" hides operational issues from monitoring.

## Related Files

- `server/middleware/api-rate-limit.ts` — fail-closed on DB error

## See Also

- [Rate limiting on auth endpoints](../design-patterns/rate-limiting-auth-endpoints-2026-05-13.md)
- [Rate limiting on external API endpoints](../design-patterns/rate-limiting-external-api-endpoints-2026-05-13.md)
