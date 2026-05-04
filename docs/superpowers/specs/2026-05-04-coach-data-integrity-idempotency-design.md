---
title: Coach — Data Integrity & Idempotency
date: 2026-05-04
status: approved
plan: 3 of 5 (Coach deep-dive review)
---

## Overview

This plan fixes four data integrity issues in the Coach: the assistant message write has no idempotency guard (network retries can duplicate it), CommitmentCard acceptance is ephemeral state that never persists, `saveRecipeFromChat` can create duplicate recipe rows on retry, and the response cache is written before the DB write (creating a phantom cache entry if the DB fails).

## Scope

Files: `server/services/coach-pro-chat.ts`, `server/storage/recipe-from-chat.ts`, `client/components/coach/CoachChat.tsx`, `client/components/coach/blocks/CommitmentCard.tsx`

## Issue Inventory

### 1. Assistant message write has no idempotency guard (HIGH)

**Location:** `server/services/coach-pro-chat.ts:567–573`

**Problem:** After the SSE stream completes, the assistant message is written via a plain `createChatMessage` call. If the client retries the request (because the stream finished but the `done` event was never received due to a network timeout), the user message fails the daily limit check on retry (the advisory lock correctly deduplicates it), but `createChatMessage` is called again on the new stream — potentially creating a duplicate assistant message.

**Fix:** Add a `conversationTurnKey` to the request (a client-generated UUID for each send attempt, included in the POST body alongside `content`). The server stores this key in a new nullable `turnKey` column on `chatMessages`. Before writing the assistant message, check whether a message with the same `turnKey` and `role = "assistant"` already exists in the conversation. If it does, skip the write and yield the existing message ID in the `done` event so the client can display it. If not, write with the `turnKey`.

Schema change: `ALTER TABLE chatMessages ADD COLUMN turnKey TEXT` (nullable, no unique constraint — keyed by `(conversationId, turnKey, role)` lookups only).

Alternative approach (simpler): add the `turnKey` as a Drizzle `onConflictDoNothing` with a unique constraint on `(conversationId, turnKey)` where `turnKey` is non-null. This avoids the pre-check query. Preferred approach.

### 2. CommitmentCard acceptance never persisted (HIGH)

**Locations:** `client/components/coach/CoachChat.tsx:356–362`, `client/components/coach/blocks/CommitmentCard.tsx:14`

**Problem A:** `handleCommitmentAccept` in `CoachChat` is a no-op stub — the callback body is empty, `_title` and `_followUpDate` are unused.

**Problem B:** `CommitmentCard` tracks acceptance via local `useState`. When the message list re-fetches after the next stream, `useState` resets and the accepted state is lost.

**Fix, two-part:**

**Part A — Server endpoint:** Add `POST /api/chat/commitments/:notebookEntryId/accept` that updates the matching `coachNotebook` row to `status = 'accepted'` (or a new `'completed'` status distinct from `'archived'`). The `notebookEntryId` is available on the `CommitmentCard` block schema — verify it is already included in the block JSON, and add it if not.

**Part B — Client wiring:**

- Implement `handleCommitmentAccept` in `CoachChat` to call the new endpoint via a `useMutation`.
- Store accepted commitment IDs in a `useRef<Set<number>>` within `CoachChat` (session-scoped, like the QuickReplies fix in Plan 2).
- Pass `isAccepted` as a prop to `CommitmentCard` based on the ref set, so the accepted state survives re-fetches within the session.
- For cross-session persistence: the `coachNotebook` row updated server-side is the source of truth. On a future re-render, the block's `notebookEntryId` can be used to check the notebook status. This can be done lazily — for now, the ref is sufficient.

If the `CommitmentCard` block schema does not currently include `notebookEntryId`, add it to the schema and ensure `parseBlocksFromContent` populates it from the notebook extraction results.

### 3. saveRecipeFromChat duplicate on retry (MEDIUM)

**Location:** `server/storage/recipe-from-chat.ts:85–119`

**Problem:** If the recipe insert commits but the metadata back-reference update fails, a retry creates a duplicate `communityRecipe` row for the same message (no idempotency on the insert path).

**Fix:** Add a unique constraint on `(sourceMessageId)` in `communityRecipes` (or use `onConflictDoNothing` keyed on `sourceMessageId`). Before inserting, check whether a `communityRecipe` with the same `sourceMessageId` already exists. If it does, return the existing recipe ID and skip the insert. This makes the full operation idempotent — re-running it returns the same result.

### 4. Cache written before DB (LOW)

**Location:** `server/services/coach-pro-chat.ts:545–554`

**Problem:** The coach response cache is written via `fireAndForget` before `createChatMessage` is awaited. If the cache write succeeds but the DB write fails, the cache serves a response that never appears in chat history.

**Fix:** Move the cache write to AFTER the `createChatMessage` await on line 568. The cache write is still appropriate as `fireAndForget` (it's non-critical), but it must happen after the DB write succeeds. Change the ordering:

```
// Current (wrong order):
fireAndForget(setCoachCachedResponse(…))   // line 545
await createChatMessage(…)                 // line 568

// Fixed order:
await createChatMessage(…)
fireAndForget(setCoachCachedResponse(…))
```

## Schema Changes

- `chatMessages`: add nullable `turnKey TEXT` column. Add unique index on `(conversationId, turnKey)` WHERE `turnKey IS NOT NULL`.
- `communityRecipes`: add unique constraint on `sourceMessageId` WHERE `sourceMessageId IS NOT NULL` (if not already present).
- `coachNotebook`: add `'accepted'` or `'completed'` to the `status` enum if using a DB enum (check current type).

Run `npm run db:push` after schema changes.

## API Changes

- New route: `POST /api/chat/commitments/:notebookEntryId/accept` — requires auth, returns `{ ok: true }`.

## Testing

- Unit test: duplicate `turnKey` on assistant write returns the existing message ID, not an error.
- Unit test: `saveRecipeFromChat` called twice with the same `sourceMessageId` returns the same recipe ID both times.
- Integration test: CommitmentCard accept calls the new endpoint (mock the API in client tests).
- Existing tests must pass: `npm run test:run`.

## Files Changed (expected)

- `server/services/coach-pro-chat.ts`
- `server/storage/recipe-from-chat.ts`
- `server/storage/chat.ts` (createChatMessage signature update for turnKey)
- `server/routes/chat.ts` (accept turnKey from request body)
- New route: `server/routes/coach-notebook.ts` (or extend existing)
- `shared/schema.ts` (schema additions)
- `client/components/coach/CoachChat.tsx`
- `client/components/coach/blocks/CommitmentCard.tsx`
- `shared/schemas/coach-blocks.ts` (add notebookEntryId to CommitmentCard block type)
- Corresponding `__tests__` files
