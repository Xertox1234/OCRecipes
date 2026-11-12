---
title: "\"Our image\" decided by URL prefix accepts paths we never stored — match the exact stored shape, <base>/<folder>/<one filename>, on classify and on delete"
track: bug
category: logic-errors
module: server
severity: low
tags: [security, api, architecture]
symptoms: [A client-supplied image URL that starts with the CDN base is saved unchanged as if the server had stored it, classifyRecipeImageUrl returns "ours" for a URL with extra path segments or percent-escapes, deleteImage derives a storage key with a slash or dot-dot in it]
applies_to: ["server/lib/recipe-image-keys.ts", "server/lib/image-store.ts", "server/services/recipe-image-rehost.ts", "server/routes/**/*.ts"]
created: 2026-11-12
---

# "Our image" decided by URL prefix accepts paths we never stored

## Problem

`classifyRecipeImageUrl` answered "ours" for any URL that **started with**
`<R2 base>/recipe-images/` or `/api/recipe-images/`. "Ours" is a trust decision: an
"ours" URL is saved as it is, without the fetch-and-rehost an external URL gets, and
`deleteImage` derives a storage key from it. A URL can arrive from a client, so a prefix
match also accepted `<base>/recipe-images/a/b/c.jpg`, `…/recipe-images/%2e%2e/x` and
other shapes the server never writes (security audit 2026-11-12, L11).

No exploit was shown — the bucket holds only public images — but the delete path would
have sent whatever key the URL spelled, inside the kind's prefix, to storage.

## Symptoms

- A recipe row holds an image URL under our base that no upload produced.
- A delete call's key contains a second `/` after the folder.

## Root Cause

A prefix says where a URL starts, not what it is. Everything the server stores has one
shape — `<prefix>/<one filename>` where the filename is `[A-Za-z0-9._-]+` — and the check
did not use that fact.

## Solution

One predicate for the stored shape, used by every reader of it:

```ts
// server/lib/recipe-image-keys.ts
export function isSafeStoredFilename(filename: string): boolean {
  return (
    /^[A-Za-z0-9._-]+$/.test(filename) &&
    !filename.includes("..") &&
    !/^\.+$/.test(filename)
  );
}
```

- `classifyRecipeImageUrl`: after the folder prefix, strip the `?v=` query and require
  `isSafeStoredFilename` on the rest; otherwise the URL is `external`.
- `deleteImage` (`server/lib/image-store.ts`): after deriving the key, require
  `<prefix>/<isSafeStoredFilename>`; any other shape is the same silent no-op an unknown
  URL already gets.
- `assertSafeFilenameOverride` uses the same predicate, so writer and readers agree.

The delete stays inside `image-store.ts`, per the owner ruling of 2026-11-06 (storage
calls `deleteImage` itself after commit).

## Prevention

- "Is this ours?" is answered by the full shape the writer produces, with the writer's
  own predicate — never `startsWith(base)`.
- A new image kind or folder adds its folder to the classifier and keeps the
  one-filename rule.
- Strip the cache-bust query before the shape check (see below).

## Related Files

- `server/lib/recipe-image-keys.ts` — `isSafeStoredFilename`, `classifyRecipeImageUrl`
- `server/lib/image-store.ts` — `deleteImage` shape guard
- `server/lib/__tests__/recipe-image-keys.test.ts`, `server/lib/__tests__/image-store.test.ts`

## See Also

- [derive-storage-key-must-strip-query-before-delete](derive-storage-key-must-strip-query-before-delete-2026-06-29.md) — the query half of deriving a key from a stored URL
- [ssrf-ipv6-mapped-hex-form-and-bracketed-hostname](ssrf-ipv6-mapped-hex-form-and-bracketed-hostname-2026-10-29.md) — what an `external` URL goes through instead
