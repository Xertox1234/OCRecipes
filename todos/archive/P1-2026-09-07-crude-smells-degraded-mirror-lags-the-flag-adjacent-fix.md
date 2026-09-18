---
title: "crude_smells_outward's degraded mirror still allows 6 measured flag-adjacent rows — and half of that is fixable without $_CMD_REDIR"
status: done
priority: high
created: 2026-09-07
updated: 2026-09-17
assignee:
labels: [security, harness]
github_issue:
---

# The fail-closed fallback does not close what the precise path now closes

## Summary

PR #931 closed the flag-adjacent redirect bypass on the **precise** execution path. The
**degraded** paths — `nojq`, `nolib`, `noawk`, which run `crude_smells_outward` instead of the
real detectors — still ALLOW **6 measured rows**, unchanged from `main`. Every one builds a real
gated argv, and two of them are OTA publishes to real users.

`crude_smells_outward` exists specifically to **fail closed** when the machinery is unavailable
(a missing `jq`, an unsourceable `lib/cmd-detect.sh`). A gap there is a hole in the fallback,
not in a nicety.

## Measured, 2026-09-07

From `repro-outward-cli-corpus.sh`'s `flagadj*` axis, run against `origin/main` (`a9d77417`)
and against the merged fix (`0ae5e0ab`). Identical on both — **not a regression, and not closed
either**:

| row                   | precise (main → now) | nojq  | nolib | noawk |
| --------------------- | -------------------- | ----- | ----- | ----- |
| `flagadjglue-npmlog`  | DENY → DENY          | ALLOW | ALLOW | ALLOW |
| `flagadjsp-npmlog`    | ALLOW → **DENY**     | ALLOW | ALLOW | ALLOW |
| `flagadjfd-npmlog`    | ALLOW → **DENY**     | ALLOW | ALLOW | ALLOW |
| `flagadjsp-yarncwd`   | ALLOW → **DENY**     | ALLOW | ALLOW | ALLOW |
| `flagadjfd-ghcomment` | ALLOW → **DENY**     | ALLOW | ALLOW | ALLOW |
| `flagadjfd-ghcreate`  | ALLOW → **DENY**     | ALLOW | ALLOW | ALLOW |

The `npmlog`/`yarncwd` rows are `npm run update:preview` / `yarn update:production` — the
2026-08-16 incident class. The `ghcomment`/`ghcreate` rows carry `--repo` to an arbitrary
repository with the user's PAT.

## Two distinct causes, and only one of them is genuinely blocked

**Cause A — the `[^;&|]*` clause bodies. NOT blocked, and this is the actionable half.**
`.claude/hooks/guard-outward-cli.sh:1248` and `:1313`:

