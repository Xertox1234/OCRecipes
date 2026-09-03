---
title: "DECISION: how should guard-outward-cli.sh treat a bash sigil that expands to nothing at a command-position boundary?"
status: backlog
priority: critical
created: 2026-09-02
updated: 2026-09-02
assignee:
labels: [security, harness, decision]
github_issue:
human_led: true
blocked_reason: "The two sides of this bypass have asymmetric cost, and that asymmetry IS the decision. The suffix side is a one-character class widening; the prefix side needs a NEW regex alternative, because bash consumes the whole balanced sigil and leaves no single boundary byte to match on. An unattended run would ship the cheap half, report the class closed, and produce exactly the overclaiming-by-implication defect the PR #910 repair chain existed to correct — a guard that looks fixed on the side people test. The PR #910 repair deliberately fixed NEITHER side for this reason and escalated instead. The bypass is CONFIRMED LIVE (constructed, executed, and control-verified on both sides, 2026-09-02), so this is an open hole awaiting a ruling, not a hypothetical."
---

# DECISION: empty-expansion sigils at a command-position boundary

## Summary

None of `_OUT_POS_SUFFIX`, `_OUT_POS_PREFIX`, or `_OUT_POS_SUFFIX_MERGE_CLAUSE` in
`.claude/hooks/guard-outward-cli.sh` treats a bash sigil that expands to the empty string as
a command-position boundary. An unset `$VAR`, an empty `$(...)`, or an empty `${...}` glued
to a gated verb produces a real invocation that is **silently ALLOWED**.

Fixing one side is cheap and fixing the other is not, which is why this is a decision rather
than a task.

## Background

Found 2026-09-02 by `security-auditor` during round 4 of the `GH_API_CLAUSE` repair chain on
PR #910. Independently reproduced and control-verified on both sides against the real hook,
per this repo's construct-and-run standard — every ALLOW recorded is the hook's actual exit
code, and each construction was confirmed bash-identical to its spaced form via a
PATH-stubbed binary printing its own argv. No real outward-facing CLI was executed.

Both of these are bash-identical to their spaced equivalents and both are silently ALLOWED:

- **suffix side** — the EAS update verb immediately followed by `$(true)`, then ` --branch preview`
- **prefix side** — an empty `$()` immediately preceding the command-position PR-merge invocation

The same shape works with an unset variable in place of the substitution.

### Why this is a decision and not a fix

- **Suffix side: one character.** The sigil leaves a byte at the boundary position that can
  be added to the existing closer class, exactly like the `{`/`}` widening PR #910 already
  landed.
- **Prefix side: not a class widening.** Bash consumes the *whole balanced sigil*, so there
  is no single boundary byte to match. Closing it needs a **new regex alternative** capable
  of absorbing a balanced construct — a different mechanism from everything else in the
  anchor pair.

The PR #910 repair fixed **neither**, deliberately. Its reasoning, which this todo inherits:
shipping only the cheap half would leave the guard *reporting* the class closed while the
prefix side stayed open — the overclaiming-by-implication defect that entire repair chain
existed to correct. That chain had already caught the same shape twice (a two-branch boundary
check fixed on one branch only, found by a later reviewer), so the concern is empirical, not
theoretical.

## The decision

**Option (a) — close both sides.** Widen the suffix closer class *and* add the new regex
alternative for the balanced-sigil prefix case.
*Cost:* the prefix alternative is new machinery in the most security-sensitive regex pair in
the file, with a false-positive surface that must be measured rather than estimated.

**Option (b) — close neither; document as a residual.** Record both sides in the guard's
`DOCUMENTED RESIDUALS` and close.
*Cost:* a trivially-constructed bypass stays open in the gate whose failure already caused a
real incident in this repo (`project_ota_accidental_publish_2026_08_16`).

**Option (c) — close the suffix side only, and say so explicitly.** Cheapest real reduction
in exposure.
*Cost:* only acceptable if the prefix side is documented as still open **in the same change**,
in all three places that currently describe this gap. Silent half-fixes are what this todo
exists to prevent — if (c) is chosen, the explicitness is the deliverable, not an afterthought.

## Acceptance Criteria

