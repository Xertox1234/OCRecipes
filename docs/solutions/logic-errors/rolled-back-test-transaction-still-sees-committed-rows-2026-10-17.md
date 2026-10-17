---
title: "A rolled-back test transaction still sees rows already committed in the dev database — a real-DB test of a table-wide job must scope its assertions to its own rows"
track: bug
category: logic-errors
tags: [testing, database, drizzle, postgres, integration-tests, retention]
module: server
applies_to: ["server/**/__tests__/**/*.ts"]
symptoms: ["A real-DB test passes in CI and fails on one laptop with an extra row in a deep-equal (`expected [ …(3) ] to deeply equal [ 'a', 'b' ]`)", "A cleanup/purge test's `rowsDeleted` is higher than the rows the test inserted", "The failure goes away after deleting a row that some earlier manual use of the local server created"]
created: 2026-10-17
severity: low
---

# A rolled-back test transaction still sees rows already committed in the dev database

## Problem

`setupTestTransaction` / `rollbackTestTransaction` (`test/db-test-utils.ts`) undo **the test's own writes**. They do not hide rows that were already committed before the test started. Any assertion that reads a whole table, or a count from a job that runs across the whole table, therefore includes whatever the local database happens to hold.

`server/scripts/__tests__/cleanup-retention-mfa.test.ts` read all of `mfa_challenges` and `mfa_trusted_devices`, and asserted the purge's raw `rowsDeleted`. A challenge row left behind by a local two-step sign-in during the 2026-10-12 visual QA sweep made it fail with an extra row. CI's database is fresh each run, so CI never showed it.

## Root Cause

Transaction isolation works one way only. Inside the test transaction, the test sees committed data plus its own uncommitted writes. Rollback discards only the second part. A table-wide `SELECT` sees both parts. A job that runs across the whole table — such as `purgeExpiredMfaRows`, which deletes every expired row regardless of user — acts on both parts and counts them all.

## Solution

1. **Filter every remaining-row read by the test's own keys**, e.g. `.where(eq(mfaChallenges.userId, a.id))`, rather than selecting the whole table.
2. **For a count the code returns for the whole table, measure the rows that belong to others and add them**, rather than copying the job's cutoff rule into the test:

   ```ts
   const foreignRows = async () =>
     (await tx.select({ id: t.id }).from(t).where(ne(t.userId, a.id))).length;
   const before = await foreignRows();
   const results = await purgeExpiredMfaRows(tx, now, 1);
   const after = await foreignRows();
   expect(results[0].rowsDeleted).toBe(2 + before - after);
   ```

   The before/after difference is not a check on its own. The checks on each user's remaining rows are what catch a wrong cutoff.
3. **Prove it in the setup:** insert a second user with one expired row and one live row. They stand in for leftover dev data, and the test asserts they follow the same rule. Without these rows the scoped version cannot be told apart from the old one. With them, the old assertions fail (red) and the scoped ones pass.

## Prevention

- In a real-DB test, treat any `select().from(table)` without a `where` as a finding. The same goes for an exact count taken from a job that runs across the whole table.
- Do not solve it with `tx.delete(table)` at the start of the test. That works, but it hides the problem instead of proving the assertions are scoped.

## Related Files

- `server/scripts/__tests__/cleanup-retention-mfa.test.ts` — the fixed test (PR #1477)
- `server/scripts/cleanup-retention.ts` — `purgeExpiredMfaRows` / `purgeDomain`, whole-table deletes
- `test/db-test-utils.ts` — the transaction helpers

## See Also

- [Storage integration tests with transaction rollback](../design-patterns/storage-integration-tests-transaction-rollback-2026-05-13.md) — the harness this lesson qualifies
- [Side effects inside db.transaction desync on rollback](side-effects-inside-db-transaction-rollback-2026-05-13.md) — the other one-way property of rollback
