<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "dev.contract_snapshots has no backfill/redaction for rows written before PR #544's dynamic-key fix"
status: backlog
priority: low
created: 2026-07-08
updated: 2026-07-08
assignee:
labels: [deferred, server]
github_issue:

---

# dev.contract_snapshots has no backfill/redaction for rows written before PR #544's dynamic-key fix

## Summary

PR #544's fix only changes what NEW writes to `dev.contract_snapshots` produce going forward.
Existing rows recorded before the fix shipped keep their raw, unredacted dynamic key names
indefinitely, since the upsert (`ON CONFLICT (branch, route_pattern, method, status)`) only
overwrites the row for the exact branch currently being re-exercised.

## Background

Found during code review of PR #544, confirmed via schema trace. A row recorded under a
since-deleted feature branch (or `main` before this PR merged) will likely never be
re-exercised, so it persists with unredacted key names indefinitely. Severity is capped low:
`dev.contract_snapshots` is a dev-only, opt-in (`CONTRACT_SNAPSHOT=1`) local `ocrecipes_lab`
table that unconditionally refuses under `NODE_ENV=production` — not a production data store.

## Acceptance Criteria

- [ ] Either a one-time backfill script that re-derives redacted shapes for existing rows, or
      an explicit decision documented that stale local dev data is acceptable to leave as-is
      (e.g. because `ocrecipes_lab` is routinely reset/rebuilt).

## Implementation Notes

`server/lib/contract-snapshot.ts` — the upsert/schema. Consider whether a simple
`TRUNCATE dev.contract_snapshots` (since it's fully derived, disposable dev tooling data) is
simpler than a backfill script.

## Dependencies

- None.

## Risks

- Low — local dev-only table, no production data exposure.

## Updates

### 2026-07-08

- Filed during code review of PR #544 (merged as 137b746e).
