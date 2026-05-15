---
title: "Fix chat storage tests — missing 'type' column on chat_conversations"
status: backlog
priority: high
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [bug, tests, database]
---

# Fix chat storage tests — missing 'type' column on chat_conversations

## Summary

All 15 tests in `server/storage/__tests__/chat.test.ts` fail because the `type` column does not exist on the `chat_conversations` table in the test database. This was likely introduced by the recipe chat feature (PR #33) which added a `type` field to distinguish "coach" vs "recipe" conversations but the migration was never applied to the test DB.

## Background

The `createChatConversation` function in `server/storage/chat.ts` (line 54) inserts a `type` value into `chat_conversations`, but the underlying PostgreSQL table doesn't have this column yet. Error:

```
error: column "type" of relation "chat_conversations" does not exist
```

All 15 tests in the file fail with the same root cause. The rest of the test suite (226 files, 3219 tests) passes.

## Acceptance Criteria

- [ ] `chat_conversations` table has a `type` column (likely `text NOT NULL DEFAULT 'coach'`)
- [ ] Schema in `shared/schema.ts` matches the migration
- [ ] Migration created and applied: `npm run db:push` or new migration file
- [ ] All 15 tests in `server/storage/__tests__/chat.test.ts` pass
- [ ] No regressions in other test files

## Implementation Notes

- Check `shared/schema.ts` for the `chatConversations` table definition — the `type` field is likely already declared there but never migrated
- Run `npm run db:push` to sync schema, or create a migration in `migrations/`
- The test DB may need the same migration applied

## Updates

### 2026-04-02

- Initial creation — discovered during branch merge cleanup
