---
title: "Add server integration tests for remix conversation flow"
status: backlog
priority: medium
created: 2026-04-08
updated: 2026-04-08
assignee:
labels: [remix, testing]
---

# Add server integration tests for remix conversation flow

## Summary

The remix backend logic (conversation creation, per-conversation quota, save-with-lineage) lacks dedicated test coverage. Route tests and storage integration tests should be added.

## Background

During Recipe Remix implementation (PR #35), the client-side chip generation was thoroughly tested (13 unit tests), but the server-side logic relies on the existing test infrastructure which only validates the default "coach" conversation path. The per-conversation quota mechanism is new and diverges from the per-message pattern — it needs explicit test coverage.

## Acceptance Criteria

### Route tests (`server/routes/__tests__/chat.test.ts`)

- [ ] POST /api/chat/conversations with `type: "remix"` and `sourceRecipeId` creates conversation with metadata
- [ ] POST /api/chat/conversations with `type: "remix"` without `sourceRecipeId` returns 400
- [ ] POST /api/chat/conversations with `type: "remix"` and non-existent recipe returns 404
- [ ] POST /api/chat/conversations with `type: "remix"` and private recipe owned by another user returns 404

### Storage integration tests (`server/storage/__tests__/chat.test.ts`)

- [ ] `createChatMessageWithLimitCheck` for remix: first message counts against quota
- [ ] `createChatMessageWithLimitCheck` for remix: second message in same conversation does NOT count
- [ ] `createChatMessageWithLimitCheck` for recipe: correctly counts remix conversations as 1 each
- [ ] `saveRecipeFromChat` with lineage params creates recipe with `remixedFromId` and `remixedFromTitle`

### Save route tests (`server/routes/__tests__/recipe-chat.test.ts`)

- [ ] POST /api/chat/conversations/:id/save-recipe on a remix conversation includes lineage in saved recipe

## Implementation Notes

- Route tests use mocked storage (existing pattern in `chat.test.ts`)
- Storage integration tests hit the real database (existing pattern in `server/storage/__tests__/`)
- Use `createMockChatConversation({ type: "remix", metadata: { sourceRecipeId: 1, sourceRecipeTitle: "Test" } })` from updated factory
- Use `createMockCommunityRecipe()` from updated factory for source recipe mocks

## Dependencies

- Recipe Remix feature must be merged (PR #35)

## Updates

### 2026-04-08

- Created as deferred item from Recipe Remix code review
