---
title: Coach — Performance, Indexes & History Management
date: 2026-05-04
status: approved
plan: 4 of 5 (Coach deep-dive review)
---

## Overview

This plan adds three missing database indexes (one of which is causing a full table scan on every cron tick), fixes the notebook entry ordering before the 100-entry cap, and patches history truncation to handle system and user messages that can blow through the token budget.

## Scope

Files: `server/storage/coach-notebook.ts`, `server/storage/chat.ts`, `server/lib/chat-history-truncate.ts`, `shared/schema.ts`

## Issue Inventory

### 1. getDueCommitmentsAllUsers causes a full table scan (HIGH)

**Location:** `server/storage/coach-notebook.ts:230–245`

**Problem:** The commitment scheduler runs on a cron tick and calls `getDueCommitmentsAllUsers`, which filters on `(type = 'commitment', status = 'active', followUpDate ≤ now)` with no `userId` constraint. All existing indexes on `coachNotebook` lead with `userId`, making them useless for this cross-user query. On a large table this is a sequential scan on every scheduler tick.

**Fix:** Add a partial index:

```sql
CREATE INDEX coach_notebook_due_commitments_idx
  ON coach_notebook (follow_up_date)
  WHERE type = 'commitment' AND status = 'active';
```

In Drizzle schema (`shared/schema.ts`): add this as a `uniqueIndex` or plain `index` with a `where` clause using Drizzle's index builder. Run `npm run db:push`.

The query in `getDueCommitmentsAllUsers` already filters on exactly these columns — the index will be used directly once it exists.

### 2. getActiveNotebookEntries misses (userId, status) index (MEDIUM)

**Location:** `server/storage/coach-notebook.ts:31`

**Problem:** `getActiveNotebookEntries` filters on `(userId, status = 'active')` but the composite index is `(userId, type, status, followUpDate)`. When `type` is omitted (as it is here), only the leading `userId` column is used — the `status` filter is evaluated without index support. A dedicated `(userId, status)` index would satisfy this query exactly.

**Fix:** Add index:

```sql
CREATE INDEX coach_notebook_user_status_idx
  ON coach_notebook (user_id, status);
```

In Drizzle schema: add alongside the existing index definition.

### 3. chatConversations.title lacks trigram index (MEDIUM)

**Location:** `server/storage/chat.ts:48–51`

**Problem:** `getChatConversations` supports search via `ilike(title, '%query%')`. This requires a sequential scan or at best a LIKE index that can't use leading wildcards. `communityRecipes` and `mealPlanRecipes` already use `gin_trgm_ops` for the same pattern; `chatConversations` does not.

**Fix:** Add a GIN trigram index on `chatConversations.title`:

```sql
CREATE INDEX chat_conversations_title_trgm_idx
  ON chat_conversations USING gin (title gin_trgm_ops);
```

Requires `pg_trgm` extension (already enabled — check `shared/schema.ts` for existing trigram indexes to confirm). Add to Drizzle schema.

### 4. Notebook entries not ordered by recency before 100-entry cap (MEDIUM)

**Location:** `server/storage/coach-notebook.ts:31` + `server/services/coach-pro-chat.ts:283–320`

**Problem:** Active notebook entries are silently capped at 100 for context injection. There is no guarantee that the 100 returned are the most recent — older but less relevant entries may displace newer ones. An active user accumulates entries continuously (up to 10 per extraction call), so entries beyond 100 are silently invisible to the model.

**Fix:** Add `ORDER BY updated_at DESC` (or `created_at DESC`) to the `getActiveNotebookEntries` query before the `.limit(100)`. This ensures the 100 entries injected into the prompt are always the most recently active ones. If Drizzle's query builder already has an `orderBy` on this query, replace or extend it with `desc(coachNotebook.updatedAt)`.

### 5. History truncation does not prune system messages (MEDIUM)

**Location:** `server/lib/chat-history-truncate.ts:51–95`

