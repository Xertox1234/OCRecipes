---
title: Expo push ticket-to-token index misalignment
track: bug
category: logic-errors
module: server
severity: high
tags: [architecture, expo-push, notifications, indexing, filter, chunking]
symptoms: [Wrong token deleted when push delivery returns an error ticket, Push ticket array indices don't align with raw token array indices, Stale push tokens accumulate because deletion targets the wrong record, A failed push chunk makes every later ticket prune the wrong token, DeviceNotRegistered tokens never pruned because push receipts are never fetched]
applies_to: [server/services/push-notifications.ts]
created: '2026-04-29'
last_updated: '2026-10-30'
---

# Expo push ticket-to-token index misalignment

## Problem

When using `expo-server-sdk`'s chunked push delivery, `sendPushNotificationsAsync` returns one `ExpoPushTicket` per message in the same order they were submitted. If you filter the raw token list before building messages, the indices of `tickets` correspond to the filtered list — not the original token list. Using the original token list's index to match tickets to tokens will silently look up the wrong token when any tokens were filtered out.

## Symptoms

- Push delivery returns errors, but `deletePushToken` removes a token belonging to a different user/device
- Stale Expo push tokens accumulate in the DB because deletion never targets the real failed token
- Logs show "removed token X" while the actual failing token is Y

## Root Cause

`tokens` is the raw input array. `messages = tokens.filter(...).map(...)` produces a shorter, re-indexed array. The `tickets` returned by Expo correspond to `messages`, not `tokens`. Using `tokens[i]` to map errors back drifts by every filtered-out element.

## Solution

Build a separate `validTokens` array so indices align:

```typescript
// Wrong — tickets[i] doesn't correspond to tokens[i] because
// messages was built from a filtered subset
const messages = tokens
  .filter(t => Expo.isExpoPushToken(t.token))
  .map(t => ({ to: t.token, ... }));

const tickets = await client.sendPushNotificationsAsync(messages);

for (let i = 0; i < tickets.length; i++) {
  if (tickets[i].status === "error") {
    const stale = tokens[i]; // BUG: wrong token if any were filtered
    await storage.deletePushToken(userId, stale.token);
  }
}

// Correct — build a separate validTokens array so indices align
const validTokens = tokens.filter(t => Expo.isExpoPushToken(t.token));
const messages = validTokens.map(t => ({ to: t.token, ... }));

const tickets = await client.sendPushNotificationsAsync(messages);

for (let i = 0; i < tickets.length; i++) {
  if (tickets[i].status === "error") {
    const stale = validTokens[i]; // correct: same filtered list
    await storage.deletePushToken(userId, stale.token);
  }
}
```

## Prevention

When using Expo push chunking, maintain a `validTokens` array parallel to `messages`. Never use the original unfiltered token array to map back from ticket indices. The same rule applies to any pipeline that filters before sending: keep a single array that drives both submission and post-processing.

## Recurrence (2026-10-30): a chunk that throws shifts every later index

Reliability audit R12. The `validTokens` fix still paired tickets by a **global** index. `sendPushNotificationsAsync` runs once per chunk, inside a try/catch with a timeout. When one chunk threw, its tickets were missing from the flat `tickets` array, so every later ticket mapped to a token from the failed chunk. The fix is to pair each ticket with `chunk[j].to`, the message it answers, at the point the chunk returns. Then no index crosses a chunk boundary:

```typescript
chunkTickets.forEach((ticket, j) => {
  const to = chunk[j]?.to;
  if (typeof to === "string") results.push({ ticket, token: to });
});
```

General rule: pair a response with its request inside the unit that can fail independently (the chunk), never by position across units.

## An "ok" ticket is not a delivery

A ticket only says Expo accepted the message. Most `DeviceNotRegistered` errors come from APNs/FCM in the **receipt**, which Expo produces later (check after about 15 minutes; kept for 24h). If receipts are never fetched, stale tokens never get pruned. `push-notifications.ts` now queues each `ok` ticket id → `{ userId, token, sentAt }` in an in-memory `Map` capped at 10k. `checkPushReceipts()` runs every 15 min via `startPushReceiptJob()`, started and cleared in `server/index.ts`. It fetches receipts for tickets at least 15 min old, deletes `DeviceNotRegistered` tokens, logs other receipt errors, keeps a ticket if its receipt fetch failed or the receipt is not ready yet, and drops tickets older than 24h. Pending tickets are lost on restart. That is deliberate: pruning is best-effort, and it avoids a schema change.

## Related Files

- `server/services/push-notifications.ts`
