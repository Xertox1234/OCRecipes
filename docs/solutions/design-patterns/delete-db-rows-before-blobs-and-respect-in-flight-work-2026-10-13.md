---
title: When a cleanup job removes rows and their stored objects, delete the rows first (RETURNING the object keys) and delete only the objects of rows actually removed
track: knowledge
category: design-patterns
module: server
tags: [database, performance, r2, cleanup, concurrency]
applies_to: [server/scripts/**/*.ts, server/storage/**/*.ts]
created: '2026-10-13'
---

# Delete DB rows before their blobs, and only the blobs of rows you actually deleted

## When this applies

A batch job lists expendable rows and removes both the rows and the R2 objects they point to. Meanwhile a user action can claim one of those rows between the list and the delete. Example: inspired-recipe idea cards expire after 24 h, but "Make this mine" can turn a card into a recipe, and the card's photo becomes the recipe's photo.

## Rule

1. **List, then delete with a guard and `RETURNING`.**
   `DELETE … WHERE id = ANY($ids) AND made_recipe_id IS NULL AND <no live work> RETURNING id, image_url`.
2. **Delete objects only for the returned rows.** A row the guard skipped (claimed mid-purge) keeps its object.
3. **A failed object delete is non-fatal** and leaves an orphan. That is harmless, while the reverse order breaks a live record.
4. **Guard against in-flight work, not just finished work.** A claim that started before expiry and finishes after it must not lose its photo. Also skip rows whose work lock is live.
5. **Bound the loop** (`MAX_BATCHES`). The guard means a re-list can't spin on undeletable rows, but bound it anyway.

## Why

The first version deleted photos for every listed row, then deleted the rows. A card claimed between those two steps survived as a recipe whose photo had just been deleted. Deleting rows first turns the race's failure mode from "a live recipe points at a missing image" into "an orphaned object in the bucket".

## Examples

```ts
// server/scripts/purge-inspired-suggestions.ts
const batch = await storage.listExpiredUnmadeSuggestions(now, batchSize);
const deleted = await storage.deleteInspiredSuggestions(batch.map((r) => r.id)); // RETURNING {id, imageUrl}
for (const row of deleted) {
  if (!row.imageUrl) continue;
  try { await deleteImage(row.imageUrl, "recipe"); } catch (err) { log.warn(…); }
}
```

The same rule applies to the **writer** side. A background photo generator must refuse to attach a late photo to a row that is made, or that is mid-make. When it is refused, it deletes the object it just uploaded.

(Inspired cards became text-only on 2026-10-14, so their card-photo writer, `setInspiredSuggestionImage` + `suggestion-image.ts`, was removed. The purge still deletes the photos of rows from before that change. The writer rule still holds for any other background uploader.)

## Exceptions

- A **one-off migration** that deletes rows (e.g. `0027_delete_catalog_recipes.sql`) can't delete R2 objects from SQL. Note the orphans in its header.
- Restart any in-memory index built at boot after running it.

## Related Files

- `server/scripts/purge-inspired-suggestions.ts`
- `server/storage/inspired-suggestions.ts` — `deleteInspiredSuggestions`, `noLiveMakeLock`

## See Also

- [kind-scoped-object-deletion-r2-lifecycle](kind-scoped-object-deletion-r2-lifecycle-2026-06-11.md) — scoping and post-commit deletion of R2 objects
- [conditional-update-lock-release](../logic-errors/conditional-update-lock-release-must-compare-its-own-token-2026-10-13.md) — the lock this purge respects
