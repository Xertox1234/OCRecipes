---
title: Token versioning for JWT revocation
track: knowledge
category: design-patterns
module: server
tags: [security, jwt, auth, revocation, token-versioning]
applies_to: [server/middleware/auth.ts, server/routes/auth.ts, shared/types/auth.ts]
created: '2026-05-13'
---

# Token versioning for JWT revocation

## When this applies

Any system using stateless JWTs that needs server-side revocation (logout, password reset, account compromise) and cannot rely on short token expiry alone.

## When NOT to use

- Systems with session stores (revocation is already built in)
- Short-lived tokens (< 5 minutes) where expiry is sufficient

## How it works

Embed a `tokenVersion` counter in JWT payloads. On logout (or password change), increment the counter in the database. The auth middleware compares the token's version against the DB value — a mismatch means the token has been revoked. Combined with an in-memory TTL cache, this achieves near-instant revocation with minimal DB overhead.

## Examples

```typescript
// shared/types/auth.ts — token payload shape
export interface AccessTokenPayload {
  sub: string;
  tokenVersion: number;
}

// server/routes/auth.ts — generate token with version
import { generateToken } from "../middleware/auth";

const token = generateToken(user.id, user.tokenVersion);

// server/routes/auth.ts — logout: bump version + invalidate cache
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await storage.updateUser(req.userId!, {
    tokenVersion: sql`${users.tokenVersion} + 1`,
  });
  invalidateTokenVersionCache(req.userId!);
  res.json({ message: "Logged out" });
});

// server/middleware/auth.ts — verify version on every request
const payload = jwt.verify(token, jwtSecret);
if (!isAccessTokenPayload(payload)) {
  /* 401 */
}

const cachedVersion = getCachedTokenVersion(payload.sub);
if (cachedVersion !== undefined) {
  if (payload.tokenVersion !== cachedVersion) {
    return res
      .status(401)
      .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
  }
} else {
  const user = await storage.getUser(payload.sub);
  setCachedTokenVersion(payload.sub, user.tokenVersion);
  if (payload.tokenVersion !== user.tokenVersion) {
    return res
      .status(401)
      .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
  }
}
```

## Why

JWTs are stateless by design, so there is no built-in "revoke" mechanism. Token versioning adds a lightweight state check that only hits the DB once per cache TTL window. The tradeoff is a maximum `CACHE_TTL_MS` delay between logout and token rejection on other devices.

## Related Files

- `server/middleware/auth.ts` — `requireAuth`, `invalidateTokenVersionCache`, in-memory cache
- `server/routes/auth.ts` — logout handler that bumps `tokenVersion`
- `shared/types/auth.ts` — `AccessTokenPayload` interface and `isAccessTokenPayload` type guard
- `shared/schema.ts` — `tokenVersion` column on the `users` table
