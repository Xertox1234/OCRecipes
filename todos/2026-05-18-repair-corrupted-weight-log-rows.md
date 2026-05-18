---
title: "Repair weight_logs rows corrupted by missing-unit lb conversion"
status: blocked
priority: high
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [data-integrity, database]
github_issue:
---

# Repair weight_logs rows corrupted by missing-unit lb conversion

## Summary

Manual weight entries logged from `WeightTrackingScreen` were stored at
`kg × 0.453592` because the client never sent a `unit` and the route defaulted
to `"lb"`, then converted. The write-path bug is now fixed forward, but rows
already written before the fix hold corrupted (under-stated) weight values.

## Background

`server/routes/weight.ts` POST `/api/weight` validates with
`createWeightLogSchema`, whose `unit` field defaults to `"lb"`. When `unit` is
`"lb"` the handler multiplies the value by `0.453592` to "normalize to kg".
`client/hooks/useWeightLogs.ts` `useLogWeight` sent only `{ weight, note }` —
no `unit` — so kg-entered values were treated as pounds and divided by ~2.2.

Discovered 2026-05-18 while fixing the unrelated `profile-hub.ts` weight-unit
mislabel (todo `2026-05-16-user-measurement-unit-preference.md`). The forward
fix (client now sends `unit: "kg"`) shipped on branch `fix/weight-unit-mislabel`.
This todo covers the **existing corrupted rows only**.

## Acceptance Criteria

- [ ] Quantify the blast radius: count `weight_logs` rows by `source` and `unit`,
      and determine the cutoff (rows created before the forward fix deployed)
- [ ] Identify which rows are actually corrupted — only `source = "manual"`
      rows written before the fix; HealthKit/scale rows that legitimately sent
      kg are NOT corrupted and must not be touched
- [ ] Write a one-off migration/script that multiplies affected rows' `weight`
      back by `~2.2046` (inverse of `0.453592`)
- [ ] Also correct `users.weight` / `users.goalWeight` where they were synced
      from a corrupted log (`createWeightLogAndUpdateUser` copies the log value
      into `users.weight`)
- [ ] Dry-run the script and review affected row counts before executing
- [ ] Verify weight trend / chart values look sane for an affected test account

## Implementation Notes

- Forward-fix commit (already done): `useLogWeight` sends `unit: "kg"`; route
  default is unchanged but no longer reached by the app.
- Distinguishing corrupted rows is the hard part — `unit` is stored as `"kg"`
  for ALL rows (the route always writes `"kg"` after converting), so the column
  does not identify corruption. Use `source` + `loggedAt` < fix-deploy date.
- Confirm whether any non-app client legitimately posts `unit: "lb"` before
  assuming all pre-fix manual rows are corrupted.

## Dependencies

- Forward fix on `fix/weight-unit-mislabel` must be merged & deployed first, so
  the cutoff date is well-defined.

## Risks

- Double-correction: running the repair twice would inflate values. Make the
  script idempotent or gate it behind an explicit one-time flag.
- Misclassification: un-converting a row that was already correct kg corrupts
  good data in the other direction.

## Updates

### 2026-05-18

- Initial creation. Found while fixing the weight-unit mislabel todo; the
  forward fix shipped, this tracks the historical-data cleanup.

### 2026-05-18 — repair script landed; status → blocked (operator action)

- Repair script written and committed:
  - `server/scripts/repair-weight-log-units.ts` — dry-run-by-default CLI; only
    writes with `--execute`; refuses to re-run once its audit file exists
    (override `--force`); rows that reverse to an implausible weight are flagged
    `needs-review` and left untouched.
  - `server/scripts/repair-weight-log-units-utils.ts` — pure classification /
    reverse-conversion helpers (unit-tested).
  - `server/scripts/__tests__/repair-weight-log-units-utils.test.ts` — 13 tests.
- The forward-fix dependency is satisfied: commit `ac027cb7` (PR #220) is merged
  to `main`, authored 2026-05-18 07:29:43 -0600 (= `2026-05-18T13:29:43Z`). Use
  the actual **production deploy** time of that commit as `--cutoff`.
- Finding: `users.goalWeight` is never synced from a weight log
  (`createWeightLogAndUpdateUser` writes only `users.weight`), so no goalWeight
  row was corrupted by this bug — the script does not touch it.
- Status is `blocked` because the remaining acceptance criteria require live
  production DB access and are intentionally not automated (user health data).
  Operator steps to finish and then archive this todo:
  1. Dry-run: `npx tsx server/scripts/repair-weight-log-units.ts --cutoff <prod-deploy-ISO>`
     and review the blast-radius / corrupted / needs-review counts.
  2. Execute: re-run with `--execute`. Inspect the written audit JSON.
  3. Verify the weight trend / chart looks sane for an affected test account.
  4. Manually triage any `needs-review` rows.
- Deferred kimi-review WARNINGs (not fixed — low value for an operator-run
  one-off): `--audit-file` path is not sandboxed (arbitrary write if an attacker
  already controls the CLI); candidate read is outside the transaction (write
  skew — mitigated by the "run during idle time" doc note).
