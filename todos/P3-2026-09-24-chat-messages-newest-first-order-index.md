---
title: "getChatMessages' newest-first ORDER BY (created_at DESC, id DESC) has no covering index"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
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

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` of the `getChatMessages` query (`server/storage/chat.ts`) on a conversation with a few hundred messages, captured before the change. It shows a Sort node or a scan of all rows in the conversation.
- [ ] Add an index `(conversation_id, created_at DESC, id DESC)` in `shared/schema.ts`, unless the EXPLAIN shows it doesn't help. Record the decision either way.
- [ ] `EXPLAIN` after the change shows an index scan that stops at the limit (no Sort node)
- [ ] Decide whether `chat_messages_conversation_id_idx` becomes redundant and can be dropped, because the new index's leading column covers it. Check other queries that filter on `conversation_id` alone first.

## Implementation Notes

- Schema change via Drizzle (`npm run db:push`). This is DB-serial work under `/todo` (Phase 3 step 5).
- Adding an index to a large table: consider `CREATE INDEX CONCURRENTLY` in production. Check how this repo applies index migrations before choosing.
- The query itself (`server/storage/chat.ts` → `getChatMessages`) should not need to change.
