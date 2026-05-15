---
title: "Batch profile fetches in sendDueCommitmentReminders (one fetch per user, not per entry)"
status: in-progress
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [performance, coach-badge, scheduler]
---

# Batch profile fetches in sendDueCommitmentReminders (one fetch per user, not per entry)

## Summary

`sendDueCommitmentReminders` fetches the user profile inside a per-entry loop. A user with multiple due commitments causes redundant profile fetches — one per entry rather than one per user.

## Background

`server/services/notification-scheduler.ts:55`:

```ts
for (const entry of entries) {
  const profile = await storage.getUserProfile(entry.userId); // N fetches for N entries
  if (isMuted(profile?.reminderMutes, "commitment")) continue;
  ...
}
```

If a user has 5 active commitments all due today, 5 identical profile fetches are made. Low impact now, but will be noticeable as commitment usage grows.

## Acceptance Criteria

- [ ] Profile is fetched once per unique `userId`, not once per entry
- [ ] Mute check uses the cached profile for all entries belonging to that user
- [ ] Existing scheduler tests still pass

## Implementation Notes

```ts
const userIds = [...new Set(entries.map((e) => e.userId))];
const profiles = new Map(
  await Promise.all(
    userIds.map(async (id) => [id, await storage.getUserProfile(id)] as const),
  ),
);

for (const entry of entries) {
  const profile = profiles.get(entry.userId);
  if (isMuted(profile?.reminderMutes, "commitment")) continue;
  ...
}
```

Or simply use `getDueCommitmentsAllUsers` result grouped by userId before the loop.

## Dependencies

- None

## Risks

- Low — pure optimization, no behavior change

## Updates

### 2026-05-01

- Identified during PR #45 code review
