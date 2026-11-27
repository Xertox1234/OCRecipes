---
title: "Free chat and Coach Pro: one streaming client, one opening-brief helper, ChatScreen split, mutation-defaults cycle"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, client-state, maintainability]
github_issue:
---

# Free chat and Coach Pro: shared plumbing

## Summary

Free chat (ChatListScreen, ChatScreen, useSendMessage) and Coach Pro (CoachProScreen, CoachChat, useCoachStream) are two stacks over the same server route. Each has its own request, error-mapping and abort/reconcile code. Deferred from the coach chat audit 2026-11-24, bundle K (owner 2026-11-26: small fixes now, refactors later).

## Background

Audit rows, in `docs/audits/2026-11-24-coach-chat.md`:

- **L118:** the two streaming clients re-implement the same request, error mapping and abort/reconcile code. The stale-mark invalidation exists in three more places.
- **L121:** an observation that two parallel chat stacks serve the same route. **Confirm intent with the owner before merging the stacks.**
- **L122:** the opening-brief state and the acknowledge-once logic are copied between ChatScreen and CoachProScreen. `briefFormFor(...)` is written three times.
- **L120 / S4:** `client/screens/ChatScreen.tsx` (1161 lines) has a clean extraction seam: three module-level components with their own styles and no dependency on screen state.
- **S5:** `client/hooks/useChat.ts` is 883 lines.
- **S1:** a circular dependency, `client/lib/mutation-defaults.ts` → `client/hooks/useChat.ts` → `mutation-defaults.ts`.

## Acceptance Criteria

- [ ] The owner has said whether the two stacks should stay separate (L121).
- [ ] One shared helper for the stream request, its error mapping and abort/reconcile, used by both clients (L118).
- [ ] One `useOpeningBrief`-style helper for the brief state and the acknowledge-once logic (L122).
- [ ] ChatScreen's three module-level components move to their own files (L120).
- [ ] `npx madge --circular` no longer reports the mutation-defaults ↔ useChat cycle (S1).
- [ ] Existing chat tests pass. Free and Coach Pro chats checked on the simulator.

## Implementation Notes

- Files: `client/hooks/useChat.ts`, `client/hooks/useCoachStream.ts`, `client/screens/ChatScreen.tsx`, `client/screens/CoachProScreen.tsx`, `client/lib/mutation-defaults.ts`, `client/lib/chat-error-copy.ts`.
- Do the ChatScreen extraction (L120) first: it is mechanical and lowers the conflict surface for the rest.
