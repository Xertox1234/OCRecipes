---
title: "Rate limiting on external API endpoints"
track: knowledge
category: design-patterns
tags: [security, rate-limiting, openai, cost-control, express]
module: server
applies_to: ["server/routes/**/*.ts", "server/middleware/rate-limiter.ts"]
created: 2026-05-13
---

# Rate limiting on external API endpoints

## When this applies

Apply rate limiting to endpoints that call expensive external APIs (OpenAI, payment processors, third-party services).

## Examples

```typescript
import rateLimit from "express-rate-limit";

const photoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: "Too many photo uploads. Please wait." },
  keyGenerator: (req) => req.userId || req.ip || "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to endpoints calling external APIs
app.post("/api/photos/analyze", requireAuth, photoRateLimit, upload.single("photo"), ...);
app.post("/api/photos/analyze/:sessionId/followup", requireAuth, photoRateLimit, ...);
```

## Why

Prevents cost explosion from malicious or accidental overuse of paid APIs.

## Key differences from auth rate limiting

| Auth Endpoints              | External API Endpoints          |
| --------------------------- | ------------------------------- |
| Prevent brute force attacks | Prevent cost explosion          |
| Longer windows (15min-1hr)  | Shorter windows (1min)          |
| Tighter limits (5-10 total) | Higher limits per minute        |
| IP-based by default         | User ID-based for authenticated |

## See Also

- [Rate limiting on auth endpoints](rate-limiting-auth-endpoints-2026-05-13.md)
- [Rate limiter fail-closed on error](../conventions/rate-limiter-fail-closed-on-error-2026-05-13.md)
- [Premium-gate parity across endpoints hitting expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
