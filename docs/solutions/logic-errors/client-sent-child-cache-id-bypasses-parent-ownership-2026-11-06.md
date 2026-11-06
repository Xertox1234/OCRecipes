---
title: "A child cache looked up by a client-sent parent id skips the parent's ownership scope — and an upsert that keeps the parent id revives the old children"
track: bug
category: logic-errors
tags: [security, database, cache, idor, ownership, upsert, parent-child-cache, suggestions]
module: server
symptoms: ["one user can read another user's cached AI instructions by sending their cacheId", "a cache miss writes attacker-titled text under another user's cache row", "after suggestions are regenerated, a new suggestion shows the old one's instructions"]
created: 2026-11-06
severity: high
---

# A client-sent child-cache id skips the parent's ownership scope

## Problem

The parent `suggestion_cache` is keyed correctly on (scanned item, user, profile hash) and returns its serial `id` to the client as `cacheId`. The child `instruction_cache` was read and written by `(suggestionCacheId, suggestionIndex)` only, with that `cacheId` taken from the request body (`POST /api/items/:itemId/suggestions/:index/instructions`).

## Symptoms

- Read: any premium user could send another user's (guessable, serial) `cacheId` and get instructions generated from that user's dietary profile.
- Write: on a miss, the AI ran with the caller's `suggestionTitle` and the result was written under the victim's `cacheId`.
- Separately, `createSuggestionCache` upserts with `onConflictDoUpdate`, which **keeps the row id**; the old instruction rows (FK on that id, cascade on delete only) became valid again under the new `expiresAt` and were served for different suggestions at the same index.

## Root Cause

The ownership check lived on the parent; the child trusted a parent id the client chose. An upsert is an UPDATE, not a delete and re-insert, so `ON DELETE CASCADE` never fires on refresh.

## Solution

- Both child functions take `{ userId, scannedItemId }`. The read joins the parent and filters both. The write checks the parent row under `FOR SHARE` inside its own transaction and writes nothing if it is not the caller's.
- The parent upsert deletes its child rows in the same transaction.

## Prevention

- A client-supplied parent id for a child lookup is honoured only inside the caller's own parent row — scope the READ and the WRITE (the fire-and-forget write is the poison path).
- When a parent cache refreshes with `onConflictDoUpdate`, clear (or version) its children in the same transaction.

## Related Files

- `server/storage/cache.ts` (`getInstructionCache`, `createInstructionCache`, `createSuggestionCache`)
- `server/routes/suggestions.ts`
- `server/storage/__tests__/cache.test.ts`

## See Also

- `docs/solutions/design-patterns/parent-child-cache-cascade-delete-2026-05-13.md`
- `docs/rules/security.md` (ownership scoping in the SQL of every storage fn taking a user-supplied id — reads AND writes)
