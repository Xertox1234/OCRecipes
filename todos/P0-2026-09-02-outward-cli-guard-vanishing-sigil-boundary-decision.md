---
title: "DECISION: how should guard-outward-cli.sh treat a bash sigil that expands to nothing at a command-position boundary?"
status: backlog
priority: critical
created: 2026-09-02
updated: 2026-09-03
assignee:
labels: [security, harness, decision]
github_issue:
---

# DECISION: empty-expansion sigils at a command-position boundary

**RULED 2026-09-03 — option (a), CLOSE ALL THREE POSITIONS** (suffix, prefix, and the mid-token case added the same day). The `human_led` gate is lifted and this todo is implementable. Full ruling at the bottom of this file.

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
- **Prefix side: not a class widening.** Bash consumes the _whole balanced sigil_, so there
  is no single boundary byte to match. Closing it needs a **new regex alternative** capable
  of absorbing a balanced construct — a different mechanism from everything else in the
  anchor pair.

The PR #910 repair fixed **neither**, deliberately. Its reasoning, which this todo inherits:
shipping only the cheap half would leave the guard _reporting_ the class closed while the
prefix side stayed open — the overclaiming-by-implication defect that entire repair chain
existed to correct. That chain had already caught the same shape twice (a two-branch boundary
check fixed on one branch only, found by a later reviewer), so the concern is empirical, not
theoretical.

## The decision

**Option (a) — close both sides.** Widen the suffix closer class _and_ add the new regex
alternative for the balanced-sigil prefix case.
_Cost:_ the prefix alternative is new machinery in the most security-sensitive regex pair in
the file, with a false-positive surface that must be measured rather than estimated.

**Option (b) — close neither; document as a residual.** Record both sides in the guard's
`DOCUMENTED RESIDUALS` and close.
_Cost:_ a trivially-constructed bypass stays open in the gate whose failure already caused a
real incident in this repo (`project_ota_accidental_publish_2026_08_16`).

**Option (c) — close the suffix side only, and say so explicitly.** Cheapest real reduction
in exposure.
_Cost:_ only acceptable if the prefix side is documented as still open **in the same change**,
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
- If (a): the prefix alternative must absorb a _balanced_ construct. Note that the sibling
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

### 2026-09-03 — a THIRD position: the sigil can vanish MID-TOKEN, not only at a boundary

