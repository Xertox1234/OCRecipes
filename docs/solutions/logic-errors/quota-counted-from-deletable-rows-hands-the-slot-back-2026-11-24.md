---
title: "A daily quota counted from rows the user can delete hands the slot back — count append-only claims and take the larger number"
track: bug
category: logic-errors
tags: [database, api, security, quota, coach]
module: server
applies_to: ["server/storage/chat-quota.ts", "server/storage/chat.ts", "server/storage/**/*.ts"]
symptoms: ["a free user sends the daily limit of messages, deletes the conversation, and can send again", "a quota check is a COUNT over a table that also has a DELETE route", "a refund path deletes the row that the quota counts"]
created: 2026-11-24
severity: high
---

# A daily quota counted from rows the user can delete hands the slot back

## Problem

The Coach daily message limit was `COUNT(*)` over today's user messages. Deleting a message or a whole conversation removed the rows, so the count dropped and the user could send again without limit (audit finding H4, fixed in PR #2012).

## Symptoms

- The limit holds until the user deletes something.
- The quota source table has an owner-facing delete.

## Root Cause

The usage record and the user's content were the same rows. Content is the user's to delete; usage is not.

## Solution

- Record each counted action as an append-only claim (`recipe_finder_claims`, `kind` such as `coach_message`), written in the same transaction and under the same per-user lock as the insert.
- The check uses `Math.max(rowCount, claimsToday)`. Rows written before the claims existed still count, and deleted rows no longer free a slot.
- Only the server's own "reply was never delivered" refund removes a claim (`refundUndeliveredMessage`), and it deletes the claim by message id before the row.
- Every path that spends the quota must write a claim. Review found one that did not (Coach taps), which would have let the max fall back to the deletable count.

## Prevention

- When adding a quota, ask what the user can delete. If the answer includes the counted rows, count claims.
- When adding a new way to spend an existing quota, add its claim kind and a test that the count survives deleting the content.
- Nothing purges old claims yet; only today's rows are read.

## Related Files

- `server/storage/chat-quota.ts`
- `server/storage/chat.ts`
- `server/services/chat-turn.ts`

## See Also

- [per-conversation quota vs per-message](../design-patterns/per-conversation-quota-vs-per-message-2026-05-13.md) — what one unit of the quota is
- [new recipe-generation endpoint skipped quota](new-recipe-generation-endpoint-skipped-quota-2026-05-13.md) — the "every path must spend it" side
