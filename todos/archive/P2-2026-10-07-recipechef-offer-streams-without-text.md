---
title: "RecipeChef recipe offer streams its buttons without the question text"
status: done
priority: medium
created: 2026-10-07
updated: 2026-10-07
assignee:
labels: [deferred, recipe-finder, client, server]
github_issue:
---

# RecipeChef recipe offer streams its buttons without the question text

## Summary

With `RECIPE_OFFER_ENABLED` on, RecipeChef's offer arrives over SSE as `{ finder }` with no `content`. The pending bubble therefore shows bare Yes / Search / No buttons until the message refetch lands. Screen-reader users hear three unexplained buttons, and if the refetch fails the question never appears.

## Background

This came from the Task 14 client review (coach recipe offer). The server's RecipeChef finder SSE (`server/routes/chat.ts` ~612-623) sends only the block.

On the client, `useChat` (`client/hooks/useChat.ts` ~488-498) flushes `data.content` only inside a 16 ms timer, and only while `isStreamingRef.current` is true. A `{ finder, content }` event followed closely by `done` can therefore drop the content. Both halves need fixing.

## Acceptance Criteria

- [ ] **Server.** For a `recipe_offer` result, the RecipeChef finder SSE event carries `content` (the server-written offer text). Other finder blocks are byte-identical, so flag-off behaviour is unchanged.
- [ ] **Client.** `useChat` applies a finder event's `content` deterministically, including when `done` follows immediately. Use an end-of-stream flush rather than the 16 ms timer alone.
- [ ] **Tests.**
  - A route test pins `content` on the offer event, and only on the offer event.
  - A `useChat` test pins that `{ finder, content }` + `done` in one chunk shows the text.

## Implementation Notes

- The offer copy is `OFFER_TEXT` in `server/services/recipe-finder/fallback-text.ts`. The client's `offerDisplayText` strips the trailing reply hint.

## Scope Contract

- **Mechanisms to use:** the existing SSE event shape and the `useChat` stream handler. Nothing new.
- **Files in scope:**
  - `server/routes/chat.ts` (the RecipeChef finder SSE branch)
  - `client/hooks/useChat.ts`
  - their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- The coach recipe offer client PR (Task 14)

## Risks

- `useChat` stream timing is easy to regress; keep the flush change minimal.

## Updates

### 2026-10-07

- Initial creation, from the Task 14 review.

### 2026-10-07 (done)

- Server: the `recipe_offer` finder SSE event now carries `content` (other blocks unchanged). Client: `useChat` flushes pending content on `done`. Tests added in chat.test.ts, useChat.test.ts, RecipeChatScreen.test.tsx.
