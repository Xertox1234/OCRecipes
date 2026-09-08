---
title: "The corpus covers every deny SITE but not every alternation BRANCH inside one — 13 live protections can be narrowed away invisibly"
status: backlog
priority: medium
created: 2026-09-08
updated: 2026-09-08
assignee:
labels: [deferred, harness, testing, security]
github_issue:
---

# A sibling alternative keeps the site attributed while the branch beside it goes dead

## Summary

`_pin_sites` (added in PR #935) guarantees every deny message the guard can **emit** is reached
by some corpus row. It cannot see one level deeper: a deny regex is usually an **alternation**,
and only one branch of it needs a row for the whole site to stay attributed. **13 alternation
branches across 4 command-position deny regexes have no corpus row at all.** Narrowing any of
them out of its alternation flips real commands DENY → ALLOW while every check in the pin stays
green — the rows, both gap totals, all three manifests, the subset invariant, `_pin_distinct`,
`_pin_denominator`, and `_pin_sites` (because a _sibling_ branch still reaches the same message).

## Background

Filed 2026-09-08 from PR #935's own residual disclosure, at the user's request after I argued it
was too unbounded to file. Measuring it made it bounded, so the objection does not hold.

PR #935's `_pin_sites` closed the "a deny site with no rows can be deleted invisibly" hole, found
by a reviewer neutering three sites and watching the corpus exit 0 with zero diff lines. The pin
block now discloses the remaining residual in prose:

> A scope NARROWING INSIDE a check that still fires first for every corpus row: the check keeps
> producing the same verdict AND the same reason for all 448 rows while commands outside the
> corpus flip.

This todo is the measured, actionable form of that sentence.

**Measured 2026-09-08** against `main` at `4248100d`. Every branch below **denies correctly
today** (verified by direct probe — the guard is not broken; nothing would notice if it were):

| deny regex                                                               | branches with a corpus row | branches with NO row                                                      |
| ------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| `railway (up\|deploy\|redeploy\|restart\|down\|delete\|remove\|rm\|run)` | `up`                       | **`deploy` `redeploy` `restart` `down` `delete` `remove` `rm` `run`** (8) |
| `eas (update\|publish\|submit)`                                          | `update`                   | **`publish` `submit`** (2)                                                |
| `railway (variable\|variables\|vars\|var) set/delete`                    | `variable`, `var`          | **`variables` `vars`** (2)                                                |
| `railway (service\|environment) delete`                                  | `service`                  | **`environment`** (1)                                                     |

`railway run` is the sharpest of these. The guard's own message says it "executes an arbitrary
command with the LIVE service env, incl. the production DATABASE_URL". Deleting `run` from that
alternation is a serious regression and is invisible to the entire required check today.

`eas publish` matters for the same reason `eas update` does — it is the pre-SDK-46 spelling of an
OTA publish, i.e. the 2026-08-16 incident class.

## Acceptance Criteria

- [ ] Every alternation branch listed above is exercised by at least one corpus row, generated
      from the guard's own alternation lists rather than hand-listed (NOTE6's rule: new
      dimensions are GENERATED — a hand-carved subset is how the tool position went missing).
- [ ] **Mutation-verified per regex, not per row.** For each of the 4 regexes, delete one branch
      that previously had no row and show the corpus goes RED. Assumed-correct is not acceptable
      in this file.
- [ ] A negative control: confirm the same mutation was **green** before the new rows, so the
      rows are demonstrably what closed it (same evidence shape PR #935 used for `_pin_sites`).
- [ ] The residual paragraph in the pin block is updated — narrowed to whatever remains, or
      marked closed if nothing does. Do not leave it asserting a hole that has been filled; a
      residual list that names a closed residual is the defect PR #935 already fixed once.
- [ ] Runtime impact stated. The corpus is a REQUIRED check; ~13-20 new rows on a 448-row,
      ~100s run is expected to be minor, but state the measurement rather than assuming it.

## Implementation Notes

**Scope discipline.** This is coverage of branches that already exist in the guard. It is NOT a
mandate to enumerate every mechanism × every branch — that is a cross product with the existing
30+ mechanism axes and would multiply the corpus several-fold for a REQUIRED check. One row per
uncovered branch, in a small dedicated family list, is the shape: same reasoning `INTR_FAM_IDS`
and the `DENY-SITE COVERAGE` axis both record for keeping their own lists rather than joining
`FAM_IDS`.

**Where.** Extend the `DENY-SITE COVERAGE` axis in
`.claude/hooks/repro-outward-cli-corpus.sh` — it exists for exactly this class and already has
the comment explaining why.

**Re-pinning.** New rows change `EXPECTED_ROWS`, likely `EXPECTED_ALLPATH_GAPS`, and
`EXPECTED_DENY_ATTRIB_ROWS` + its manifest. Regenerate from a run, never hand-edit the manifest
lines; the run's own failure output is the attribution for the bump. Expect the degraded mirror
(`crude_smells_outward`) to over-deny some rows — that is the documented disclosure shape, not a
regression, and it is why `ALLGAPS` moves.

**Consider automating the check, not just the rows.** The durable form is the `_pin_sites`
treatment one level down: extract each alternation from the guard source and assert every branch
is exercised, so the _next_ branch added to a regex fails the gate. Weigh it against fragility —
`_pin_sites` parses a fixed `deny "guard-outward-cli: …"` shape, whereas alternation extraction
means parsing regex bodies built from `${_OUT_POS_PREFIX}`/`${_OUT_SEP}` interpolations. If the
parse cannot be made robust, adding the rows plus a comment naming the limit is the honest stop —
but say which was chosen and why.

**Do not re-derive the two facts already measured here.** All 13 branches deny today, and no
existing todo covers this (dedup checked 2026-09-08 across `todos/*.md`).

Related: `todos/archive/P2-2026-09-07-corpus-pin-does-not-cover-deny-reason-attribution.md`
(PR #935, which added `_pin_sites` and disclosed this residual);
`docs/solutions/logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md`
(the count → membership → per-path → attribution → emitter-coverage progression this extends).
