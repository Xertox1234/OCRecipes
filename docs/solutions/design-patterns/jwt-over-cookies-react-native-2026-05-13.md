---
title: JWT over AsyncStorage Instead of Session Cookies in React Native
track: knowledge
category: design-patterns
module: shared
tags: [auth, jwt, react-native, expo, session, async-storage]
applies_to: [server/middleware/auth.ts, client/lib/token-storage.ts, shared/types/auth.ts]
created: '2026-05-13'
---

# JWT over AsyncStorage Instead of Session Cookies in React Native

## When this applies

Choosing an auth strategy for a React Native / Expo app that talks to an HTTP backend. Specifically when the development workflow includes Expo Go, where cookie persistence is unreliable.

## Why

Session-based authentication with `express-session` and HTTP cookies does not work reliably in React Native / Expo Go:

- Expo Go runs in a sandboxed JavaScript environment.
- HTTP cookies are not reliably persisted across app restarts.
- Cookie storage is inconsistent between iOS and Android in development mode.
- `Set-Cookie` headers from the server may be ignored by the native networking layer.

Cookies _can_ work in a production standalone build, but the development experience in Expo Go is broken: users get logged out at random, "remember me" doesn't survive a reload, and CI / Detox tests can't rely on session persistence. Stateless tokens dodge the entire category.

## Examples

The migration has three pieces:

1. **Server issues JWT on login / register**, signs with `JWT_SECRET`.
2. **Client stores token in `AsyncStorage`** with an in-memory cache (see [`../performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md`](../performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md)) for fast subsequent reads.
3. **Client sends `Authorization: Bearer <token>`** on every authenticated request.
4. **Server middleware validates the token** and attaches `userId` to `req`.

```typescript
// server/middleware/auth.ts — issue + validate
export function signToken(userId: number): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: "30d" });
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as {
      userId: number;
    };
    (req as AuthedRequest).userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
```

```typescript
// client/lib/token-storage.ts — cached read
let cachedToken: string | null = null;
let cacheInitialized = false;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      cachedToken = await AsyncStorage.getItem("auth_token");
      cacheInitialized = true;
    }
    return cachedToken;
  },
  async set(token: string): Promise<void> {
    cachedToken = token;
    cacheInitialized = true;
    await AsyncStorage.setItem("auth_token", token);
  },
  async clear(): Promise<void> {
    cachedToken = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem("auth_token");
  },
};
```

```typescript
// client — every authenticated request goes through apiRequest
const response = await apiRequest("GET", "/api/auth/me");
// apiRequest internally attaches Authorization: Bearer <token>
```

## Exceptions

- A pure web client served by the same backend, with no React Native consumer, can keep sessions + cookies — the trade-off only bites in the mobile/native context.
- High-security flows that require server-side revocation may add a `tokenVersion` column to enable revoke-on-logout (see security patterns for token versioning). The mobile-vs-cookie decision is separate from the revoke-on-logout decision.

## Related Files

- `server/middleware/auth.ts` — JWT generation and validation
- `client/lib/token-storage.ts` — token persistence with caching
- `shared/types/auth.ts` — shared auth types (User, AuthResponse)

## See Also

- [../performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md](../performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md) — Why the token storage caches in memory.
- `docs/legacy-patterns/security.md` — "Token Versioning for JWT Revocation" (server-side revocation pattern)
