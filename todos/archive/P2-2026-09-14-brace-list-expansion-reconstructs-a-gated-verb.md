---
title: "guard-outward-cli.sh: brace LIST expansion {a,b} reconstructs a gated verb and is not modelled at all"
status: done
priority: medium
created: 2026-09-14
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# Brace LIST expansion is a third reconstruction mechanism with no coverage

## Summary

`guard-outward-cli.sh` models sigil-based reconstruction (`$`, backtick) and, since
PR #967, brace RANGE expansion (`{a..b}`). Brace **list** expansion (`{a,b}` — the
comma form) is a distinct bash mechanism that also reconstructs a complete gated verb
as its own argv word, and the guard does not model it anywhere.

## Background

Found 2026-09-14 while adjudicating the review of PR #967. Confirmed by construction
against that branch's own guard, with a live positive control (`eas update --branch
preview` → DENY) and a benign control (`mkdir -p /tmp/x/{a,b}` → ALLOW, correct).

Ground truth from `echo` (no outward CLI was executed), then the guard's verdict:

| construction                      | bash expands to                      | guard           |
| --------------------------------- | ------------------------------------ | --------------- |
| `eas up{d,x}ate --branch preview` | `eas update upxate --branch preview` | ALLOW           |
| `gh pr me{r,r}ge 42`              | `gh pr merge merge 42`               | ALLOW           |
| `npm pub{l,z}ish`                 | `npm publish pubzish`                | ALLOW           |
| `mkdir -p /tmp/x/{a,b}`           | (benign)                             | ALLOW — correct |

**Pre-existing, not introduced by #967** — all of these allow on `main` too.

## Why medium and not high

Every brace-list reconstruction emits the real verb **plus at least one extra word**,
because a list needs a comma and therefore at least two alternatives. `up{d,x}ate`
cannot produce `update` alone; it produces `update upxate`. Whether the downstream CLI
tolerates the extra positional varies by tool and is not something the guard relies on
anywhere else, so this is a genuine gap — but it is not the clean, exact-argv
reconstruction that the range form gives.

Contrast the three-field range form found in the same review, which IS exact:
`gh pr me{r..r..2}ge 42` → `gh pr merge 42`, nothing extra. That one was fixed inside
PR #967 because it is an unenumerated spelling of the range grammar #967 introduces.
This one is a different mechanism and belongs on its own axis.

A nested variant compounds it and should be covered by the same work:
`echo up{d,{a..z}}ate` → 26 words, the FIRST of which is literally `update`.

## Acceptance Criteria

- [x] `_OUT_BR_LIST_TOKEN` (or equivalent) models `\{[^{}]*,[^{}]*\}` in the same
      command-position-anchored, per-occurrence, quote-aware way the range token is
      modelled — braces INSIDE quotes must not count (`"up{d,x}ate"` is literal to
      bash), braces outside quotes must.
      — Implemented verbatim in shape to `_OUT_BR_RANGE_TOKEN`/`_OUT_BR_RANGE_ALREADY_HANDLED`,
      including the anchored + per-occurrence exclusion discipline the RANGE block needed
      two review rounds to reach — applied from the start here and confirmed by both review
      rounds' own decoy/co-occurrence construct-and-run probes. Quote-awareness confirmed both
      ways: fully-quoted stays ALLOW, partially-quoted still DENIES (regression-pinned).
- [x] The five constructions in the table above flip to DENY, and
      `mkdir -p /tmp/x/{a,b}` plus other benign list uses stay ALLOW.
      — The three DENY-shaped rows in the table (eas/gh/npm) all flip to DENY, plus 4 more
      families (railway, gh api, gh comment, eas build) via the same corpus axis — 7 families
      total, matching the RANGE block's own coverage. The table itself lists 3 DENY rows + 1
      ALLOW control (4 rows), not 5 — likely an editing artifact; the executor implemented the
      superset (all 7 gated families) rather than reconciling the count. `mkdir -p /tmp/x/{a,b}`,
      `cp f{,.bak}`, and `find -exec {} +` all confirmed ALLOW.
- [x] The nested `up{d,{a..z}}ate` form is covered or explicitly named as a residual.
      — Named as a documented, measured residual (precise-path only; all three degraded paths
      deny it via a pre-existing side effect). Round-1 review found the residual class is
      broader than one example (a LIST nested inside a LIST, not just a RANGE nested inside a
      LIST) — generalized in the DOCUMENTED RESIDUALS prose and given its own corpus axis
      (`r4brlist-nested-list-*`) and test pin in round 2.
- [x] Corpus rows generated for the new axis, following the `r4brange-*` convention,
      with the false-positive ALLOW controls the axis convention requires.
      — `r4brlist` added to `R4_RSP_IDS`, generating verb/tool rows the same way as
      `r4brange`/`r4ansic`; `r4brlist-nested-*` and `r4brlist-nested-list-*` added as dedicated
      residual axes. FP controls live in `test-guard-outward-cli.sh`'s `assert_allow` pins,
      matching the pre-existing convention (the RANGE axis has no separate ALLOW-expect corpus
      rows either — FP coverage lives in the test file for this mechanism family).
- [x] Mutation-verified: deleting the new token from the alternation flips at least one
      new row DENY → ALLOW, measured, not asserted.
      — Two independent mutations on scratch copies (with `lib/` preserved so the precise path
      is genuinely exercised, not the no-lib fallback): neutering `_OUT_BR_LIST_TOKEN` flips the
      precise-path verdict on `eas up{d,x}ate --branch preview` / `gh pr me{r,r}ge 42` /
      `pnpm publish{1,3}` from DENY to ALLOW; separately removing only the new list alternative
      from `crude_smells_outward`'s alternation flips the no-jq degraded path's verdict on the
      same construction from DENY to ALLOW, with the pre-existing RANGE alternative left intact
      (proving the degraded-mirror addition is independently necessary). Both mutations
      independently re-verified by the round-1 reviewers too.
- [x] `test-guard-outward-cli.sh` and the corpus pins re-derived from a run, never
      hand-incremented.
      — `test-guard-outward-cli.sh`: 822/822 passing, `EXPECTED_TOTAL=822` re-derived from a
      real run. `repro-outward-cli-corpus.sh`: `rows=904 precise-path gaps=45 all-path gaps=300`,
      all manifests exact, all 768 deny reasons attributed — every `EXPECTED_*` pin and both
      membership heredocs (`EXPECTED_PRECISE_GAP_IDS`/`EXPECTED_ALLPATH_DIRTY_IDS`) re-derived
      from actual script output, never hand-typed.

## Implementation Notes

- The two existing range cores live at `guard-outward-cli.sh` around the
  `_OUT_BR_RANGE_TOKEN` definition and inside `crude_smells_outward`; a third copy sits
  in `_OUT_BR_RANGE_ALREADY_HANDLED`. Whatever shape the list token takes, check whether
  all three siblings need it — widening a shared matcher in one place and not its
  consumers is a failure this repo has codified.
- #967's quote-awareness is the model to copy: `"me{r..r}ge"` correctly allows while
  `m"e"{r..r}ge` correctly denies, matching real bash.

## Scope Contract

- **Mechanisms to use:** the existing command-position-anchored, per-occurrence token
  matching that `_OUT_BR_RANGE_TOKEN` already established — no new scanner.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`, `.claude/hooks/test-guard-outward-cli.sh`
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Widening a text gate is safe on every DENY-shaped read and a false GRANT at the one
  ALLOW-shaped read; `_OUT_BR_RANGE_ALREADY_HANDLED` is such a read. Check it explicitly.
- Benign `{a,b}` is extremely common in real shell usage (`mkdir -p x/{a,b}`,
  `cp f{,.bak}`), so a careless widening will over-deny ordinary commands. The
  command-position anchor is what keeps that from happening — do not drop it.

## Updates

### 2026-09-16

- Implemented, reviewed (2 rounds, code-reviewer + security-auditor round 1,
  code-reviewer round 2 — zero CRITICALs either round), and archived. See the
  checked Acceptance Criteria above for what was verified and how. Concurrency
  note: PR #980 was open concurrently, editing the same three `.claude/hooks/`
  files — this PR may need a rebase once #980 lands.

### 2026-09-14

- Filed while adjudicating PR #967's review. Two of that review's four CRITICALs were
  refuted by measurement (the corpus and suite pins are correct and CI is green); the
  other two were confirmed by construction. This todo carries the half that is a
  separate mechanism; the increment-range half was fixed inside #967 itself.
