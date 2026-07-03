---
title: Public-CDN object keys must not be derivable from exposed user identifiers
track: bug
category: logic-errors
module: server
severity: critical
tags: [security, r2, cdn, object-keys, idempotency, migration]
symptoms: [deterministic object key derived from userId (even hashed) on a public bucket, avatar/PII URL guessable by anyone who knows a user id exposed elsewhere in the API]
applies_to: [server/scripts/**/*.ts, server/lib/image-store.ts]
created: '2026-06-10'
---

## Problem

While making a one-shot disk-to-R2 image migration idempotent — using deterministic keys so a failed DB UPDATE does not orphan the uploaded object on re-run — the first implementation derived public-CDN avatar keys as `unsalted sha256(userId)`. Code review flagged this as **critical**.

## Symptoms

- Deterministic object key derived from `userId` (even hashed) on a public bucket.
- Avatar/PII URL guessable by anyone who knows a user id exposed elsewhere in the API.
- The random key had been the **sole access control** on that bucket — no authentication required to fetch objects.

## Root Cause

An unsalted hash of an exposed identifier is still **identifier-derived**. Hashing provides non-reversibility but **not** non-derivability. User IDs are exposed cross-user (community recipe responses include `authorId` via `server/storage/community-recipes.ts`), so anyone could forward‑compute:

```
avatar / avatar-migrated-<sha256(authorId).slice(0,32)>.<ext>
```

Only three extension candidates exist, making enumeration trivial.

## Solution

Mix the **image content hash** into the digest:

```
sha256(userId + ':' + sha256(imageBytes)).slice(0,32)
```

This stays deterministic across re‑runs (same source file → same key, preserving idempotency) but cannot be computed without possessing the avatar bytes themselves — exactly what the attacker is trying to fetch. Including the `userId` prevents two users with identical images from sharing one object whose deletion would break the other’s URL.

**Alternative** (when no stable content is available): HMAC-SHA256 with a server‑side secret.

**Residual accepted trade‑off**: a confirmation oracle — an attacker holding a candidate image **and** a user id can confirm “user X’s avatar is exactly image Y”. HMAC with a secret eliminates this.

## Prevention

- Never derive public‑bucket object keys from user identifiers, even hashed.
- For idempotent migrations, prefer content‑hash‑mixed keys or HMAC‑with‑secret.
- Runtime upload paths should keep `crypto.randomUUID()` keys.
- Any filename/key override parameter added to a shared save function must validate against a single‑segment safe charset (reject `/`, `\`, `..`) so future callers cannot turn it into key‑injection or path traversal.

## Related Files

- `server/scripts/migrate-images-to-r2.ts`
- `server/lib/image-store.ts`
- `server/storage/community-recipes.ts`

## See Also

None needed.
