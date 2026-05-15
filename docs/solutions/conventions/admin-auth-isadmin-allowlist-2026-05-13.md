---
title: "Admin auth via isAdmin() allowlist"
track: knowledge
category: conventions
tags: [security, admin, authorization, allowlist, env-var]
module: server
applies_to: ["server/routes/admin*.ts", "server/routes/verification.ts"]
created: 2026-05-13
---

# Admin auth via isAdmin() allowlist

## Rule

For admin-only endpoints (managing API keys, reviewing flags, system configuration), use a module-scoped `isAdmin()` function that checks the user's ID against a comma-separated `ADMIN_USER_IDS` environment variable. This is checked AFTER `requireAuth` — the user must be both authenticated and in the allowlist.

## Examples

```typescript
// Module-scoped — reads env on each call so changes apply without restart
function isAdmin(userId: string): boolean {
  const adminIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  return adminIds.includes(userId);
}

// Every admin endpoint follows the same guard pattern:
app.get("/api/admin/resource", requireAuth, async (req, res) => {
  if (!req.userId || !isAdmin(req.userId)) {
    return sendError(res, 403, "Admin access required", "UNAUTHORIZED");
  }
  // ... admin logic
});
```

## Checklist for admin endpoints

1. Always apply `requireAuth` middleware first (establishes `req.userId`)
2. Check `isAdmin(req.userId)` as the first line in the handler
3. Return 403 (not 401) — the user is authenticated but lacks permission
4. Apply a rate limiter (admin endpoints are still abuse targets)

## When to use

Any endpoint that should only be accessible to operators/admins (API key management, flag review, system health, data exports).

## When NOT to use

Endpoints gated by subscription tier — use `checkPremiumFeature()` instead.

## Why

Do NOT use `isAdmin()` as Express middleware because it needs `req.userId` from `requireAuth`, and the current pattern keeps the check explicit and visible in each handler. When the project adds RBAC, replace this allowlist with a role check.

## Related Files

- `server/routes/admin-api-keys.ts` — API key CRUD (4 endpoints)
- `server/routes/verification.ts` — reformulation flag review/resolve (2 endpoints)
- Environment variable: `ADMIN_USER_IDS` (comma-separated user IDs)
