---
title: "ChatScreen with no conversation id (e.g. a malformed chat/:id deep link) creates an empty conversation and silently drops the first message"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, reliability]
github_issue:
---

# ChatScreen with no conversation id (e.g. a malformed chat/:id deep link) creates an empty conversation and silently drops the first message

## Summary

When ChatScreen has no `conversationId`, `handleSend` creates a conversation and then calls `sendMessage(content)` without the new id. The hook's closure still holds id 0, so it returns early: the input has already been cleared, the message is never sent, and no error appears.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M16** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/navigation/linking.ts:17-19` `parseIntOrZero` → `chat/abc` becomes 0.
- `client/screens/ChatScreen.tsx:400-419` (author comment: "Need to wait and send after navigation updates / For now, just send immediately").
- `client/hooks/useChat.ts:128-132`: `effectiveId = conversationIdOverride ?? conversationId; if (!effectiveId) return;`. The override parameter already exists.
- Internal navigations (ChatListScreen:111,144) always pass an id, so today only external links reach it.
- Research (React Navigation 7: `setParams` applies on the next render): `confirmed`. Correct precedent: `NotebookEntryScreen.tsx:61-67` distinguishes undefined from malformed 0.

## Acceptance Criteria

- [ ] The create branch calls `sendMessage(content, undefined, conversation.id)`
- [ ] Test: ChatScreen mounted with conversationId 0/undefined creates a conversation AND sends the message with the new id
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

One-line fix plus a test. Decide whether a malformed id should show "not found" (the NotebookEntry precedent) instead of auto-creating — note the decision.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ChatScreen.tsx`
  - `client/screens/__tests__/ChatScreen*.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None significant.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M16).
