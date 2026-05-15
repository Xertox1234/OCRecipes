---
title: "Fix TOCTOU race in acknowledgeReminders (SELECT then UPDATE)"
status: done
priority: medium
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [bug, coach-badge, storage, database]
---

# Fix TOCTOU race in acknowledgeReminders (SELECT then UPDATE)

## Summary

`acknowledgeReminders` in `server/storage/reminders.ts` uses two separate queries — a SELECT to read pending rows, then an UPDATE to mark them acknowledged. Two concurrent calls can both SELECT the same rows before either UPDATE runs, causing the same `coachContext` to be returned twice and both calls to re-mark already-acknowledged rows.

## Background

```ts
// server/storage/reminders.ts:47-78
const pending = await db.select()...  // ← both concurrent calls see same rows
await db.update(...).set({ acknowledgedAt: new Date() })...
return pending.map(...)
```

This is a time-of-check-to-time-of-update (TOCTOU) race. It happens when the user opens the Coach tab while a background foreground-refetch is still in-flight. In practice the consequence is the AI coach receives the same context twice in one session — low severity but deterministically reproducible with slow connections.

## Acceptance Criteria

- [ ] `acknowledgeReminders` uses a single atomic `UPDATE ... RETURNING` statement
- [ ] The returned rows are the ones actually updated (not a pre-UPDATE snapshot)
- [ ] Existing route tests still pass

## Implementation Notes

Drizzle supports `.returning()` on updates:

```ts
export async function acknowledgeReminders(
  userId: string,
): Promise<CoachContextItem[]> {
  const acknowledged = await db
    .update(pendingReminders)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(pendingReminders.userId, userId),
        isNull(pendingReminders.acknowledgedAt),
      ),
    )
    .returning();

  return acknowledged.map((r) => ({
    type: r.type,
    ...r.context,
  })) as CoachContextItem[];
}
```

PostgreSQL `UPDATE ... RETURNING` is atomic — concurrent calls will each update a disjoint set of rows (whichever rows still have `acknowledgedAt IS NULL` at the moment the UPDATE executes).

## Dependencies

- None

## Risks

- Low — `.returning()` is well-supported in Drizzle + PostgreSQL; no schema changes needed

## Updates

### 2026-05-01

- Identified during PR #45 code review
