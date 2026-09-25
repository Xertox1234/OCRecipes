---
title: "ChatScreen with no conversation id (e.g. a malformed chat/:id deep link) creates an empty conversation and silently drops the first message"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
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

- [x] **Decided (user, 2026-09-25): a malformed id shows "not found".** A `chat/:id` deep link whose id isn't a positive integer (e.g. `chat/abc` → 0) renders a "chat not found" state instead of an empty chat, following the `NotebookEntryScreen.tsx` precedent (undefined vs. malformed 0). It never auto-creates a conversation.
- [x] The create branch (ChatScreen opened with genuinely no id) still calls `sendMessage(content, undefined, conversation.id)`, so the first message is not lost
- [x] Tests: a malformed id renders "not found" and creates nothing; a missing id creates a conversation AND sends the message with the new id
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

The lost-message fix is one line. The malformed-id "not found" state follows `NotebookEntryScreen.tsx:61-67` (line numbers may drift); keep the distinction between a missing id and a malformed 0. If `linking.ts` `parseIntOrZero` makes the two indistinguishable, fixing that is in scope.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ChatScreen.tsx`
  - `client/screens/__tests__/ChatScreen*.test.tsx`
  - `client/navigation/linking.ts` (only if needed to tell a malformed id from a missing one)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None significant.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M16).

### 2026-09-25

- **Product decision (user):** a broken chat link shows "not found" (NotebookEntry precedent) and never auto-creates. The lost-first-message bug is still fixed for a chat opened with no id. Ready for `/todo`.

- **Implemented.** `client/screens/ChatScreen.tsx`: `isMalformedId = conversationId !== null && !(conversationId > 0)` distinguishes a missing id (`null`, in-app create flow) from a present-but-non-positive one (`0` or negative — `parseIntOrZero` does not clamp negatives). A malformed id renders a "chat not found" state (mirroring `NotebookEntryScreen.tsx`, minus its network-retry branch since this is a pure client-side shape check) and is also guarded inside `handleSend` itself, so the cross-tab `initialMessage` auto-send effect can't create/send when an unparsed deep-link query param rides along with a malformed id. The genuine create branch (`conversationId === null`) now calls `sendMessage(content, undefined, conversation.id)`, passing the freshly created id through the existing `conversationIdOverride` param instead of relying on the stale closure. `client/screens/__tests__/ChatScreen.test.tsx`: converted the static `useRoute` mock to a mutable `mockRouteParams.value` ref (matching `RecipeChatScreen.test.tsx`'s pattern) and added TDD-first failing tests for the malformed-id and missing-id-create-flow cases; all 7 tests pass. Reviewed by `code-reviewer` + `mobile-reviewer` (both clean, no blocking findings). No `linking.ts` change was needed — the negative-id gap is closed in `ChatScreen.tsx` per the Scope Contract's "only if needed" caveat.

### 2026-09-25 (review repair)

- Independent review found the not-found view was a dead end: a `chat/:id` deep link builds a stack holding only `Chat`, so there is no header back button. Added a labelled back button (`goBack` when possible, else `ChatList`) with tests for both branches, and codified the rule in the deep-linking solution doc.
