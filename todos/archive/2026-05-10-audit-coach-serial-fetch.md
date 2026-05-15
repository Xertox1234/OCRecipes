---
title: "Coach Pro: parallelize getActiveNotebookEntries with initial Promise.all"
status: backlog
priority: medium
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [performance, coach]
github_issue:
---

# Coach Pro: parallelize getActiveNotebookEntries with initial Promise.all

## Summary

`getActiveNotebookEntries` is fetched serially after the 5-way `Promise.all` in `generateCoachProResponse`, adding a full round-trip of unnecessary latency (~5–20ms) to every Coach Pro turn.

## Background

Audit 2026-05-10, finding H4. In `server/services/coach-pro-chat.ts`, the function first awaits a `Promise.all` of [profile, dailySummary, weights, history, daily logs] at line 364, then issues `await storage.getActiveNotebookEntries(userId)` at line 428 as a serial step. Both have the same inputs (`userId`, `isCoachPro`) known at function entry.

## Acceptance Criteria

- [ ] `getActiveNotebookEntries(userId)` included in the `Promise.all` at line 364 (conditional on `isCoachPro`)
- [ ] No serial await for this call after the `Promise.all`
- [ ] Existing coach tests pass

## Implementation Notes

```typescript
const [profile, dailySummary, weights, history, dailyLogs, notebookEntries] =
  await Promise.all([
    storage.getUser(userId),
    storage.getDailySummary(userId, date),
    storage.getWeightLogs(userId, 7),
    storage.getChatHistory(conversationId),
    storage.getDailyLogs(userId, date),
    isCoachPro ? storage.getActiveNotebookEntries(userId) : Promise.resolve([]),
  ]);
```

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (H4) — optimization, not a correctness issue
