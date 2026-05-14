---
title: "Service availability guard (checkAiConfigured) for optional services"
track: knowledge
category: design-patterns
tags: [api, openai, availability, helper, 503]
module: server
applies_to: ["server/routes/**/*.ts", "server/routes/_helpers.ts"]
created: 2026-05-13
---

# Service availability guard (checkAiConfigured) for optional services

## When this applies

Any route that calls OpenAI or another optional external service. Check before doing any expensive work (file processing, Zod validation of large payloads). When a route depends on an optional external service, use a guard function that returns `false` and sends a 503 response when the service is not configured.

## Why

This prevents cryptic errors deep in service code when the operator hasn't set the optional API key. 503 (Service Unavailable) signals the feature is temporarily unavailable, not a bug — clients can show a friendly "this feature is offline" message instead of an error toast.

## Examples

```typescript
// server/routes/_helpers.ts
import { isAiConfigured } from "../lib/openai";

export function checkAiConfigured(res: Response): boolean {
  if (!isAiConfigured) {
    sendError(
      res,
      503,
      "AI features are not available. Please try again later.",
      "AI_NOT_CONFIGURED",
    );
    return false;
  }
  return true;
}

// Usage in route handler — early return before any AI work
app.post(
  "/api/photos/analyze",
  requireAuth,
  photoRateLimit,
  upload.single("photo"),
  async (req: Request, res: Response) => {
    if (!checkAiConfigured(res)) return;
    // ... proceed with AI analysis
  },
);
```

## Key elements

1. **503 (Service Unavailable)**, not 500 — signals the feature is temporarily unavailable, not a bug
2. **Boolean return** — allows clean `if (!check) return;` pattern in handlers
3. **Machine-readable code** — `"AI_NOT_CONFIGURED"` for client-side handling
4. **Module-level boolean** — `isAiConfigured` is evaluated once at import time, not per-request

## Exceptions

Required services (database, auth) — those should fail at startup via `validateEnv()`.

## Related Files

- `server/routes/_helpers.ts` — `checkAiConfigured()`
- `server/lib/openai.ts` — `isAiConfigured` export
- `server/routes/photos.ts` — usage example

## See Also

- [Centralized environment validation with Zod schema](centralized-env-validation-zod-2026-05-13.md)
- [Stub service with production safety gate](stub-service-production-safety-gate-2026-05-13.md)
