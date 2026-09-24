---
title: "Recipe/remix chat keeps generating after the client disconnects — decide an abort + quota policy"
status: backlog
priority: medium
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, reliability, product-decision]
github_issue:
---

# Recipe/remix chat keeps generating after the client disconnects — decide an abort + quota policy

## Summary

On the recipe/remix path of `POST /api/chat/conversations/:id/messages`, a client disconnect never aborts the OpenAI call. Generation (and the image pipeline) runs to completion and the reply is saved, so every abandoned turn pays full token cost.

## Background

Deferred from the H6 fix (`todos/P1-2026-09-23-ask-coach-dismiss-mid-stream-burns-quota.md`). The M8 abort used `req.on("close")`, which never fires on Node 24 once `express.json()` has consumed the body. H6 moved detection to `res.on("close")` + `!res.writableFinished` for the **coach path only**. Recipe/remix was left on finish-and-save on purpose: aborting it without a salvage policy would recreate H6 there (the quota row is spent and no reply is saved), and half a recipe JSON cannot be saved as a partial.

## Acceptance Criteria

- [ ] A product decision is recorded: keep finish-and-save (and delete the dead `aborted`/`req close` assumptions), or abort + refund when nothing was streamed. Note that remix quota counts distinct conversations, not messages.
- [ ] The chosen behavior is pinned with a real-socket disconnect test (the `postAndDisconnect` harness in `server/routes/__tests__/chat.test.ts`)
- [ ] No quota is consumed without either a persisted reply or a retry path

## Implementation Notes

- `server/routes/chat.ts`: the `res.on("close")` handler returns early when `!isCoachPath`. Extend it, and the post-stream H6 settle block, if the recipe path gets a policy.
- Refunding means `storage.deleteChatMessage(message.id, userId)`. For recipe it removes one counted row. For remix only the first user message counts, and it counts through `count(DISTINCT conversation)`.
