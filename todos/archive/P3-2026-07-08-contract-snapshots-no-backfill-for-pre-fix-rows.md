<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "dev.contract_snapshots has no backfill/redaction for rows written before PR #544's dynamic-key fix"
status: done
priority: low
created: 2026-07-08
updated: 2026-07-09
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

- [x] Either a one-time backfill script that re-derives redacted shapes for existing rows, or
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

### 2026-07-09 — Resolved

- Decided against a backfill script; documented the decision explicitly instead. Verified
  locally that `dev.contract_snapshots` is currently empty (0 rows) in `ocrecipes_lab`, so
  there is no actual stale data anywhere requiring remediation right now.
- Rationale (recorded as a `DECISION` comment above `recordSnapshot()` in
  `server/lib/contract-snapshot.ts`, plus a shorter pointer in
  `scripts/pg-lab/schema/contract-snapshots.sql`):
  1. The table is dev-only, opt-in (`CONTRACT_SNAPSHOT=1`), and unconditionally refused
     under `NODE_ENV=production` — no production data is ever at risk.
  2. The canonical leak channel (a developer diffing an old pre-#544 snapshot against a
     new post-#544 one for the same route — the migration scenario `contract-diff.sh`
     runs across a branch boundary) is already closed by
     `todos/archive/P1-2026-07-08-contract-diff-cli-leaks-old-unredacted-keys.md` —
     `diffRouteShapes()` never prints raw keys for that transition. Not fully closed by
     that same todo's own accepted boundary: diffing two pre-#544 rows against each
     other, or a key that never trips the redaction heuristic, still prints real key
     names via the normal path — a narrower residual than the pre-#544 exposure, and
     still confined to a dev-only, opt-in, non-production tool.
  3. Every row is disposable, re-derivable diagnostic data, not a source of truth (per
     `scripts/pg-lab/init.sh`'s own design-rail comment). A real backfill script would mean
     duplicating `deriveShape()`'s redaction heuristics as a second, standalone recursive
     walker over an already-derived `Shape` tree — those heuristics aren't exported for
     reuse, and this exact module has already had multiple subtle regression bugs in
     redaction logic this week. That risk is disproportionate to a P3/low-severity gap with
     no production exposure.
- Remediation documented for any developer who wants pre-fix rows gone from their own local
  table: `TRUNCATE dev.contract_snapshots;` (safe — rows repopulate on the next
  `CONTRACT_SNAPSHOT=1` request).
