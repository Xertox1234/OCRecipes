---
title: Rate limiting on auth endpoints
track: knowledge
category: design-patterns
module: server
tags: [security, rate-limiting, auth, brute-force, express]
applies_to: [server/routes/auth.ts, server/middleware/rate-limiter.ts]
created: '2026-05-13'
---

# Rate limiting on auth endpoints

## When this applies

Apply aggressive rate limiting to prevent brute force attacks on login, registration, and other auth endpoints.

## Examples

```typescript
import rateLimit from "express-rate-limit";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { error: "Too many registration attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  // Login logic
});

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  // Register logic
});
```

## Why

Brute force attacks against login (credential stuffing) and registration (account creation flooding) are mitigated by longer windows and tighter caps. Use IP-based key generation by default for auth — the user isn't authenticated yet.

## See Also

- [Rate limiting on external API endpoints](rate-limiting-external-api-endpoints-2026-05-13.md)
- [Rate limiter fail-closed on error](../conventions/rate-limiter-fail-closed-on-error-2026-05-13.md)
