---
title: "Replace getAllUserIds with cursor-based iteration for scheduler at scale"
status: done
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [performance, scalability, scheduler]
---

# Replace getAllUserIds with cursor-based iteration for scheduler at scale

## Summary

`getAllUserIds()` loads all user IDs into memory in a single query. This is fine at small scale but will become a problem as the user base grows — a 100k-user table means 100k rows fetched and held in the Node.js heap before the scheduler loop even begins.

## Background

`server/storage/users.ts:206-209`:

```ts
export async function getAllUserIds(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}
```

Called by both `sendDailyCheckinReminders` and `sendMealLogReminders` in the notification scheduler.

## Acceptance Criteria

- [ ] Scheduler iterates users in pages (e.g., 500 at a time) rather than loading all IDs at once
- [ ] No behavioral change — all users still receive reminders
- [ ] Memory footprint of scheduler cron jobs is bounded regardless of user count

## Implementation Notes

Option 1 — cursor pagination in storage:

```ts
export async function getUserIdPage(
  afterId: string | null,
  limit = 500,
): Promise<string[]> {
  const query = db
    .select({ id: users.id })
    .from(users)
    .limit(limit)
    .orderBy(users.id);
  if (afterId) query.where(gt(users.id, afterId));
  const rows = await query;
  return rows.map((r) => r.id);
}
```

Option 2 — keep `getAllUserIds` but add a `// TODO` comment now so it's not forgotten:

```ts
// TODO: replace with cursor-based iteration when user count exceeds ~10k
export async function getAllUserIds(): Promise<string[]> { ... }
```

Option 2 is the minimal change for now.

## Dependencies

- None — can be done independently of other coach badge work

## Risks

- Low — pagination logic is well-understood; test coverage should verify all pages are processed

## Updates

### 2026-05-01

- Identified during PR #45 code review
