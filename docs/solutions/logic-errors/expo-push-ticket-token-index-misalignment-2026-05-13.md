---
title: Expo push ticket-to-token index misalignment
track: bug
category: logic-errors
module: server
severity: high
tags: [expo-push, notifications, indexing, filter, chunking]
symptoms: [Wrong token deleted when push delivery returns an error ticket, Push ticket array indices don't align with raw token array indices, Stale push tokens accumulate because deletion targets the wrong record]
applies_to: [server/services/push-notifications.ts]
created: '2026-04-29'
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

## Related Files

- `server/services/push-notifications.ts`
