---
title: "Remove unused conversations/messages database tables"
status: ready
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [simplification, cleanup, code-review]
---

# Remove Unused Chat Schema

## Summary

The `conversations` and `messages` tables are defined in `shared/models/chat.ts` but are never used anywhere in the codebase.

## Background

**Location:** `shared/models/chat.ts` (40 lines)

These tables appear to have been planned for a chat feature but were never implemented. The file is exported from `schema.ts` but:
- No routes reference these tables
- No storage functions exist for them
- The OpenAI integration uses inline message arrays, not database storage

Additionally, the `conversations` table has a design flaw - it has no `userId` foreign key, which would be a privacy violation if used.

## Acceptance Criteria

- [ ] Delete `shared/models/chat.ts`
- [ ] Remove `export * from "./models/chat"` from schema.ts
- [ ] Verify no runtime errors
- [ ] Run `npm run db:push` to sync schema (or leave orphaned tables)

## Implementation Notes

Simply delete the file and update schema.ts:

```diff
// shared/schema.ts
- export * from "./models/chat";
```

The orphaned database tables can be left in place (no harm) or manually dropped if desired.

## Dependencies

- None

## Risks

- None - code is completely unused

## Updates

### 2026-01-30
- Initial creation from code review
