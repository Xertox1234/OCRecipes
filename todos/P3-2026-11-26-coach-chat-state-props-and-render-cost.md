---
title: "CoachChat: plain state for used quick replies, fewer drilled props, a row memo that holds, streaming text out of the screen"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, react-native, performance, maintainability]
github_issue:
---

# CoachChat: state, props and render cost

## Summary

CoachChat (1458 lines) re-renders every visible row on many state changes, and the whole screen on every streamed token. The row memo cannot be made to hold until two ref-plus-version-counter states become plain state. Deferred from the coach chat audit 2026-11-24, bundle K (owner 2026-11-26: small fixes now, refactors later).

## Background

Audit rows, in `docs/audits/2026-11-24-coach-chat.md`:

- **L115:** `usedQuickRepliesRef` with `quickReplyVersion`, and `acceptedCommitmentsRef` with `commitmentVersion`, mutate a ref and bump a counter. **This must come first.** Rows read those refs, and they only update today because their memo never holds. A working memo would freeze them.
- **L35:** `CoachMessageRow`'s memo is defeated. `renderItem` builds a fresh `view` (from `deriveMessageView`) and an inline `onSaveRecipe` for every row. `writeCardEdits` is passed whole, so one edit re-renders every row.
- **L36:** `useCoachStream`'s text state lives in CoachChat, so every 50 ms tick re-renders the screen. The footer then re-parses the whole reply, which is quadratic over a reply.
- **L116:** the finder props (9 of them) are drilled through three layers.
- **S3:** `client/components/coach/CoachChat.tsx` is over 600 lines (1458).

L37 (the Ask Coach sheet) was fixed in bundle K with a `ChatBubble` memo and a split scroll. Its speed test, `client/components/__tests__/CoachOverlayContent.speed.test.tsx`, is the model for measuring here.

## Acceptance Criteria

- [ ] L115: used quick replies and accepted commitments are plain state (a `Set` in `useState`), with no version counters.
- [ ] L35: a render-count test shows a streamed tick, and a write-card edit on one card, re-render only the rows they touch.
- [ ] L36: a render-count test shows a streamed tick no longer re-renders the screen's input bar or list header, for example by moving the streaming text into the footer component.
- [ ] L116: the finder props travel as one stable object or a context.
- [ ] Existing CoachChat tests pass. Checked on the simulator: streaming, quick replies, write cards, the finder.

## Implementation Notes

- Files: `client/components/coach/CoachChat.tsx`, `CoachMessageRow.tsx`, `StreamingBubble.tsx`, `client/hooks/useCoachStream.ts`, `client/components/ChatBubble.tsx` (already memoized).
- Order: L115, then L35, then L36. L116 is independent.
