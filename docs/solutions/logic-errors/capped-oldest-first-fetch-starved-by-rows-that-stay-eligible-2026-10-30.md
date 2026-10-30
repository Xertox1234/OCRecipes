---
title: A capped oldest-first fetch of a work queue is starved by rows that stay eligible after a failed attempt
track: bug
category: logic-errors
module: server
severity: low
tags: [database, architecture, pagination, keyset, scheduler, queue, starvation, reliability]
applies_to: [server/storage/**/*.ts, server/services/**/*scheduler*.ts, server/services/notification-scheduler.ts]
symptoms: [Newer users never receive a scheduled reminder while older ones get retried every day, A batch job processes the same first N rows on every run, Undeliverable rows (no push token) block the head of the queue]
created: 2026-10-30
---

# A capped oldest-first fetch of a work queue is starved by rows that stay eligible after a failed attempt

## Problem

`sendDueCommitmentReminders` made one call, `storage.getDueCommitmentsAllUsers()`: due, active commitment entries, `ORDER BY followUpDate`, `LIMIT 500`. A failed delivery (no registered device, push error) leaves the entry `active`, so it still matches the predicate on the next run. When 500 permanently-undeliverable entries pile up at the oldest end, every run fetches the same 500 rows, and no user with a newer due date is ever reached.

## Root Cause

A `LIMIT` used as a work-bounding cap is only safe when processing a row removes it from the predicate (status flips, row is deleted, date advances). If failure leaves the row eligible, the cap turns into a fixed window over the head of the queue. Ordering by a non-unique column (`followUpDate` alone) also leaves the order among ties undefined.

## Solution

Keyset-page through the whole eligible set on each run:

```ts
// storage: unique, stable order + (followUpDate, id) cursor
.where(and(dueAndActive, after
  ? or(gt(t.followUpDate, after.followUpDate),
       and(eq(t.followUpDate, after.followUpDate), gt(t.id, after.id)))
  : undefined))
.orderBy(asc(t.followUpDate), asc(t.id))
.limit(limit);

// service: loop until a short page
let after;
while (true) {
  const page = await storage.getDueCommitmentsAllUsers(PAGE, after);
  if (page.length === 0) return;
  await sendCommitmentReminderPage(page);
  const last = page[page.length - 1];
  if (page.length < PAGE || !last.followUpDate) return;
  after = { followUpDate: last.followUpDate, id: last.id };
}
```

The page size still limits memory per round-trip. It no longer limits how many rows a run covers.

## Prevention

- When reviewing a `LIMIT` on a job or queue fetch, ask whether a failed item leaves the predicate. If it does not, page with a keyset cursor (or mark the row attempted or backed off) instead of taking one capped fetch.
- Keyset order needs a unique tiebreaker (`, id`). Without it, rows that share the sort value can be skipped or repeated across pages.
- The sibling bug in the same audit (R32) is a `LIMIT` with no `ORDER BY` on raw rows where the caller needed N distinct ordered days. It came from the same assumption that a LIMIT bounds the work and not the answer. Bound the unit you actually consume (`SELECT DISTINCT day … ORDER BY day DESC LIMIT n`).

## Related Files

- `server/storage/coach-notebook.ts` — `getDueCommitmentsAllUsers(limit, after?)`
- `server/services/notification-scheduler.ts` — `sendDueCommitmentReminders`, `sendCommitmentReminderPage`
- `server/storage/verification.ts` — `getUserVerificationStats` (R32 sibling)
- `server/storage/__tests__/coach-notebook.test.ts`, `server/services/__tests__/notification-scheduler.test.ts`

## See Also

- `docs/solutions/logic-errors/truncate-before-rank-discards-best-candidates-2026-08-06.md`
- 2026-10-30 reliability audit R30, R32
