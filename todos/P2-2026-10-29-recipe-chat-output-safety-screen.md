---
title: "Screen RecipeChef replies for unsafe dietary advice, as the coach already does"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, ai, security]
github_issue:
---

# Screen RecipeChef replies for unsafe dietary advice, as the coach already does

## Summary

Recipe and remix chat stream and persist the model's reply with no output safety check; the coach runs `containsUnsafeCoachAdvice` on every round.

## Background

Audit finding M-sec-5. `server/routes/chat-stream.ts` recipe/remix branch (~399-459) and `server/services/recipe-chat.ts` (~363-440) save `fullTextResponse` via `storage.createChatMessage` unchecked. A user can ask RecipeChef for an extreme-restriction plan and it is shown and stored. Recipe chat streams text progressively, so a post-stream check can only replace what was already shown — the client must handle the override event for recipe chats.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] `containsUnsafeCoachAdvice` (or the shared output check) runs over the recipe-chat reply before it is persisted
- [ ] On a hit, the stored message is `STANDARD_SAFETY_MESSAGE` and the client receives the same `safety_override` event the coach sends — and the recipe chat UI replaces the streamed text
- [ ] Tests cover a hit and a clean reply for recipe and remix conversations

## Implementation Notes

Mirror the coach path (`server/services/nutrition-coach.ts` ~615/~791, `chat-stream.ts` ~572). Check how `client/hooks/useChat.ts` handles `safety_override` today.

## Scope Contract

- **Files in scope:** `server/routes/chat-stream.ts`, `server/services/recipe-chat.ts`, `client/hooks/useChat.ts` (recipe chat stream handling) and their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
