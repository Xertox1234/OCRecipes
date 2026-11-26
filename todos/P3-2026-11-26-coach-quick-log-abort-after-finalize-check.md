---
title: "A food logged at once can outlive a client that leaves after finalize's abort check"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, server]
github_issue:
---

# A food logged at once can outlive a client that leaves after finalize's abort check

## Summary

Coach roadmap T2 logs a small typed food during the `log_food_item` tool
call. `finalizeTurn` (server/services/coach-pro-chat/finalize-turn.ts) withdraws
that log when the client has left, but it checks `isAborted()` once, before
`persistCoachReply`, which checks again. A client that disconnects between the
two checks leaves the food logged while the route's abort path
(`settleAbortedCoachTurn` in server/services/chat-turn.ts) stores only the
partial text, with no write_card block. The log is still in the user's food
log, but the chat has no card or Undo for it.

## Background

Found in the T2 review (security and server reviewers). The window is a few
milliseconds wide and the log is the user's own, from their own words, and
visible in their food log, so this is low.

## Acceptance Criteria

- [ ] A turn that ends aborted after its food was logged at once either
      withdraws the log or stores the reply with its write_card block, so the
      card and its Undo are reachable.
- [ ] A test covers an abort that lands after finalize's first check.
