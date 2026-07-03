---
title: Overwrite-in-place at the same URL doesn't bust URL-keyed client caches
track: knowledge
category: conventions
module: server
tags: [cache-busting, expo-image, r2, image-store, overwrite-in-place, client-cache]
applies_to: [server/scripts/backfill-recipe-images.ts, server/lib/image-store.ts]
created: '2026-06-29'
---

# Overwrite-in-place at the same URL doesn't bust URL-keyed client caches

## Rule

When you overwrite a stored asset at its SAME key/URL (idempotent
overwrite-in-place), append or bump a `?v=<token>` version query on the stored
URL so URL-keyed client caches re-fetch. Overwriting the bytes alone is invisible
to any client that caches by URL.

## Smell patterns

- A backfill / refresh job that re-uploads to the same R2 key and leaves the DB
  `imageUrl` unchanged "to avoid a DB write".
- "The server/CDN serves the new image but the app/device still shows the old one."

## Why

`expo-image` (and browsers) cache images keyed on the full URI and do not
revalidate by default. Overwrite-in-place keeps the URL identical, so the cache
key never changes and the client serves its stale cached bytes indefinitely. The
R2 CDN here is uncached (`cf-cache-status: DYNAMIC`), so the server is always
fresh — the staleness is purely client-side. Bumping `?v=` changes the cache key
→ re-fetch.

There are two cache layers to invalidate, and they clear at different moments:
the `?v=` busts the **image** cache (expo-image), but clients only learn the new
URL after the **data** cache (TanStack Query, persisted to AsyncStorage) refetches
the recipe row — a pull-to-refresh triggers that cascade.

## Examples

```ts
// bustImageUrl: replace any prior token, never stack
export function bustImageUrl(url: string, version: string | number): string {
  return `${url.split("?")[0]}?v=${version}`;
}

// backfill: on refresh, write the bumped URL back to the DB
await db
  .update(communityRecipes)
  .set({ imageUrl: bustImageUrl(r.imageUrl, RUN_VERSION) })
  .where(eq(communityRecipes.id, r.id));
```

`backfill-recipe-images.ts` also exposes `--bump-version-only` to bust caches
WITHOUT regenerating (no image-provider spend) when the bytes are already current.

## Exceptions

- New objects written at a fresh random key need no version — the URL is already unique.
- Content-hashed keys (key derived from the bytes) change naturally on new content, so no `?v=` is needed.

## Related Files

- `server/scripts/backfill-recipe-images.ts` — bumps `?v=` on refresh; `--bump-version-only`
- `server/lib/recipe-image-keys.ts` — `bustImageUrl`

## See Also

- [deriving a storage key from a stored url must strip the cache-bust query](../logic-errors/derive-storage-key-must-strip-query-before-delete-2026-06-29.md) — the orphan bug this convention can introduce in delete paths
