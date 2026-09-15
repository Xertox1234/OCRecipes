---
title: "guard-outward-cli.sh: brace LIST expansion {a,b} reconstructs a gated verb and is not modelled at all"
status: backlog
priority: medium
created: 2026-09-14
updated: 2026-09-14
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

- [ ] `_OUT_BR_LIST_TOKEN` (or equivalent) models `\{[^{}]*,[^{}]*\}` in the same
      command-position-anchored, per-occurrence, quote-aware way the range token is
      modelled — braces INSIDE quotes must not count (`"up{d,x}ate"` is literal to
      bash), braces outside quotes must.
- [ ] The five constructions in the table above flip to DENY, and
      `mkdir -p /tmp/x/{a,b}` plus other benign list uses stay ALLOW.
- [ ] The nested `up{d,{a..z}}ate` form is covered or explicitly named as a residual.
- [ ] Corpus rows generated for the new axis, following the `r4brange-*` convention,
      with the false-positive ALLOW controls the axis convention requires.
- [ ] Mutation-verified: deleting the new token from the alternation flips at least one
      new row DENY → ALLOW, measured, not asserted.
- [ ] `test-guard-outward-cli.sh` and the corpus pins re-derived from a run, never
      hand-incremented.

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

### 2026-09-14

- Filed while adjudicating PR #967's review. Two of that review's four CRITICALs were
  refuted by measurement (the corpus and suite pins are correct and CI is green); the
  other two were confirmed by construction. This todo carries the half that is a
  separate mechanism; the increment-range half was fixed inside #967 itself.
