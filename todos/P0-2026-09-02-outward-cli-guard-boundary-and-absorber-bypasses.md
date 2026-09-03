---
title: "guard-outward-cli.sh: four confirmed live bypasses from boundary-class and redirect-absorber gaps"
status: backlog
priority: critical
created: 2026-09-02
updated: 2026-09-02
assignee:
labels: [security, harness]
github_issue:
---

# Four confirmed live bypasses of the outward-CLI guard, all boundary/absorber gaps

## Summary

`.claude/hooks/guard-outward-cli.sh` silently **ALLOWS** real invocations of gated
outward-facing CLIs through four distinct static-text gaps. All four were constructed and
executed against the live hook on `main` during the PR #910 review wave (2026-09-02); none
is hypothetical, and none appears in the guard's own `DOCUMENTED RESIDUALS` section.

The four share one fix shape — widen a boundary character class, or absorb a redirect — so
they belong in one pass. The structurally different fifth finding (verb synthesis via
expansion) is deliberately **not** here; it needs a scope decision and lives in
`todos/P0-2026-09-02-outward-cli-guard-command-position-expansion-decision.md`.

> **Working on this todo trips the guard's own heredoc-prose false positive**
> (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`). Merely *writing this
> file* was denied twice — once by the PR-merge check and once by the cross-repo `--repo`
> check — because the reproduction strings appear in its text. `ALLOW_OUTWARD_CLI=1`
> bypasses only the single check that fired, so a body containing several trigger shapes
> needs a write path that does not route the content through a shell command string at all.
> Expect this when quoting these constructions in commits, PR bodies, or heredocs.

## Background

`guard-outward-cli.sh` is the PreToolUse gate that stops an agent invoking outward-facing
CLIs unattended. This repo has a real incident on record from exactly this class — an
accidental OTA publish caused by an agent executing a PATH-resolved outward-facing CLI
(`project_ota_accidental_publish_2026_08_16`). A silent ALLOW here is therefore treated as
critical, not theoretical.

All findings below meet this repo's construct-and-run standard: every ALLOW/DENY quoted is
the hook's actual exit code (JSON built with `jq -nc --arg`, piped to the hook exactly as
`test-guard-outward-cli.sh`'s own `run_hook` does), and every "real argv" claim was
ground-truthed via a PATH-stubbed binary printing its own argv. No real outward-facing CLI
was ever executed.

### C1 (CRITICAL) — default-value expansion defeats every boundary-guarded flag check

The boundary regex `(^|[^-A-Za-z0-9])--flag` requires the character immediately preceding
the flag text to be non-dash/letter/digit. Bash's **default-value** operators (`:-` and bare
`-`) consume exactly one `-` from the source and leave the rest of the word as the
expansion. So `${x:---admin}` places a literal `-` immediately before a real, two-dash
`--admin` in the raw command string — defeating the boundary check while argv genuinely
carries `--admin`.

The defect is specific to the default-value operator family. `${x:+--admin}` and
`${x:=--admin}` correctly DENY, because `+` and `=` pass the boundary class. That contrast
isolates the root cause rather than leaving it a regex-reading guess.

Verified matrix (all run against the real hook; `PRMERGE` = the command-position PR-merge
invocation, `EASBUILD` = the EAS build invocation, written as placeholders here only so this
file can be handled by tooling that inspects command strings):

| construction | real argv (verified via stub) | hook |
| --- | --- | --- |
| `PRMERGE 42 --auto --admin` (baseline, literal) | `--admin` present | DENY |
| `PRMERGE 42 --auto ${x:---admin}` (x unset) | `--admin` present | **ALLOW** |
| `PRMERGE 42 --auto ${x---admin}` (no-colon form) | `--admin` present | **ALLOW** |
| `PRMERGE 42 --auto ${x:+--admin}` (x set) | `--admin` present | DENY |
| `PRMERGE 42 --auto ${x:=--admin}` | `--admin` present | DENY |
| `EASBUILD ${x:---auto-submit}` | `--auto-submit` present | **ALLOW** |
| `PRCOMMENT 5 --body hi ${x:---repo} other/org` | `--repo other/org` present | **ALLOW** |

Impact: a real administrator-override merge (bypasses branch-protection required checks —
the exact thing the carve-out near `guard-outward-cli.sh:82` exists to prevent), a real
app-store submission, and a real cross-repo `--repo` egress with the PAT all receive a
silent ALLOW.

Control: the literal three-dash form (no expansion) produces a *different* argv token and is
not itself a bypass — confirming this is an expansion-driven defeat, not a misread regex.

### C2 (CRITICAL) — default-value expansion on a flag's VALUE defeats the method check

`gh api repos/o/r -X ${x:-POST}` (x unset) yields real argv `[-X, POST]`. The literal `-X`
is present and correctly located, but the mutating-method check requires the literal string
`POST`/`PUT`/`PATCH`/`DELETE` immediately after it, and the expansion is not that literal
text. Result: **ALLOW**, versus a correct DENY for the spaced literal `-X POST`.

### A (HIGH) — `_OUT_POS_SUFFIX` lacks `<` and `>` as closers

Redirect operators tokenize regardless of adjacent whitespace, so a verb glued directly to a
trailing redirect is a genuine invocation the suffix class does not close. Silent **ALLOW**
at all five `_OUT_POS_SUFFIX`-gated verb families: the PR-merge, EAS update, npm publish,
railway up, and EAS build `--auto-submit` forms, each with the redirect glued directly to
the verb with no intervening space (e.g. the update verb immediately followed by
`>/dev/null`, or the merge verb immediately followed by `</dev/null`).

The spaced form correctly DENIES — the gap is specifically the no-space glue.

### B (HIGH) — `_OUT_POS_PREFIX` lacks the shared lib's `_CMD_REDIR` absorption

A leading redirect before the verb is not absorbed, so the position anchor never matches.
Silent **ALLOW** at all five sites — each of the same five verb families prefixed with
`2>/dev/null ` or `>/dev/null `.

### Verified NON-findings (do not re-investigate)

Constructed, executed, and confirmed **correctly denied** — recorded so this ground is not
re-covered: ANSI-C quoting, locale quoting, backslash-newline continuation mid-verb, and tab
separators (the literal substring survives `cmd_bare` / `cmd_words` normalisation).
Vertical-tab control bytes are **not** default-IFS separators — a verb split by them
collapses into a single non-existent command name, so that dimension yields no exploitable
construction at all, independent of the guard.

## Acceptance Criteria

- [ ] Each of C1, C2, A, B is **reproduced first** against unmodified `main` — construct the
      input, run the hook, record its actual exit code. If any does not reproduce, that is a
      finding: report it instead of fixing something that is not broken.
- [ ] C1 fixed: the boundary class no longer treats a `-` contributed by a default-value
      expansion operator as a legitimate preceding character, for every `scan_both`
      boundary-guarded flag check — not only the administrator-override one.
- [ ] C2 fixed: the `gh api` method check is not defeated by an expansion standing in for
      the literal method token.
- [ ] A fixed: `_OUT_POS_SUFFIX` closes on `<` and `>`.
- [ ] B fixed: `_OUT_POS_PREFIX` absorbs a leading redirect, matching the shared lib's
      `_CMD_REDIR` handling.
- [ ] Every fix carries a **two-sided** regression test in
      `.claude/hooks/test-guard-outward-cli.sh`: a positive that fails without the fix, and a
      negative control that would catch over-matching. A control that stays green under
      mutation is not a control.
- [ ] **Mutation-tested**: for each new assertion, revert/stub its fix, confirm the assertion
      FAILS, restore, confirm it passes. Quote before/after counts with the corpus.
- [ ] **False-positive direction checked by execution**: a "decline to act" branch is only
      safe for inputs the OLD code did not act on — run the old code to learn that set.
      Confirm everyday idioms stay allowed, at minimum `mkdir -p dir/{a,b,c}`,
      `cp file.txt{,.bak}`, `eslint --fix 'client/src/*.{ts,tsx}'`, `for i in {1..3}`, and
      ordinary redirect use that does not front a gated verb.
- [ ] Full `.claude/hooks/test-guard-outward-cli.sh` and `scripts/run-hook-tests.sh` pass;
      real counts quoted.
- [ ] The guard's `DOCUMENTED RESIDUALS` section reflects what is now closed and what
      remains — append/amend, never silently delete a prior claim.

## Implementation Notes

- Fix **C1 first** — highest impact, most contained. The isolation work is already done:
  `:+` and `:=` pass the boundary class and correctly deny, so the fix targets the
  default-value operator family specifically.
- A and B are the smallest changes and should reuse the shared lib's existing `_CMD_REDIR`
  construct rather than a second hand-rolled redirect pattern. A hand-rolled copy diverging
  from the shared one is exactly how `GH_API_CLAUSE` came to be missed.
- **Widen the detector AND its consumers in the same change.** PR #910 widened
  `_OUT_POS_SUFFIX` but left `GH_API_CLAUSE`'s hardcoded-space cut behind, so the occurrence
  counter entered the branch while clause extraction returned empty and the deny never
  fired — this repo's own
  `docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`
  pattern. Enumerate every consumer of any class you widen.
- Corpus must be **generated from dimensions** (verb family x glue mechanism x flag
  sub-check x precise/no-jq path), not hand-listed. A cross product picks one value per axis,
  so a guard firing only on CO-OCCURRENCE goes unreached and passes by agreeing — construct
  co-occurrence cases deliberately.
- Check the **degraded paths too**. These four were not separately confirmed against the
  fail-closed fallbacks, and the sibling expansion finding showed the no-`jq` path can fail
  open for a related mechanism. Do not assume the fallbacks cover you.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH`; shadow a binary
  rather than stripping `PATH`.

## Scope Contract

- **Mechanisms to use:** widen existing boundary character classes; reuse the shared lib's
  existing `_CMD_REDIR` absorber. No new parsing layer, no expansion evaluation, no new
  dependency.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, and `.claude/hooks/lib/cmd-detect.sh` only if
  the shared absorber genuinely needs to change.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Coordinate with PR #910 and its `GH_API_CLAUSE` repair — both touch
  `guard-outward-cli.sh` and `test-guard-outward-cli.sh`. Land #910 first, then rebase.
- Independent of the command-position expansion decision todo; that one is structural and may
  never land.

## Risks

- **Over-denial is the real risk here, not under-denial.** Widening a boundary class can
  block legitimate commands. This repo has been burned: one unverified "the old code did not
  act on this" sentence cost 144 real denies. Run the old code to learn its acting set.
- C1's fix touches the shared boundary construct used by *every* flag check, so its blast
  radius is wider than the other three. Give it the largest corpus.

## Updates

### 2026-09-02

- Filed at the user's request after the PR #910 review wave. C1/C2 found by
  `security-auditor`; A/B originally surfaced by the `cmd-pos-anchor-widening-stale-comments`
  executor and independently reproduced by `security-auditor` against current `main`.
- Audit corpus: ~80 constructed variants executed end-to-end against the real hook on both
  `main` and the PR branch. Reproduction fixtures (guard copies with correct relative `lib/`
  layout, plus argv-printing stubs) lived in a session scratchpad and are NOT durable —
  regenerate them from the constructions described above.


## Additional findings (added 2026-09-02, after this todo was first written)

### Split out: the vanishing-sigil gap is NOT in this todo

A sixth bypass — a bash sigil that expands to nothing (unset `$VAR`, empty `$(...)` or
`${...}`) not being treated as a command-position boundary — was found during the
`GH_API_CLAUSE` repair on PR #910, after this todo was first written. It looked like a
sibling of A and B, but it is not: the suffix side is a one-character class widening, while
the prefix side needs a **new regex alternative** (bash consumes the whole balanced sigil, so
there is no single boundary byte to add). That asymmetry makes it a scope decision rather
than a mechanical fix.

It now lives in
`todos/P0-2026-09-02-outward-cli-guard-vanishing-sigil-boundary-decision.md` (`human_led`).

**Do not fix the suffix side as part of this todo.** Shipping the cheap half alone would
produce exactly the overclaiming-by-implication defect the PR #910 repair chain existed to
correct — a guard that looks closed on the side people test. If your work here touches
`_OUT_POS_SUFFIX`, leave the empty-expansion case alone and let the decision todo own both
sides.

### Severity note on finding A, strengthened 2026-09-02

Round 3 of the PR #910 repair re-verified finding A (`_OUT_POS_SUFFIX` missing `<`/`>`) and
found it is worse than first recorded: against the merge clause specifically it is a **total
detection failure**, not a partial gap. Treat A as CRITICAL rather than HIGH when sequencing
this work.

### Two more live bypasses were found and ALREADY FIXED on PR #910 — do not re-file them

Recorded here only so a future reader does not mistake them for open items:

1. A swallowing clause-cut in the `gh pr merge --auto` carve-out produced a working FALSE
   ALLOW in the zero-argument case (found and fixed in round 3 of the repair).
2. That round-3 fix was itself **incomplete** — the argument-present case reopened the
   identical swallow for `)` and backtick (live bypasses) and for `{`/`}` (conservative, not
   live). Fixed in round 5 by widening branch 1 to match branch 2's boundary set exactly,
   after a full 16-shape `{zero-arg, arg-present} x {;, &, |, ), backtick, {, }, EOS}` sweep
   before and after. Mutation: 268/268 → 264 passed/4 failed on revert (exactly the 4 new
   assertions) → restored to 268/268.

The lesson worth carrying into this todo's own work: **a fix to one branch of a two-branch
boundary check must be applied to both branches in the same change.** Round 3 fixed one and
left the other, and round 5 had to find it. That is the same
`occurrence-ambiguity-guard-applied-selectively-not-uniformly` shape already cited in the
Implementation Notes above — it recurred twice inside a single repair chain.
