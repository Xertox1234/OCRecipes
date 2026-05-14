---
title: "API key authentication (Stripe-style prefix + hash)"
track: knowledge
category: design-patterns
tags: [security, api-keys, bcrypt, public-api, authentication]
module: server
applies_to: ["server/middleware/api-key-auth.ts", "server/storage/api-keys.ts"]
created: 2026-05-13
---

# API key authentication (Stripe-style prefix + hash)

## When this applies

Public-facing APIs with developer API keys (separate from user JWT auth).

## How it works

For public APIs where external developers authenticate with long-lived keys (not JWTs), use a split storage approach: a plaintext **prefix** for DB lookup and a **bcrypt hash** for verification. The full key is shown once at creation time, never again.

## Examples

```typescript
// Key format: ocr_live_ + 32 hex chars (41 chars total)
const randomPart = crypto.randomBytes(16).toString("hex");
const plaintextKey = `ocr_live_${randomPart}`;

// PREFIX for DB lookup (must include random chars, not just the static part!)
const keyPrefix = plaintextKey.substring(0, KEY_PREFIX_LENGTH); // e.g., 16 chars

// HASH for verification (bcrypt — same as passwords)
const keyHash = await bcrypt.hash(plaintextKey, BCRYPT_ROUNDS);

// Store prefix (indexed) + hash. Never store plaintext.
await db.insert(apiKeys).values({ keyPrefix, keyHash, name, tier });
```

## Auth middleware flow

1. Read key from `X-API-Key` header (reject query params — they get logged in URLs)
2. Extract prefix → DB lookup by indexed `keyPrefix` column
3. `bcrypt.compare(rawKey, keyRow.keyHash)` to verify
4. Cache validated keys in-memory (60s TTL, bounded Map) to skip DB + bcrypt on repeat requests
5. Set `req.apiKeyId` and `req.apiKeyTier` for downstream middleware

## Critical gotcha

The prefix MUST include characters from the random portion of the key, not just the static prefix. If `KEY_PREFIX_LENGTH` only captures the static part (e.g., `"ocr_live"` = 8 chars), every key gets the same prefix and only one can ever authenticate.

## Related Files

- `server/middleware/api-key-auth.ts` — `requireApiKey` middleware with in-memory cache
- `server/storage/api-keys.ts` — `createApiKey`, `getApiKeyByPrefix`

## See Also

- [Hash secrets used as in-memory cache keys](../conventions/hash-secrets-in-memory-cache-keys-2026-05-13.md)
- [Admin auth via isAdmin() allowlist](../conventions/admin-auth-isadmin-allowlist-2026-05-13.md)
- [PII stripping in API response serialization](pii-stripping-api-response-serialization-2026-05-13.md)