- [ ] A human rules between (a), (b), and (c), with the rationale recorded here in their own
      words — not an agent's paraphrase.
- [ ] Both sides are **reproduced first** against unmodified `main` before any fix: construct
      each input, run the hook, record its actual exit code. If either does not reproduce,
      that is a finding — report it rather than fixing something that is not broken.
- [ ] If (a) or (c): every change carries a **two-sided, mutation-tested** regression test —
      revert/stub the fix, confirm the assertion FAILS, restore, confirm it passes. Quote
      before/after counts with the corpus that produced them.
- [ ] If (a) or (c): the **false-positive population is measured by execution**, not
      estimated. A "decline to act" branch is only safe for inputs the OLD code did not act
      on — run the old code to learn that set. This repo previously lost 144 real denies to
      one unverified claim of exactly this shape.
- [ ] Whichever arm: all three existing disclosure sites are updated to match reality —
      PR #910's body (gap #6), the `round 4` section of
      `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`,
      and `guard-outward-cli.sh`'s own header comment. Append/amend, never silently delete a
      prior claim.
- [ ] Zero follow-ups.

## Implementation Notes

- **Do not let an agent settle this autonomously.** `human_led: true` is set deliberately.
  The cheap half is genuinely tempting and genuinely wrong on its own; an unattended run
  optimising for a closed checkbox will take it.
- If (a): the prefix alternative must absorb a *balanced* construct. Note that the sibling
  P1 work (`todos/archive/P1-2026-08-17-quoted-command-substitution-inert.md`) already landed
  a stack-based recursive extractor (`cmd_extract_substitutions`) for balanced-substitution
  scanning — check whether it can be reused before writing a second balanced-construct
  matcher. A second hand-rolled copy diverging from the shared one is precisely how
  `GH_API_CLAUSE` came to be missed.
- Corpus must be **generated from dimensions** (sigil form x empty/non-empty x side x verb
  family x precise/no-`jq` path), not hand-listed. A cross product picks one value per axis,
  so a guard firing only on CO-OCCURRENCE goes unreached and passes by agreeing.
- Check the **no-`jq` degraded path** explicitly. A sibling finding in this same wave
  (`todos/P0-2026-09-02-outward-cli-guard-command-position-expansion-decision.md`) showed
  `crude_smells_outward()` failing open for a related expansion mechanism, against its own
  fail-closed contract. Do not assume the fallback covers this one.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH`; shadow a binary
  rather than stripping `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive
  (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`), and `ALLOW_OUTWARD_CLI=1`
  clears only the single check that fired. Expect to need a write path that does not route
  the content through a shell command string.

## Scope Contract

- **Mechanisms to use:** widen the existing suffix closer class, and/or add one new regex
  alternative for the balanced-sigil prefix case — preferring reuse of the existing
  `cmd_extract_substitutions` balanced scanner over a second hand-rolled matcher. Never
  evaluate the expansion.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, this todo file, and the three disclosure sites
  named in the Acceptance Criteria.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Shares both primary files with
  `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`. That todo is
  explicitly instructed NOT to touch the empty-expansion case, so the two can proceed
  independently — but coordinate merge order if they run close together.
- PR #910 must land first; it is the source of the disclosure text this todo must keep
  accurate.

## Risks

- **Half-fixing is the specific risk this todo exists to prevent.** Option (c) is legitimate
  when chosen deliberately and documented; it is a defect when it happens by drift.
- **Drifting into (b) by inaction** leaves a confirmed live bypass open. Option (b) is a
  legitimate ruling; not deciding is not.
- The prefix alternative touches the most security-sensitive regex pair in the file. Give it
  the largest corpus and the most adversarial review.

## Updates

### 2026-09-02

- Split out of `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md` at
  the user's request, on the grounds that the prefix side needs a new mechanism rather than a
  class widening and therefore deserves the same `human_led` treatment as the
  command-position expansion decision.
- Source: round 4 of the PR #910 `GH_API_CLAUSE` repair chain (`security-auditor`), which
  reproduced and control-verified both sides and deliberately fixed neither.
- Reproduction fixtures lived in a session scratchpad and are NOT durable — regenerate from
  the two constructions described above.