```bash
grep -Eq '(^|[^a-zA-Z])(eas|railway|npm|pnpm|yarn|gh)[^;&|]*[$`]' <<< "$t" && return 0
grep -Eq 'gh[^a-zA-Z]+pr[^a-zA-Z]+(create|comment)[^;&|]*(--repo|-R)' <<< "$t" && return 0
```

These are the **same** `&`-truncation the precise path just fixed: `[^;&|]*` stops at the `&` of
an fd-duplicating redirect, so the `--repo` behind it is never reached. That is exactly why
`flagadjfd-ghcomment` and `flagadjfd-ghcreate` allow on all three degraded paths while their
`sp`/`glue` siblings now deny.

**Crucially this class is a LITERAL — it does not reference `$_CMD_REDIR`**, so the ordering trap
that blocks widening the _separator_ here does not apply. The precise-path sites are already
spelled `([^;&|]|&[0-9-]|&[<>]|[<>]&)*` (`:977`, `:2575`); the same substitution works here.

**Cause B — the `[^a-zA-Z]+` separator. Genuinely blocked, already disclosed.**
`crude_smells_outward` runs _before/without_ the lib source, so `$_CMD_REDIR` is unbound there
(a `set -u` abort, not an empty expansion — see the corrected comments). Its `[^a-zA-Z]+`
separator absorbs a letter-free redirect (`2>&1`) but not a letter-bearing one (`>/dev/null`,
where `dev` breaks the class), and it has no notion of the flag→value slot at all. This is the
residual the guard's DOCUMENTED RESIDUALS block already records. Closing it needs a different
approach — a guard-local literal redirect pattern defined above the lib source, which is a
second copy of `_CMD_REDIR` and therefore a lockstep-contract decision, not a one-liner.

## Acceptance Criteria

- [x] Reproduce all 6 rows against unmodified `main` first, per path. If a row does not
      reproduce, report that rather than fixing something that is not broken.
- [x] Cause A fixed: `:1248` and `:1313` admit the `&`-bearing redirect operators, matching the
      precise-path spelling. `flagadjfd-ghcomment` and `flagadjfd-ghcreate` go DENY on all
      three degraded paths.
- [x] A false-positive control proves the widening stayed narrow on the degraded paths too —
      a `--repo` belonging to a command after a real `&&` must NOT be absorbed.
- [x] Cause B either fixed with an explicit decision recorded about the duplicated redirect
      pattern, or left with its DOCUMENTED RESIDUALS entry **updated to name these specific
      rows** rather than the general asymmetry.
- [x] Corpus per-ID `comm` on the all-path axis: rows closed, **0 newly dirty**. Do not
      subtract totals.
- [x] `EXPECTED_TOTAL` and the corpus NOTE6 numbers updated in the same commit as the change
      that moves them.

## Implementation Notes

**Derive the admitted set from the grammar, not from the operator family in front of you.**
This is the third round of the same defect on this file. The first `&` admission was
`&[0-9-]` — correct for fd duplication (`2>&1`, `>&-`) and blind to the redirect-both operators
(`&>file`, `>&file`), whose `&` is followed by neither a digit nor `-`. The current spelling is
`&[0-9-]|&[<>]|[<>]&`; reuse it verbatim rather than re-deriving it.

**UNMEASURED, carried forward deliberately:** the appending redirect-both spelling (`&>>`) is a
syntax error under this machine's bash 3.2, so no argv could be produced for it. Under bash ≥ 4
it is valid and may be a fourth spelling on _both_ paths. Measure it on a bash ≥ 4 host before
claiming the class closed — claiming closure without running the members is precisely what
produced rounds two and three.

**A hand-spelled class is invisible to a constant sweep.** Grepping for `$_OUT_SEP` /
`$_CMD_REDIR` finds only the sites already converted; the ones carrying a written-out equivalent
are exactly the ones that lag. When auditing, enumerate _readers that decide from adjacent
tokens_, including the non-regex ones — the `awk` field comparison at `:2343` is a third such
reader and is tracked separately in
`todos/P0-2026-09-07-outward-cli-guard-space-separated-redirect-target-forges-auto.md`.

**The precise path is clean; do not re-fix it.** `:977` and `:2575` already carry the widened
body, and the structural anchor assertion in `test-guard-outward-cli.sh` pins it, so a silent
revert there trips a test.

Codified background:
`docs/solutions/logic-errors/a-slot-declined-on-semantics-was-never-measured-2026-09-07.md`.

### 2026-09-17 - CLOSED: cause A was already done, cause B is named rather than fixed

- **THE FIRST CRITERION SAVED THE WORK.** "Reproduce all 6 rows against unmodified `main` first.
  If a row does not reproduce, report that rather than fixing something that is not broken."
  Two of the six do not reproduce: `flagadjfd-ghcomment` and `flagadjfd-ghcreate` are absent
  from the per-path pin list in `repro-outward-cli-corpus.sh`, i.e. they now DENY on all three
  degraded paths. PR #939 closed them by widening the crude `--repo` mirror to the precise
  path's own redirect spelling — which is exactly what this todo's cause-A criterion asked for,
  landed before the todo was picked up. The corpus file says so in its own words at the
  165-vs-167 note. Had I gone straight to the named line numbers I would have "fixed" a clause
  that was already correct.

- **Cause A is therefore CLOSED**, and not by this change.

- **Cause B is named, not fixed**, which is the option the criterion allows. Four rows survive
  as DENY-on-precise / ALLOW-on-all-degraded, and they are now listed BY ID in the residual
  beside `_OUT_SEP` rather than described as a general asymmetry:
  `flagadjfd-npmlog`, `flagadjglue-npmlog`, `flagadjsp-npmlog`, `flagadjsp-yarncwd` — all the
  npm/yarn run-script clause reached through the `[^a-zA-Z]+` separator. A residual stated as a
  property is one nobody can check and one a later reader cannot tell has shrunk; this one
  shrank from six to four without anybody noticing, which is the argument for naming rows.

- Why cause B stays open: `crude_smells_outward` runs BEFORE/WITHOUT the lib source, so
  `$_CMD_REDIR` is unbound there and under `set -u` referencing it aborts the hook rather than
  expanding empty. Closing it needs a guard-local literal redirect pattern defined above the
  source — a second copy of a grammar this repo has repeatedly been burned by duplicating. That
  is a deliberate decision recorded here, not an oversight.

- The line numbers this todo cites (`:1248`, `:1313`) had drifted by hundreds of lines before it
  was picked up. Cite the symbol, not the offset.
