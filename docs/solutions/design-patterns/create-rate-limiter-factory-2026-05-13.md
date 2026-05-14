---
title: "createRateLimiter factory for consistent rate limiter defaults"
track: knowledge
category: design-patterns
tags: [api, rate-limiting, helper, middleware, express]
module: server
applies_to: ["server/routes/_rate-limiters.ts", "server/routes/**/*.ts"]
created: 2026-05-13
---

# createRateLimiter factory for consistent rate limiter defaults

## When this applies

Every new rate limiter in the project. All rate limiters should be defined in `server/routes/_rate-limiters.ts` so they are centralized and reusable across route modules. The factory creates `express-rate-limit` middleware with consistent defaults and supports a `keyByUser` option (defaults to `true`) that uses `req.userId` for authenticated routes, falling back to IP.

## Why

Before the factory, each rate limiter was 6+ lines of identical boilerplate (`standardHeaders: true`, `legacyHeaders: false`, `message: { error: ... }`, `keyGenerator: ...`). The factory ensures every limiter uses the correct error shape (`{ error: string }` matching `sendError`), always sends standard headers, and correctly falls back from `userId` to IP. Adding a new rate limiter is now a single function call.

## Examples

```typescript
import { createRateLimiter } from "./_helpers";

// Authenticated route — keyed by userId (default)
export const photoRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many photo uploads. Please wait.",
});

// Unauthenticated route — keyed by IP
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again later",
  keyByUser: false,
});
```

Implementation:

```typescript
// server/routes/_helpers.ts
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  keyByUser?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: { error: options.message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.keyByUser !== false && {
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
  });
}
```

## Exceptions

- Rate limiters that need custom `keyGenerator` logic beyond userId/IP (define those inline)
- Third-party middleware that provides its own rate limiting
- Persistent monthly limits (use the custom DB-backed middleware instead — see Persistent monthly rate limiting)

## Related Files

- `server/routes/_rate-limiters.ts` — factory implementation and all 19 limiter instances

## See Also

- [Rate limiting on auth endpoints](rate-limiting-auth-endpoints-2026-05-13.md)
- [Rate limiting on external API endpoints](rate-limiting-external-api-endpoints-2026-05-13.md)
- [Persistent monthly rate limiting](persistent-monthly-rate-limiting-2026-05-13.md)
