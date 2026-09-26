---
title: "getChatMessages' newest-first ORDER BY (created_at DESC, id DESC) has no covering index"
status: done
priority: low
created: 2026-09-24
updated: 2026-09-26
assignee:
labels: [deferred, performance, database]
github_issue:
---

# getChatMessages' newest-first ORDER BY (created_at DESC, id DESC) has no covering index

## Summary

Since #1064, `getChatMessages` returns the newest N messages with `ORDER BY created_at DESC, id DESC LIMIT n`. No index matches that ordering for a conversation, so Postgres may read and sort every message in a long conversation to return the last 20–100.

## Background

Deferred from the #1064 code review (user approved filing it on 2026-09-24). The old ascending query had the same coverage gap, so this is not a regression. It matters more now because every coach turn, recipe turn, warm-up, and `GET /messages` runs it.

Existing indexes on `chat_messages` (`shared/schema.ts`):

- `chat_messages_conversation_id_idx` on `(conversation_id)`: filters, but doesn't provide the order.
- `chat_messages_conv_role_created_idx` on `(conversation_id, role, created_at)`: `role` sits between the equality column and the sort column, so it can't serve an ordering across all roles.
- `chat_messages_turn_key_idx`: a unique partial index, not relevant here.

## Acceptance Criteria

- [x] `EXPLAIN (ANALYZE, BUFFERS)` of the `getChatMessages` query (`server/storage/chat.ts`) on a conversation with a few hundred messages, captured before the change. It shows a Sort node or a scan of all rows in the conversation. → Confirmed: Seq Scan of `chat_messages` (`Rows Removed by Filter: 1066`) into a `Sort` (top-N heapsort). See Updates.
- [x] Add an index `(conversation_id, created_at DESC, id DESC)` in `shared/schema.ts`, unless the EXPLAIN shows it doesn't help. Record the decision either way. → Added `chat_messages_conv_created_id_idx`. It helps (see below).
- [x] `EXPLAIN` after the change shows an index scan that stops at the limit (no Sort node) → **Corrected 2026-09-26 (see the last Updates entry).** The first version of the index (`.desc()`, i.e. `DESC NULLS LAST`) did NOT remove the Sort for the app's literal query; the shipped `.desc().nullsFirst()` version does: `Index Scan`, no Sort, stops at the `LIMIT`.
- [x] Decide whether `chat_messages_conversation_id_idx` becomes redundant and can be dropped, because the new index's leading column covers it. Check other queries that filter on `conversation_id` alone first. → **Decision: KEEP.** Every `conversation_id`-alone query was enumerated (`getChatMessageCount` is the only one); the new index's leading column structurally CAN serve it too (verified with the old index dropped + seq scan disabled — see Updates), but at this table's current pre-launch scale the planner doesn't reliably prefer either index over a seq scan anyway, so dropping buys no measurable win today while adding prod-migration-ordering risk. Kept both; documented so a later pass can drop it once real traffic volume makes the difference measurable.

## Implementation Notes

