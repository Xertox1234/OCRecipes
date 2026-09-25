---
title: "ChatScreen and RecipeChatScreen duplicate the stream-end → message-refetch bridge verbatim — extract a hook and fix two inaccurate messages"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
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

- [x] A `usePendingAssistantBridge(...)` hook owns the refs/effects; both screens use it
- [x] The useChat comment's premise is corrected
- [x] The toast copy matches actual behavior. **Decided (user, 2026-09-25): keep today's behavior (the partial reply is discarded) and fix the wording.** Replace "Partial response may be visible" with copy that says the reply was interrupted and the user can retry, e.g. "Response was interrupted. Tap retry." Do not preserve partial content. This matches the Coach decision in #1068.
- [x] Existing ChatScreen/RecipeChatScreen tests green; unit tests for the new hook
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25

- **Product decision (user):** fix the wording, don't keep the partial. The toast must stop claiming a partial reply is visible. Ready for `/todo`.

### 2026-09-25 (execution)

- Implemented `client/hooks/usePendingAssistantBridge.ts` as a pure extraction of the shared refs/effects, parameterized to preserve the one real behavior difference between the two screens (ChatScreen announces "Coach response received" unconditionally on stream end; RecipeChatScreen announces only on the success path) — verified against both screens' original effect bodies.
- Fixed useChat.ts's comment (L14) and ChatScreen's toast copy (L16) to "Response interrupted. Try sending again." (matching the Coach's #1068 copy in `CoachOverlayContent.tsx`). Also fixed RecipeChatScreen's parallel inline error-bubble string ("Connection dropped. Your response may be incomplete.") to the same copy — same defect class, same file already in scope, though not separately named in the Acceptance Criteria.
- Added `client/hooks/__tests__/usePendingAssistantBridge.test.ts` (10 unit tests) plus wiring tests in `ChatScreen.test.tsx`/`RecipeChatScreen.test.tsx` proving each screen is actually wired to the hook (not just that the hook works in isolation).
- TDD evidence: the toast-copy regression test fails against original `main` code and passes after the fix (verified by temporarily swapping the pre-fix screen files back in and re-running); the hook's own unit tests fail on `main` via import-not-found (the hook doesn't exist there); the wiring tests pass against both old and new screen code, as expected for a pure extraction with no behavior change.
- Reviewed clean by `code-reviewer` + `mobile-reviewer` (both "No blocking findings"); one SUGGESTION (align a capture gate to the same stripped-content basis it captures) applied.
