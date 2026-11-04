---
title: "Push: check Expo push receipts, and stop a failed chunk from shifting tickets onto the wrong tokens"
status: done
priority: medium
created: 2026-11-03
updated: 2026-11-03
assignee:
labels: [deferred, server, notifications]
github_issue:
---

# Push: check Expo push receipts, and fix the ticket/token misalignment

## Summary

`sendPushToUser` never checks Expo push receipts, so tokens that die after the send are never pruned. It also pairs `tickets[i]` with `validTokens[i]`, which stops being true once a chunk fails: the failed chunk adds no tickets, every later ticket shifts onto the wrong token, and a `DeviceNotRegistered` ticket deletes a different (live) token.

## Background

Item R12 of the 2026-10-30 reliability audit. Draft PR #1624 implemented it but conflicts with main in 8+ files and was closed on 2026-11-03; this todo carries the item forward. The misalignment needs more than 100 tokens for one user (Expo chunks at 100), so it is rare in practice — but the code comment at `server/services/push-notifications.ts:104` claims the indices always align, which a timed-out or failed chunk breaks.

## Acceptance Criteria

- [x] A failed or timed-out chunk does not shift later tickets onto the wrong tokens (test: 2 chunks, first rejects, second returns `DeviceNotRegistered` → only the second chunk's token is deleted)
- [x] Push receipts are fetched for the `ok` tickets after Expo's recommended delay (~15 min) and `DeviceNotRegistered` receipts prune their token; other receipt errors are logged
- [x] The receipt check never blocks the send path and survives a server restart without crashing (losing pending receipts on restart is acceptable — say so in a comment)
- [x] The misleading "indices align" comment is corrected

## Implementation Notes

- `server/services/push-notifications.ts` — pair tickets with tokens per chunk (`chunk` ↔ `chunkTickets`), not by global index.
- Receipts: `expo.chunkPushNotificationReceiptIds` + `getPushNotificationReceiptsAsync`. Reference implementation: commits on the closed PR #1624 branch `claude/reliability-server-network` (R12) — reuse its tests as templates.
- Tests beside `server/services/__tests__/push-notifications.test.ts`.

## Scope Contract

- **Mechanisms to use:** expo-server-sdk's receipt API; the existing `storage.deletePushToken`
- **Files in scope:** `server/services/push-notifications.ts`, its test
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-03

- Filed when closing draft PR #1624 (its R12 item never reached main).
