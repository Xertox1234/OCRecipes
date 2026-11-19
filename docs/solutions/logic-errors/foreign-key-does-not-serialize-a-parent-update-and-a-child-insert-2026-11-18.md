---
title: "A foreign key does not serialize an UPDATE of the parent row against an INSERT of a child — a check across two tables needs the same row lock in both paths"
track: bug
category: logic-errors
tags: [database, drizzle, postgres, concurrency, security, family-profiles]
module: server
applies_to: ["server/storage/meal-plan-items.ts", "server/storage/**/*.ts"]
symptoms: ["a route checks a child table (\"is there a log for this item?\") and then updates the parent in a separate statement", "another route reads a parent column (\"is this item a profile's?\") and then inserts a child row in a separate statement", "a proposed fix adds NOT EXISTS / INSERT … SELECT WHERE EXISTS and calls the race closed"]
created: 2026-11-18
severity: low
---

# A foreign key does not serialize a parent UPDATE against a child INSERT

## Problem

Changing a planned meal to a family profile's meal and confirming that meal as the user's intake could both succeed at once. The result was a profile's meal counted in the user's own nutrition — the spec's main anti-goal for family profiles. Each route checked the other's effect first (PATCH: "is it confirmed?"; confirm: "is it a profile's?") and then wrote in a separate statement.

## Symptoms

- `PATCH /api/meal-plan/items/:id` called `isMealPlanItemConfirmed` (reads `daily_logs`), then `updateMealPlanItemAudience` (updates `meal_plan_items`).
- `POST /api/meal-plan/items/:id/confirm` called `getMealPlanItemById` (reads `audience`), then `createDailyLog` (inserts `daily_logs`, FK to the item).
- Neither statement waited for the other.

## Root Cause

Under READ COMMITTED (PostgreSQL 13.2.1, 13.3.2 Table 13.3):

- The child INSERT's foreign-key check takes **FOR KEY SHARE** on the parent row. A plain UPDATE of non-key columns takes **FOR NO KEY UPDATE**. Those two do not conflict — so the FK gives no ordering at all.
- A `NOT EXISTS (SELECT … FROM child)` inside the UPDATE reads a snapshot and cannot see an uncommitted INSERT; an `INSERT … SELECT … WHERE EXISTS (parent.audience <> 'profile')` reads the parent without waiting. Both "conditional statement" fixes leave the race open.

The first new test reproduced this exactly: with a raw client holding the uncommitted log insert, the old UPDATE never blocked ("no backend became blocked").

## Solution

Put both check-then-write paths in a transaction and lock the **parent row** first, with conflicting modes:

- audience change: `tx.select(...).from(mealPlanItems).where(id, userId).for("update")` → confirmed check on `tx` → update on `tx`; returns `"confirmed"` instead of writing.
- confirm: `.for("share")` on the same row → audience check → `createDailyLog(log, tx)`; returns `{ status: "profile" }` instead of writing.

FOR UPDATE conflicts with the insert's FOR KEY SHARE and with FOR SHARE, so whichever comes second waits and then sees the other's committed change. Two confirms both hold FOR SHARE and are still refused by the unique index `daily_logs_unique_meal_plan_confirm`.

## Prevention

- A rule "X and Y never both hold" enforced by two routes that each check the other table and then write is a race until both lock the same row. Look for the check and the write being separate `await`s on `db`.
- Don't accept an FK, a subquery, or `INSERT … SELECT` as the serializer. Lock the shared parent row in both paths, or make it a constraint.
- Test it with two real connections, not `db-test-utils` savepoints (one connection cannot race): a raw `pg.Client` holds the other side's write uncommitted, and the test asserts the real storage call is **blocked** (`pg_blocking_pids`) before committing. A test that only checks the end state can pass by timing.

## Related Files

- `server/storage/meal-plan-items.ts` — `updateMealPlanItemAudience`, `createMealPlanConfirmLog`
- `server/storage/nutrition.ts` — `createDailyLog(log, executor)`
- `server/routes/meal-plan.ts` — PATCH audience, POST confirm
- `server/storage/__tests__/meal-plan-audience.concurrent.test.ts` — forced interleaving, both orders

## See Also

- `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md` — the same check-then-act family for counts
- `server/storage/__tests__/users-subscription.concurrent.test.ts` — the multi-connection test pattern this follows
