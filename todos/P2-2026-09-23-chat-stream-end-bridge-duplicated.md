---
title: "ChatScreen and RecipeChatScreen duplicate the stream-end → message-refetch bridge verbatim — extract a hook and fix two inaccurate messages"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# ChatScreen and RecipeChatScreen duplicate the stream-end → message-refetch bridge verbatim — extract a hook and fix two inaccurate messages

## Summary

The pending-assistant bridge (three refs plus two effects, identical comment wording and ref names) is copy-pasted between ChatScreen and RecipeChatScreen. There are also two related inaccuracies: a misleading code comment and a user-facing toast.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M21, L14, L16** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- M21: `client/screens/ChatScreen.tsx:~295-330` and `client/screens/RecipeChatScreen.tsx:218-268`; the identical comment "Bridge the stream-end → message-refetch gap…" appears at ChatScreen:308 / RecipeChatScreen:252. CoachChat does NOT share it (it uses `useCoachStream` `onDone`).
- L14: `client/hooks/useChat.ts:319-324` comment claims RecipeChatScreen unmounts on dismiss as the reason for not clearing `requestError`, but ChatScreen (a persistent tab screen) also consumes the hook.
- L16: `ChatScreen.tsx:340` toast "Partial response may be visible", but `useChat.ts:313-318` always clears streaming content and :311 skips the pending bubble on `streamError`, so no partial is ever visible.

## Acceptance Criteria

- [ ] A `usePendingAssistantBridge(...)` hook owns the refs/effects; both screens use it
- [ ] The useChat comment's premise is corrected
- [ ] The toast copy matches actual behavior (or partial content is actually preserved — decide)
- [ ] Existing ChatScreen/RecipeChatScreen tests green; unit tests for the new hook
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Pure extraction first (no behavior change), then the copy fix.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ChatScreen.tsx`
  - `client/screens/RecipeChatScreen.tsx`
  - `client/hooks/useChat.ts (comment)`
  - new hook file
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None significant.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M21, L14, L16).
