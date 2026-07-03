---
title: Deriving a storage key from a stored URL must strip the cache-bust query
track: bug
category: logic-errors
module: server
severity: medium
tags: [r2, image-store, cache-busting, url-parsing, orphaned-objects, delete]
symptoms: [deleteImage runs without error but the R2 object stays in the bucket (orphaned), derived Key looks like recipe-images/recipe-x.png?v=1719... instead of recipe-images/recipe-x.png, path.basename(url) returns recipe-x.png?v=... so the disk unlink misses the real file]
applies_to: [server/lib/image-store.ts, server/scripts/backfill-recipe-images.ts]
created: '2026-06-29'
---

# Deriving a storage key from a stored URL must strip the cache-bust query

## Problem

Recipe image URLs carry a `?v=<token>` cache-bust query on the stored `imageUrl`
(added so URL-keyed client caches re-fetch after an overwrite-in-place). Any code
that derives the R2 object key (or disk filename) from that stored URL by
slicing / `path.basename` **without stripping the query** produces a key that
includes `?v=...`, which does not match the real object key. The delete then
targets a non-existent key, silently "succeeds", and leaves the real object
orphaned.

## Symptoms

- `deleteImage(url, "recipe")` returns without error but the R2 object remains.
- Derived `Key` = `recipe-images/recipe-x.png?v=1719600000000` (query leaked in).
- Disk path: `path.basename(url)` → `recipe-x.png?v=...` → `unlink` misses the file.

## Root Cause

The object key/filename is the URL path segment only; `?v=` is a client-cache
artifact that never appears in the stored key. `url.slice(base.length + 1)` and
`path.basename(url)` both keep the query because it sits at the end of the string.

## Solution

Strip the query before deriving the key:

```ts
const cleanUrl = url.split("?")[0];
// then slice / basename cleanUrl, not url
```

Applied in `deleteImage` (image-store.ts), `deriveRecipeImageFilename`
(recipe-image-keys.ts), and `cleanup-seed-recipes.ts`. Guard with a test
asserting the derived `Key` has NO query — mutation-proven (the test goes red if
the strip is removed).

## Prevention

When you change the format of a stored / serialized value (here: adding a query
string to a URL), audit EVERY consumer that parses it back into a key/id —
especially delete and cleanup paths. `tsc` cannot see a string-format change, so
the regression is silent until objects start orphaning.

## Related Files

- `server/lib/image-store.ts` — `deleteImage` strips the query before key derivation
- `server/lib/recipe-image-keys.ts` — `deriveRecipeImageFilename` strips it; `bustImageUrl`
- `server/scripts/cleanup-seed-recipes.ts`
- `server/lib/__tests__/image-store.test.ts` — mutation-proven strip test

## See Also

- [overwrite-in-place needs a url version token to bust client caches](../conventions/overwrite-in-place-bump-version-to-bust-client-cache-2026-06-29.md) — the format change that introduced this risk
