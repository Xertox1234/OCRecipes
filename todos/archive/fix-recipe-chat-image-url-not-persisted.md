---
title: "Fix recipe image URL not persisted to message metadata"
status: backlog
priority: high
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [bug, recipe-chat]
---

# Fix recipe image URL not persisted to message metadata

## Summary

The recipe image URL is streamed to the client via SSE but never written back to the `chatMessages.metadata` in the database. On conversation reload, recipe cards lose their images. `saveRecipeFromChat` also always gets `null` for `imageUrl`.

## Background

In `server/routes/chat.ts` (recipe chat streaming path), the `imageUrl` SSE event is forwarded to the client but the variable is never captured from the streaming loop. The metadata object is constructed with `imageUrl: null` before the image event is processed. The generator in `recipe-chat.ts` correctly yields the `imageUrl` event, but the route never stores it.

Found during code review of PR #33.

## Acceptance Criteria

- [ ] After recipe generation completes, `chatMessages.metadata.imageUrl` contains the generated image URL
- [ ] On conversation reload (fetch messages from DB), recipe cards display their images
- [ ] `saveRecipeFromChat` creates `communityRecipes` rows with the correct `imageUrl`

## Implementation Notes

In `server/routes/chat.ts`, the recipe chat streaming loop:

1. Add a variable: `let recipeImageUrl: string | null = null;`
2. In the `imageUrl` event handler (currently line ~281): capture it: `recipeImageUrl = event.imageUrl;`
3. In the metadata construction (currently line ~296): use `imageUrl: recipeImageUrl` instead of `imageUrl: null`

Alternatively, after the streaming loop completes, update the already-saved message's metadata with the image URL via a separate `UPDATE` query.

## Dependencies

- None — self-contained fix

## Updates

### 2026-04-02

- Created from PR #33 code review finding (Bug 2, High)
