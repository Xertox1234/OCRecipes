<!-- Filename: P3-2026-07-07-pg-lab-contract-diff-missing-fragment-strip.md -->

---

title: "PG Lab: contract-diff.sh's denylist guard is missing the fragment strip its siblings have"
status: done
priority: low
created: 2026-07-07
updated: 2026-07-09
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: contract-diff.sh's denylist guard is missing the fragment strip its siblings have

## Summary

`scripts/pg-lab/contract-diff.sh`'s `LAB_DATABASE_URL` denylist guard strips only the query
string (`DB_NAME="${LAB_DATABASE_URL%%\?*}"`) before the `##*/` split — it never adds the
`%%\#*` fragment strip that all 7 other fixed `scripts/pg-lab/*.sh` scripts now carry
(`init.sh`, `codify-neardup.sh`, `log-injection.sh`, `eval-report.sh`, `flake-report.sh`,
`git-mine.sh`, `injection-report.sh`). This is a real, already-manifested instance of the
"a fix to one copy does not protect the others" drift the project's own denylist-bypass
solution doc warns about.

## Background

Surfaced during `/review` of PR #540 (the `injection-report.sh` query-string/fragment fix).
The reuse-angle finder independently verified `contract-diff.sh`'s guard against the other
7 siblings and confirmed the fragment strip is missing there specifically.

**Severity note:** lower than it first appears. A companion finding in the same review
(independently verified live via `psql`) established that libpq treats `#` as a **literal**
dbname character, not a URI fragment delimiter — so a fragment-suffixed value like
`postgresql://host/nutricam#anchor` already fails LOUDLY pre-fix (`psql` errors on a
database literally named `nutricam#anchor`) rather than silently connecting to the real
`nutricam`, unlike the query-string vector. So this specific gap does not itself enable a
silent bypass — it's a consistency/drift issue (this script's guard now differs from its 7
siblings for no good reason), not a live security hole. Still worth fixing for consistency
and to stop the drift before a 9th copy of the pattern diverges too.

## Acceptance Criteria

- [x] `scripts/pg-lab/contract-diff.sh`'s `DB_NAME` extraction adds the `%%\#*` fragment
      strip, matching the identical `LAB_DB_PATH`-style two-line pattern used by the 7
      sibling scripts (see `scripts/pg-lab/injection-report.sh` for the current canonical
      form, including its inline `docs/solutions/...` cross-reference and the identifier-
      format second layer added in the same review).
- [x] `.claude/hooks/test-*.sh` for `contract-diff.sh` (if one exists) gains a fragment-
      suffix regression case; if none exists, consider whether this script warrants a
      dedicated test file (per the precedent set by `test-pg-lab-injection-report.sh`).
- [x] Update `docs/solutions/logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md`'s
      `contract-diff.sh` bullet in Related Files to reflect the fix once applied.

## Implementation Notes

- Consider, while touching this: is it finally worth extracting the now-8-times-duplicated
  strip pattern into a small sourced `scripts/pg-lab/lib.sh`? The project's own precedent
  (`scripts/lib/path-domains.ts`, `.claude/hooks/lib/domain-map.sh`) favors single-sourcing
  once a pattern is copied this many times, and this todo's own discovery (real drift after
  only 7 copies) is direct evidence for that threshold having been crossed. Not required by
  this todo's Acceptance Criteria — a plain duplicated fix is acceptable if a shared lib adds
  more ceremony than value — but worth a deliberate decision rather than defaulting to "just
  duplicate it again" without noticing the count.
- **Correction (2026-07-09, during implementation):** this note was stale. `contract-diff.sh`
  already had the identifier-format second layer (`^[A-Za-z_][A-Za-z0-9_]*$`) independently,
  since PR #529 (commit `ff4d7c55`, 2026-07-06) — confirmed via `git log -p` and consistent
  with the corrected `docs/solutions/logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md`
  Related Files bullet for this file. Nothing further was needed for that layer in this pass.

## Dependencies

- None.

## Risks

- Low — local-dev-only tooling, and (per the severity note above) the specific gap this todo
  closes does not itself enable a silent bypass.

## Updates

### 2026-07-07

- Filed from a finding surfaced during `/review` of PR #540.

### 2026-07-09

- Implemented: added `DB_NAME="${DB_NAME%%\#*}"` between the existing query-string strip
  and the `##*/` path-segment split in `scripts/pg-lab/contract-diff.sh`, matching the
  canonical order (query strip, fragment strip, path split) used by all 7 sibling scripts.
  Kept the existing `DB_NAME` variable naming rather than renaming to the siblings'
  `LAB_DB_PATH` — out-of-scope churn, and the identifier-format second layer already
  existed on this variable name.
- Added a fragment-suffix regression case to the existing
  `.claude/hooks/test-pg-lab-contract-diff.sh`, modeled on
  `test-pg-lab-injection-report.sh`'s version. Verified it actually discriminates: it fails
  on the pre-fix script (the fragment falls through the exact-match denylist to the
  identifier-format message instead) and passes post-fix.
- Updated the `contract-diff.sh` bullet in
  `docs/solutions/logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md`'s
  Related Files, and bumped `last_updated`.
- Declined the Implementation Notes' optional `scripts/pg-lab/lib.sh` extraction — out of
  this todo's Acceptance Criteria and project convention favors minimal changes for a
  low-priority, narrowly-scoped fix.
- Corrected two stale claims found during review (advisor + security-auditor +
  code-reviewer all independently flagged related staleness): this file's own
  Implementation Notes wrongly claimed the identifier-format layer was missing (it has
  existed since PR #529), and the solution doc's date was corrected to reflect the actual
  2026-07-09 landing date.
- Verification: `npm run test:run` (6046/6046 passing — one unrelated pre-existing flake in
  `server/storage/__tests__/reformulation.test.ts` reproduced clean in isolation and on a
  full re-run, confirmed unrelated to this diff), `npm run check:types` (clean),
  `npm run lint` (0 errors, 1 pre-existing unrelated warning in
  `scripts/coverage-ratchet.ts`), and `bash .claude/hooks/test-pg-lab-contract-diff.sh`
  (ALL PASS, including the new case).
- Code review: `code-reviewer` + `security-auditor`, both dispatched in parallel. No
  CRITICAL or WARNING findings from either. Two SUGGESTIONs (both addressed inline, see
  above).