- Schema change via Drizzle (`npm run db:push`). This is DB-serial work under `/todo` (Phase 3 step 5).
- Adding an index to a large table: consider `CREATE INDEX CONCURRENTLY` in production. Check how this repo applies index migrations before choosing. → Dev: `shared/schema.ts` + `db:push` (this repo's dev/CI path). Prod: this repo migrates prod by hand via numbered SQL files under `migrations/` (`db:push` is dev/CI-only, per `docs/solutions/best-practices/migrate-prod-schema-before-merge-railway-autodeploy-2026-06-18.md`) — added `migrations/0012_chat_messages_conv_created_id_idx.sql` using `CREATE INDEX CONCURRENTLY` (chat_messages is hit on every coach/recipe turn, so avoid locking out writes while it builds), modeled on the `migrations/0009_users_email_lower_unique.sql` precedent. Ready for manual apply against prod; additive and order-independent w.r.t. the deploy.
- The query itself (`server/storage/chat.ts` → `getChatMessages`) should not need to change. → Confirmed unchanged.

## Updates

### 2026-09-26

- Implemented via `shared/schema.ts`: `index("chat_messages_conv_created_id_idx").on(table.conversationId, table.createdAt.desc(), table.id.desc())`, applied to dev with `npm run db:push`. Verified stable across two repeat `db:push` runs (same index OID both times) — the DESC syntax round-trips cleanly, unlike the `lower(email)` functional-index precedent's churn.
- **Dev DB scale note**: the dev DB only had 16 `chat_messages` rows / 8 conversations (max 2/conversation) going in — nowhere near enough for the planner to choose meaningfully between a seq scan and an index scan. Seeded 4 marked conversations (`ZZZ-EXPLAIN-TEST-DELETE-ME-*`, owned by an existing user) × 350 messages each with explicit staggered `created_at` values, entirely inside a `BEGIN; … ROLLBACK;` transaction (index creation included) so the dev DB was left exactly as found apart from the real index added via `db:push` above. Verified 0 residual `ZZZ-EXPLAIN-TEST` rows and original 16/8 counts after.
- **BEFORE** — `getChatMessages` query shape (join + `WHERE conversation_id = ? AND chat_conversations.user_id = ?` + `ORDER BY created_at DESC, id DESC LIMIT 100`), only the pre-existing indexes in place:

  ```
  Limit  (cost=52.79..53.04 rows=100 width=1559) (actual time=0.095..0.101 rows=100.00 loops=1)
    Buffers: shared hit=18
    ->  Sort  (cost=52.79..53.66 rows=350 width=1559) (actual time=0.095..0.097 rows=100.00 loops=1)
          Sort Key: chat_messages.created_at DESC, chat_messages.id DESC
          Sort Method: top-N heapsort  Memory: 38kB
          ->  Nested Loop  (cost=0.00..39.41 rows=350 width=1559) (actual time=0.005..0.064 rows=350.00 loops=1)
                ->  Seq Scan on chat_conversations  (cost=0.00..1.21 rows=1 width=4) (actual time=0.002..0.003 rows=1.00 loops=1)
                      Filter: ((id = 98631) AND ((user_id)::text = '978d252a-...'::text))
                ->  Seq Scan on chat_messages  (cost=0.00..34.70 rows=350 width=1559) (actual time=0.002..0.043 rows=350.00 loops=1)
                      Filter: (conversation_id = 98631)
                      Rows Removed by Filter: 1066
  Planning Time: 0.165 ms
  Execution Time: 0.108 ms
  ```

  Confirms the AC: a full `Seq Scan` of `chat_messages` filtered down from the whole table (`Rows Removed by Filter: 1066`) feeding a `Sort` (top-N heapsort) — exactly the pattern the todo describes. (The planner chose seq scan over the existing single-column `chat_messages_conversation_id_idx` too, since ~1400 total rows is still cheap to scan outright — the missing _ordering_ index, not the missing filter index, is what costs the Sort.)

- **AFTER** — same query, with `chat_messages_conv_created_id_idx` added:

  ```
  Limit  (cost=0.28..16.84 rows=100 width=1559) (actual time=0.024..0.044 rows=100.00 loops=1)
    ->  Nested Loop  (cost=0.28..58.24 rows=350 width=1559) (actual time=0.024..0.041 rows=100.00 loops=1)
          ->  Index Scan using chat_messages_conv_created_id_idx on chat_messages  (cost=0.28..52.65 rows=350 width=1559) (actual time=0.015..0.019 rows=100.00 loops=1)
                Index Cond: (conversation_id = 98631)
                Buffers: shared hit=3 read=2
          ->  Materialize  (cost=0.00..1.21 rows=1 width=4) (actual time=0.000..0.000 rows=1.00 loops=100)
                ->  Seq Scan on chat_conversations ...
  Planning Time: 1.076 ms
  Execution Time: 0.057 ms
  ```

  No `Sort` node; the `Index Scan` on the new index returns pre-ordered rows and the `Limit` stops it at 100 of the conversation's 350 rows (`Index Searches: 1`). Satisfies the AC directly.

- **`getChatMessageCount` (the only other pure `conversation_id`-equality consumer, enumerated by grepping every `chatMessages` usage in `server/`)**: its plan was _unchanged_ by adding the new index (`Seq Scan on chat_messages ... Filter: (conversation_id = 98631)` before and after) — at this row count a plain seq scan is cheapest for a `count(*)` either way, so the planner doesn't pick either `conversation_id` index for it. To check the new index's leading column can still serve this query shape structurally (independent of today's cost-based choice), re-ran with the OLD single-column index dropped and `SET LOCAL enable_seqscan = off` (same rolled-back transaction): plan became `Aggregate -> Nested Loop -> Bitmap Heap Scan on chat_messages (Bitmap Index Scan on chat_messages_conv_created_id_idx, Index Cond: (conversation_id = 98635))` — i.e. the composite index's leading column alone serves the equality filter with no involvement of the dropped index. `getChatMessageById` / `deleteChatMessage` / `recipe-from-chat.ts` (id-primary, `conversation_id` as a secondary check) remain PK-driven either way; `getChatMessageByTurnKey` and the daily/role-count queries are unaffected (served by `chat_messages_turn_key_idx` and `chat_messages_conv_role_created_idx` respectively); `export.ts`'s full-user export filters on `chat_conversations.user_id`, not `chat_messages.conversation_id`, so neither index is its primary lookup.
- Added `migrations/0012_chat_messages_conv_created_id_idx.sql` for the manual prod apply (see Implementation Notes).
- No change needed to `server/storage/chat.ts` — the query shape was already correct (fixed under #1064); this was purely a missing-index gap.
- **Review round 1** (`code-reviewer` + `server-reviewer`, no CRITICALs — "No findings." / "No blocking findings."): `server-reviewer` caught two real WARNINGs, both fixed on-branch — (1) `migrations/0012` omitted `NULLS LAST` on the DESC columns, which would have built a prod index with a different catalog `indexdef` than the Drizzle-declared one (fixed, and the fixed DDL's `indexdef` was verified byte-identical to the dev index's, modulo name/`CONCURRENTLY`); (2) both new comments pointed at `todos/archive/...` before the todo was archived — reworded path-agnostic. Also tightened "several queries filter on conversation_id alone" to "getChatMessageCount is the only other query" in both comments to match this file's own enumeration (both reviewers independently re-verified that enumeration against `server/` and found it accurate).
- **2026-09-26 — correction after independent review (#1103).** The index as first committed (`table.createdAt.desc(), table.id.desc()`, which Drizzle builds as `DESC NULLS LAST`) did **not** serve the app's query. `getChatMessages` orders with Drizzle's `desc()` helper, which emits a bare `DESC` = `DESC NULLS FIRST`, and the planner matches `NULLS` placement syntactically even though `created_at`/`id` are `NOT NULL`. The "AFTER" plan above did not reproduce for the app's literal query. Fixed: the index is now `.desc().nullsFirst()` in `shared/schema.ts`, and `migrations/0012` uses `DESC NULLS FIRST` (dev `indexdef`: `btree (conversation_id, created_at DESC, id DESC)`). Re-measured on a seeded 350-row conversation inside `BEGIN … ROLLBACK` (0 residual rows; the dev DB is back to 16 messages / 10 conversations), using a single-table query with the app's literal `ORDER BY` (`ORDER BY created_at DESC, id DESC LIMIT 20`). The app's `chat_conversations` join and default limit were left out; the confirm reviewer's join-inclusive EXPLAIN gave the same result:
  - With the NULLS LAST index present (the PR as first committed):
    ```
                                                       QUERY PLAN
       Limit  (cost=40.01..40.06 rows=20 width=1534) (actual rows=20.00 loops=1)
         Buffers: shared hit=13
         ->  Sort  (cost=40.01..40.89 rows=350 width=1534) (actual rows=20.00 loops=1)
               Sort Key: created_at DESC, id DESC
               Sort Method: top-N heapsort  Memory: 26kB
               Buffers: shared hit=13
               ->  Seq Scan on chat_messages  (cost=0.00..30.70 rows=350 width=1534) (actual rows=350.00 loops=1)
                     Filter: (conversation_id = 98839)
                     Rows Removed by Filter: 1066
                     Buffers: shared hit=13
       Planning:
         Buffers: shared hit=75
    ```
  - With the corrected `.nullsFirst()` index:
    ```
                                                                        QUERY PLAN
       Limit  (cost=0.28..4.40 rows=20 width=1534) (actual rows=20.00 loops=1)
         Buffers: shared hit=4
         ->  Index Scan using chat_messages_conv_created_id_idx on chat_messages  (cost=0.28..72.46 rows=350 width=1534) (actual rows=20.00 loops=1)
               Index Cond: (conversation_id = 98843)
               Index Searches: 1
               Buffers: shared hit=4
       Planning:
         Buffers: shared hit=75
    ```
