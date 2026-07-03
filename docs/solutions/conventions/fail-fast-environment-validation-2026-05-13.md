---
title: Fail-fast environment variable validation at module load
track: knowledge
category: conventions
module: server
tags: [api, env, startup, configuration]
applies_to: [server/**/*.ts]
created: '2026-05-13'
---

# Fail-fast environment variable validation at module load

## Rule

Validate required environment variables at module load time, not at request time. If a required variable is missing, throw during import so the server fails to start.

## Why

Failing at request time means the operator only learns about the misconfiguration the first time a real user hits the endpoint, often hours after deploy. Failing at module load surfaces the problem immediately in startup logs and prevents the process from accepting connections in a broken state.

## Examples

```typescript
// Good: Fails immediately on server start
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export function requireAuth(req, res, next) {
  // JWT_SECRET is guaranteed to exist here
  jwt.verify(token, JWT_SECRET);
}
```

```typescript
// Bad: Fails on first request, harder to debug
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }
}
```

## Exceptions

For projects with many env vars, prefer the centralized Zod schema validator (see below) so all missing variables surface at once rather than one at a time.

## Related Files

- `server/middleware/auth.ts` — `JWT_SECRET` module-load check

## See Also

- [Centralized environment validation with Zod schema](../design-patterns/centralized-env-validation-zod-2026-05-13.md)
- [Startup warning for optional environment variables](startup-warning-optional-env-vars-2026-05-13.md)