**Problem:** `truncateHistoryToBudget` only prunes `tool` and `assistant` messages. If a system message alone exceeds the token budget, the function exhausts all pruneable messages and returns a history that still exceeds the budget — silently. System messages injected mid-conversation (if any) can cause this.

**Fix:** Add Phase 3 to the pruning loop: after assistant messages are pruned, prune system messages oldest-first (excluding the most recent system message, which is typically the base prompt). In practice this is a safeguard — system messages are usually small — but the function must not silently return an over-budget result.

Also: add a post-prune assertion (in dev/test mode only, guarded by `NODE_ENV !== 'production'`) that logs a warning if the returned history still exceeds the budget after all phases.

### 6. History truncation does not prune user messages (MEDIUM)

**Location:** `server/lib/chat-history-truncate.ts:76–93`

**Problem:** When users paste long text (recipes, food labels, ingredient lists), their messages can dominate the token budget even after all tool and assistant messages are pruned. The function preserves the most-recent user message but silently over-runs the budget if older user messages are large.

**Fix:** Add Phase 4 after system message pruning: prune user messages oldest-first, always preserving the most-recent user message (already tracked via `lastUserIdx`). This is the nuclear option — the model loses conversation history — but it is still better than silently blowing through the context window and causing OpenAI errors.

Document in the function's JSDoc: "Pruning order: tool → assistant → system → user (oldest-first, most-recent user always preserved)."

### 7. Per-conversation message cap (MEDIUM)

**Location:** `server/storage/chat.ts` (full file)

**Problem:** There is no per-conversation message count cap or archival mechanism. The daily limit controls volume but not depth. Long-lived conversations grow indefinitely in the DB and increasingly stress the history truncation logic.

**Fix (documentation + light enforcement):** This cycle: document in `docs/patterns/architecture.md` the intended soft cap (e.g., 500 messages per conversation) and the mechanism for handling it (return a warning in the GET response when count > threshold, letting the client surface a "Start a new conversation" prompt). Implement the soft-cap warning in `getChatConversationById` or a new `getChatMessageCount` utility. A hard archival migration is out of scope for this plan — the documentation and warning are the deliverable here.

### 8. CHARS_PER_TOKEN inaccurate for CJK/emoji content (LOW)

**Location:** `server/lib/chat-history-truncate.ts:21–33`

**Problem:** `CHARS_PER_TOKEN = 4` is derived from English text. CJK characters are typically 1 char = 1 token, and emoji can be 1–4 tokens per character. A Korean-language conversation could silently overflow the context window.

**Fix:** Replace the constant with a heuristic function `estimateTokens(message)` that counts CJK code points (Unicode ranges `　–鿿`, `가–퟿`, etc.) separately at 1 char/token and uses the 4-char/token ratio for all other content. This is still an approximation but is 2–4× more accurate for CJK. Update the exported `estimateTokens` function in the module and update tests.

## Schema Changes

Three new indexes added via Drizzle in `shared/schema.ts`:

1. Partial index on `coachNotebook(followUpDate)` WHERE commitment + active
2. Composite index on `coachNotebook(userId, status)`
3. GIN trigram index on `chatConversations(title)`

Run `npm run db:push` to apply.

## Testing

- Add a test that `estimateTokens` correctly estimates CJK and emoji content.
- Add a test that `truncateHistoryToBudget` returns a history within budget even when all tool + assistant + system messages are pruned.
- Add a test that `truncateHistoryToBudget` prunes old user messages when needed while preserving the most-recent user message.
- Existing tests must pass: `npm run test:run`.

## Files Changed (expected)

- `server/storage/coach-notebook.ts`
- `server/storage/chat.ts`
- `server/lib/chat-history-truncate.ts`
- `shared/schema.ts`
- `docs/patterns/architecture.md` (per-conversation cap documentation)
- Corresponding `__tests__` files
