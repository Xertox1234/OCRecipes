<!-- Filename: P3-2026-07-06-pg-lab-safety-rail-query-string-bypass.md -->

---

title: "PG Lab: safety-rail denylist bypassable via LAB_DATABASE_URL query-string suffix"
status: backlog
priority: low
created: 2026-07-06
updated: 2026-07-06
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: safety-rail denylist bypassable via LAB_DATABASE_URL query-string suffix

## Summary

Every PG Lab script's "never touch a real app database" safety rail matches on `${LAB_DATABASE_URL##*/}` (the text after the last `/`), which a trailing query string defeats — e.g. `postgresql://localhost/nutricam?sslmode=disable` yields `nutricam?sslmode=disable`, not `nutricam`, and slips past the `case ... in nutricam | ocrecipes_solutions)` denylist.

## Background

Surfaced as a non-blocking SUGGESTION during server-reviewer's review of `todos/archive/P3-2026-07-05-pg-injection-usage-telemetry.md` (PG Lab injection-log telemetry). The gap is inherited verbatim from the original `scripts/pg-lab/init.sh` / `scripts/pg-lab/codify-neardup.sh` pattern (not a regression introduced by that todo) and is now perpetuated by the two new scripts it added (`scripts/pg-lab/log-injection.sh`, `scripts/pg-lab/injection-report.sh`) — all four PG Lab scripts share the identical denylist shape and should be fixed together rather than piecemeal.

Impact is low: this is a local-dev-only tool (`ocrecipes_lab` vs. the real `nutricam` app DB), the bypass requires an operator to explicitly hand-craft a query-string-suffixed `LAB_DATABASE_URL` (not something that happens by accident in normal usage), and the practical blast radius per script is limited — `log-injection.sh`/`codify-neardup.sh` query mode would just fail to find `harness.*` tables in `nutricam` (fail-silent, no-op), `injection-report.sh` would error loudly on the same missing-table condition, and `init.sh` is the only one with real teeth (`CREATE EXTENSION`/`CREATE SCHEMA` against the wrong DB) — still non-destructive to existing `nutricam` data, but not nothing.

## Acceptance Criteria

- [ ] Strip a `?...` query-string suffix (and, for robustness, any trailing `#fragment`) from the last path segment before the denylist `case` match, in all four scripts: `scripts/pg-lab/init.sh`, `scripts/pg-lab/codify-neardup.sh`, `scripts/pg-lab/log-injection.sh`, `scripts/pg-lab/injection-report.sh`.
- [ ] A single shared helper (sourced or duplicated consistently) is preferable to four independent fixes drifting apart — consider whether the four scripts can source one small `lib` snippet, matching the `scripts/lib/path-domains.ts` / `.claude/hooks/lib/domain-map.sh` single-source-of-truth precedent, but a plain duplicated one-liner is acceptable if a shared lib adds more ceremony than value for four call sites.
- [ ] Existing hook self-tests (`.claude/hooks/test-pg-lab-codify-neardup.sh`, `.claude/hooks/test-pg-lab-log-injection.sh`) gain a case asserting the query-string-suffixed bypass no longer works (e.g. `LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=disable"` is still refused).

## Implementation Notes

- The fix is a pure string operation before the `case` match, e.g. `DB_NAME="${LAB_DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"` (strip from the first `?` onward) — no live DB connection needed to test it, mirrors the existing identifier-injection guard tests in `test-pg-lab-codify-neardup.sh` which run without a live Postgres.
- `scripts/pg-lab/init.sh` additionally uses `DB_NAME` for `psql -c` SQL text interpolation later in the file (its own comment already notes this) — verify the query-string strip happens before that second use too, not just before the denylist check.

## Dependencies

- None.

## Risks

- Low — local-dev-only tooling, no user data or production surface.

## Updates

### 2026-07-06

- Filed from a SUGGESTION surfaced during server-reviewer's review of the pg-injection-usage-telemetry todo.
