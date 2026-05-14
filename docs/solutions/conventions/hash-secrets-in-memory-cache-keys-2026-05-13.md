---
title: "Hash secrets used as in-memory cache keys"
track: knowledge
category: conventions
tags: [security, in-memory-cache, secrets, sha256, heap-dump]
module: server
applies_to: ["server/middleware/**/*.ts"]
created: 2026-05-13
---

# Hash secrets used as in-memory cache keys

## Rule

When caching the result of a secret lookup (e.g. API key → userId), never store the raw secret as the `Map` key. A heap dump or debug log would expose every cached secret. Instead, hash the secret with SHA-256 and use the digest as the key.

## Examples

```typescript
import { createHash } from "crypto";

// ❌ BAD: raw API key sits in memory as a Map key
const apiKeyCache = new Map<string, { userId: number; expiresAt: number }>();
apiKeyCache.set(rawKey, { userId, expiresAt });

// ✅ GOOD: SHA-256 digest as key
function cacheKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
const apiKeyCache = new Map<string, { userId: number; expiresAt: number }>();
apiKeyCache.set(cacheKey(rawKey), { userId, expiresAt });
```

## When to use

Any in-memory cache (Map, object, LRU) keyed by a secret value — API keys, tokens, session IDs.

## Why

Secrets in memory are accessible via heap dumps, core dumps, or debug endpoints. Hashing makes the cache opaque without affecting lookup performance — SHA-256 of a short string is fast and the digest is a stable lookup key.

## Related Files

- `server/middleware/api-key-auth.ts` — `cacheKey()`, `apiKeyCache`

## See Also

- [API key authentication (Stripe-style prefix + hash)](../design-patterns/api-key-auth-stripe-style-prefix-hash-2026-05-13.md)