Found while integrating the hook-cluster PRs (#906/#907/#909/#910/#912) on a throwaway
merge branch, checking whether PR #907's shared fast-path filter could bypass PR #912's
widened detection. It cannot — but the probe surfaced a shape this todo's framing does not
currently cover.

Both sides described above put the vanishing sigil at a command-position **boundary**
(before or after the verb). It can also sit **inside the verb token**, splitting it:

```
gh pr me``rge 42          # empty backtick pair
gh pr me$()rge 42         # empty command substitution
gh pr me${UNSET}rge 42    # unset parameter
```

**Bash collapses all three to the single word `merge`** — verified by execution on
2026-09-03 with a harmless verb (no outward CLI involved), including argv proof:

```
$ eval 'set -- me``rge 42; printf "argc=%s argv1=[%s] argv2=[%s]\n" "$#" "$1" "$2"'
argc=2 argv1=[merge] argv2=[42]
```

So these are real, executing invocations. Against the hook they are **silently ALLOWED**.

**This is PRE-EXISTING, not introduced by the hook-cluster work** — the novelty was checked
rather than assumed, per this repo's standard. The same inputs were run against `main`'s
unmodified `guard-outward-cli.sh` and against the fully-integrated tree:

| input                      | main  | integration (909+912+910+906+907) |
| -------------------------- | ----- | --------------------------------- |
| `gh pr me``rge 42`         | ALLOW | ALLOW                             |
| `gh pr me$()rge 42`        | ALLOW | ALLOW                             |
| `gh pr merge 42` (control) | DENY  | DENY                              |

It is also **not** the fast-path filter's fault, which matters for whoever takes this on:
`cmd_words` leaves the sigil characters in place, so the precise matcher misses these too.
Widening `lib/fastpath-filter.sh`'s stage-2 strip set alone would change nothing.

**Why it belongs in THIS todo rather than a new one.** Same mechanism (a construct that
expands to nothing is invisible to a static text scanner), same three sigil forms, same
decision. It does, however, **widen the decision's scope**, and the ruling should say which
positions it covers:

- Option (a) as written closes the two boundary positions only. Mid-token would remain open
  and — given this todo exists specifically to prevent a half-fix being reported as a closed
  class — that must be stated explicitly in the same change, not discovered later.
- Mid-token is closer in cost to the **prefix** side than the suffix side: there is no
  boundary byte to add to a character class, so it needs the balanced-construct handling
  (`cmd_extract_substitutions`) the Implementation Notes already point at. The unset-variable
  form (`${UNSET}`) is a further case that a substitution-only scanner will not catch.

None of this changes the recommendation to keep the todo `human_led`; it enlarges what the
human is ruling on. The three reproductions above are durable — they are written out here
in full precisely because the earlier fixtures were not.

## RULING (2026-09-03) — option (a), CLOSE ALL THREE POSITIONS

The repository owner ruled in favour of **option (a), close every position** — the suffix
side, the prefix side, and the mid-token side documented in the 2026-09-03 addendum above.
The `human_led: true` gate and its `blocked_reason` are lifted; this todo is now
implementable.

**Recording the rationale honestly:** the ruling was made by selecting option (a) as
presented (extended to cover the third, mid-token position), not by writing separate prose.
The rationale is option (a)'s own text as it stood above. This note exists so a later reader
does not mistake an agent's paraphrase for the owner's words.

This is the strictest of the three arms, and it directly resolves the concern that made this
todo `human_led` in the first place: there is now no half-fix to drift into, because
"suffix only" was explicitly not chosen.

### Scope of the ruling — THREE positions, not two

The todo's original framing had two. The addendum above adds the third, and the ruling
covers all of it:

1. **suffix** — a one-character closer-class widening, same shape as the `{`/`}` fix
   PR #910 already landed.
2. **prefix** — bash consumes the whole balanced sigil, so there is no single boundary byte
   to add; needs a balanced-construct alternative.
3. **mid-token** — the sigil splits the verb itself (`me` + vanishing sigil + `rge`
   collapsing to `merge`, argv-proven 2026-09-03). Same mechanism as the prefix side, and
   it is NOT covered by widening a boundary character class.

### Two things the implementer must not assume

- **Reuse the existing balanced scanner before writing a second one.** The sibling P1 work
  (merged as PR #912) already landed a stack-based recursive extractor,
  `cmd_extract_substitutions`, in `.claude/hooks/lib/cmd-detect.sh`. A second hand-rolled
  balanced matcher diverging from the shared one is precisely how `GH_API_CLAUSE` came to be
  missed. Check reuse first, and say why if it does not fit.
- **A substitution-only scanner does NOT close the unset-variable form.** `${UNSET}` is not
  a command substitution and `cmd_extract_substitutions` will not see it. It vanishes just
  as completely — confirmed by execution — so the corpus must carry it as its own axis, and
  a fix that only handles `$(...)`/backticks closes two of the three sigil forms while
  reporting the class closed. That is the exact defect this todo exists to prevent, one
  level down.

The Acceptance Criteria above still bind in full: reproduce first against unmodified `main`,
two-sided mutation tests, false-positive population measured by execution rather than
estimated, and all three disclosure sites updated to match reality.

### Sequencing note

See the matching note in
`todos/P0-2026-09-02-outward-cli-guard-command-position-expansion-decision.md` (ruled the
same day, option (c) narrow deny). Both change `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX`; do not
run them as two independent unattended jobs against the same regex pair.
