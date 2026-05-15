---
title: "Use the requireAuth middleware — never write manual auth checks in handlers"
track: knowledge
category: conventions
tags: [auth, middleware, express, consistency, security]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-02-24
---

# Use the requireAuth middleware — never write manual auth checks in handlers

## Rule

Every authenticated endpoint must use the `requireAuth` middleware. Do not write `if (!req.userId) return res.status(401)...` inline in route handlers.

```typescript
// Good — middleware handles auth consistently
app.get(
  "/api/chat/conversations",
  requireAuth,
  chatRateLimit,
  async (req, res) => {
    const conversations = await storage.getChatConversations(req.userId!);
    res.json(conversations);
  },
);

// Bad — manual check, inconsistent with the rest of the codebase
app.get("/api/chat/conversations", chatRateLimit, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
  // ...
});
```

## Why

1. **Easy to forget** — the check must be added to every handler individually.
2. **No early-termination guarantee** — if the manual check sits after other middleware (rate limiting, logging), unauthenticated requests trigger side effects.
3. **Inconsistent error format** — the manual check might return a different error shape than `requireAuth`.
4. **Review burden** — reviewers must verify the auth check in every handler instead of trusting the middleware pipeline.

`requireAuth` is the single source of truth for "how does this app verify authentication."

## Examples

The middleware should appear **first** in the chain so unauthenticated requests do not consume rate-limit budget or other downstream resources:

```typescript
app.post("/api/recipes", requireAuth, recipeWriteRateLimit, async (req, res) => { ... });
```

## Exceptions

The only legitimate exception is an endpoint that behaves differently for authenticated vs unauthenticated users (e.g., a public read endpoint that adds extra fields when the caller is logged in). For these, decode the JWT optionally and branch — but do not skip the middleware entirely.

## Related Files

- `server/middleware/auth.ts` — `requireAuth` implementation
- `server/routes/chat.ts` — fixed to use middleware
- `docs/PATTERNS.md` — "Route Module Registration Structure" step 4

## See Also

- [IDOR protection: auth + ownership check](./idor-protection-auth-ownership-check-2026-05-13.md)
