---
title: "guard-outward-cli.sh: a SPACE-separated redirect target named --auto forges the merge carve-out, allowing an immediate merge"
status: done
priority: critical
created: 2026-09-07
updated: 2026-09-12
assignee:
labels: [security, harness]
github_issue:
---

# A redirect target spelled `--auto` grants the carve-out it is not

## Summary

`gh pr merge 42 > --auto` is ALLOWED. Real argv is `gh pr merge 42` — **no `--auto` reaches
gh at all** — so the PR merges IMMEDIATELY, which is the exact thing the `--auto` carve-out
exists to prevent. The `--auto` token the guard reads is the redirect's _filename_.

## Background

Found 2026-09-07 while closing the interior-redirect P0 (PR for
`P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family`). **Pre-existing and
unchanged by that fix** — measured identical on `main` and on the fix branch. Surfaced rather
than folded in, because it is a different mechanism from that todo's scope contract (which
authorised exactly one interior separator absorber).

The mechanism is the `--auto` field scan at `guard-outward-cli.sh`'s
`HAS_REAL_AUTO` assignment:

```
HAS_REAL_AUTO=$(awk -v flags="$GH_MERGE_VALUE_FLAGS" '
  { prev = ""
    for (i = 1; i <= NF; i++) {
      if ($i == "--auto" && prev !~ flags) { print "yes"; exit }
      prev = $i } }' <<< "$CLAUSE")
```

awk splits `$CLAUSE` on WHITESPACE. It has no notion that `<`/`>` are token boundaries in
bash. With a space before the operator, `>` and `--auto` become two separate awk fields, the
`--auto` field compares equal, `prev` is `>` (not in `GH_MERGE_VALUE_FLAGS`), and the
carve-out is granted.

This is the CANDIDATE IMPROVEMENT the file's own DOCUMENTED RESIDUALS block already names and
explicitly declines, in the finding-A ACCEPTED OVER-DENIAL entry: _"teach the `--auto` field
scan itself to treat `<`/`>` as token boundaries"_. That entry frames it as an over-denial
fix; this todo records that the same scan ALSO has an under-denial face, which the entry does
not mention.

### Measured, 2026-09-07

Ground truth by execution, PATH-shadowed argv-printing stubs writing to a sentinel FILE
(a stdout-reporting stub reads "not invoked" for every row — these constructions redirect
stdout). Decisions from the live hook via the standard `jq -cn --arg` envelope.

| construction              | real argv               | main  | fix branch |
| ------------------------- | ----------------------- | ----- | ---------- |
| `gh pr merge 42`          | `gh pr merge 42`        | DENY  | DENY       |
| `gh pr merge 42 > --auto` | `gh pr merge 42`        | ALLOW | ALLOW      |
| `gh pr merge 42 >--auto`  | `gh pr merge 42`        | DENY  | DENY       |
| `gh pr merge 42 --auto`   | `gh pr merge 42 --auto` | ALLOW | ALLOW      |

**The glued row is the attribution control.** `>--auto` glued makes ONE awk field, `>--auto`,
which is not equal to `--auto`, so the scan does not fire and the merge is correctly denied.
The only difference between the two failing/passing rows is the SPACE — which isolates the
defect to the field-splitting, not to anything else in the block.

### Three more REDIRECT spellings, and a second mechanism (added 2026-09-07, security review of PR #931)

Same harness, same day. All ALLOW on **both** trees, so none is a regression — and none was
listed anywhere before, which is the point: the table above varied the _position_ of one
operator and held the _operator_ fixed, so it could not see these.

| construction                          | real argv                           | main  | PR #931 |
| ------------------------------------- | ----------------------------------- | ----- | ------- |
| `gh pr merge 42 2> --auto`            | `gh pr merge 42`                    | ALLOW | ALLOW   |
| `gh pr merge 42 >> --auto`            | `gh pr merge 42`                    | ALLOW | ALLOW   |
| `> --auto gh pr merge 42`             | `gh pr merge 42`                    | ALLOW | ALLOW   |
| `gh pr merge 42 -b>x --auto`          | `gh pr merge 42 -b --auto`          | ALLOW | ALLOW   |
| `gh pr merge 42 --body-file>x --auto` | `gh pr merge 42 --body-file --auto` | ALLOW | ALLOW   |
| `gh pr merge 42 -t>x --auto`          | `gh pr merge 42 -t --auto`          | ALLOW | ALLOW   |

**The LEADING row needs its own fix and a fixer following this todo would not find it.**
`> --auto gh pr merge 42` forges through `_OUT_POS_PREFIX`'s absorber run, not through the
trailing clause — a different code path from every other row here.

**The last three are the SECOND mechanism, and this todo already predicted them.** The
"Implementation Notes" below say of `-b>x --auto`: _"Measure it."_ Measured: the `--auto`
is real and reaches gh, but bash gives it to `-b` as its VALUE, so no auto-merge flag
survives and the PR merges immediately. `GH_MERGE_VALUE_FLAGS` exists precisely to catch
this and fails because `prev` reads `-b>x`, which does not match `^-b$`.

So the awk scan is redirect-unaware in **both** directions — it reads a redirect target as a
flag, and it fails to read a flag that carries a glued redirect. One fix (teach the scan that
`<`/`>` are token boundaries) addresses both, and it is **grant-shaped**, which is why it was
deliberately kept out of PR #931: that PR already introduced one CRITICAL through a
grant-shaped read, and this change needs its own paired over-granting controls.

**Count correction:** the Acceptance Criteria below say this "would leave these three live".
There are at least **seven** live positions across two mechanisms. The three-row framing came
from enumerating one operator's positions rather than the operator × position grid.

### The forge also works at the INTERIOR slots (added 2026-09-07)

The table above varies only the TRAILING position. The `_OUT_SEP` interior absorber makes the
same forge reachable at the tool→namespace and namespace→verb slots, because the absorbed
redirect becomes part of the extracted CLAUSE and its target is a separate awk field:

| construction                       | real argv        | main  | with \_OUT_SEP |
| ---------------------------------- | ---------------- | ----- | -------------- |
| `gh > --auto pr merge 42`          | `gh pr merge 42` | ALLOW | ALLOW          |
| `gh pr > --auto merge 42`          | `gh pr merge 42` | ALLOW | ALLOW          |
| `gh > --auto pr > --auto merge 42` | `gh pr merge 42` | ALLOW | ALLOW          |

**Not a regression — the decision is unchanged on both trees, so no row was opened.** But the
MECHANISM differs, and that matters for whoever fixes this: on `main` these allow because the
detector never fires at all (the interior-redirect gap); with `_OUT_SEP` the detector fires
and they allow because the forged `--auto` GRANTS the carve-out. A fix that only teaches the
trailing position to treat `<`/`>` as token boundaries would leave these three live. Include
them in the acceptance criteria's mutation controls, not just the trailing row.

### Severity

`critical`. This is a silent ALLOW on an immediate, unarmed `gh pr merge` — the single
outcome the `--auto` carve-out is built to gate, and the carve-out's own stated premise
(branch protection still applies) does not save it, since an immediate merge of a
protection-satisfying PR is exactly what a reviewer expected not to happen unattended.

Honest qualifier, same as its sibling P0s: nobody writes `> --auto` by accident. It is filed
critical for effect, not for likelihood.

## Acceptance Criteria

- [ ] Reproduced first against unmodified `main` — construct each row, run the hook, record
      actual exit codes. If a row does not reproduce, report that rather than fixing
      something that is not broken.
- [ ] The `--auto` scan treats `<` and `>` as token boundaries, so a redirect target can
      never be read as a flag.
- [ ] **The CLAUSE is not truncated to achieve it.** The file already reverted one attempt to
      make `<`/`>` closers in `_OUT_POS_SUFFIX_MERGE_CLAUSE` branch 1, because truncating the
      clause hid a LATER `$`-bearing sigil from the unverifiability mask and silently allowed
      `gh pr merge 42 --auto >anyfile ${x:---admin}`. That regression test exists; it must
      stay green. Fix the SCAN, not the cut.
- [ ] Two-sided regression tests with reasons asserted, including the glued attribution
      control above (which must stay DENY for its own reason, not incidentally).
- [ ] Mutation-tested per row: stub the fix, confirm the named assertions FAIL, restore.
- [ ] False-positive population measured by execution over real command history, both
      directions, with the harness validated against a known flip.
- [ ] Check whether the sibling value-flag logic has the same blindness: `gh pr merge 42
-b>x --auto` reads `prev` as `-b>x`, which does not match `^-b$`, so the `--auto` is
      counted as real — while bash gives `-b` the `--auto` as its VALUE. Measure it; if it
      reproduces it belongs in this same fix, since it is the same field-splitting cause.

## Implementation Notes

- The scan is the ONE grant-shaped read in the file. Widening what it accepts turns denies
  into allows, unlike every other check here — so every change needs a paired control that
  would catch over-granting, not only under-granting.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH` writing to a
  sentinel FILE; shadow a binary rather than stripping `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive, and
  `ALLOW_OUTWARD_CLI=1` clears only the single check that fired. Use file tools, not shell
  command strings.

## Scope Contract

- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`,
  and the disclosure sites for any residual this closes or opens.
- No new parsing layer, no expansion evaluation, no new dependency.

## Resolution — 2026-09-12

**Fixed.** The `--auto` scan normalises its INPUT with the shared `_CMD_REDIR` before
splitting: `gsub(redir, " ", norm)` inside the existing awk. `$CLAUSE` is untouched, so the
`$`-sigil mask still reads the whole clause — "fix the SCAN, not the cut", per the
acceptance criteria. No new parsing layer, no new tool (the block already required awk).

Both faces closed, because both were the same cause. Reusing `_CMD_REDIR` rather than
re-deriving the grammar also picked up the five zsh families PR #939 added (`>|`, `>!`,
`{name}>`, `&` on either side) with no enumeration.

Scope decision: the user chose to fix the over-denial as well, not only the under-denial —
so the newly-granted set was enumerated by construction and each member paired with a
control proving the independent gates (`--admin`, `--repo`, the `$`-mask,
multi-occurrence) still deny.

**Count correction, again.** This file said "at least seven live positions". Measured: the
position axis (leading / tool→namespace / namespace→verb / trailing) crossed with six
operator spellings gives **24**, plus a co-occurrence row, plus 9 masked value-flag rows.
The seven came from listing one operator's positions — the same enumeration error this
todo already flagged once, repeated one level up. The corpus axis is now GENERATED, so the
cross product cannot be under-listed by hand again.

**Two things the acceptance criteria asked for that came back negative, recorded because a
negative result that is not written down gets re-derived:**

1. _"Check whether the sibling value-flag logic has the same blindness"_ — it did, and it is
   fixed by the same pass. But the wider sibling sweep found **no other whitespace-field
   splitter in the guard at all**: `:2342` is the only non-comment `awk`, and the file
   contains no `tr ' '`, `read -ra`, `IFS=`, or `for x in $VAR`. The family is one site.
   **Scope of that claim, tightened after a reviewer read it more broadly than it was
   meant:** it says there is no OTHER splitter in this file to fix. It says nothing about
   how many failure MODES the one splitter has — and round 2 then found a second mode in it
   (the fd-prefix erosion, below). "One site" and "one failure mode" are different counts,
   and the first does not bound the second.
   (`git-safety.sh:552` has the same blindness in a never-blocking advisor branch, and
   `git-safety.sh:425` has the separate `MUTATING_GIT_SEG_RE` gap — neither shares this
   code path; both stay out of scope.)
2. The join controls do **not** pin the space in `gsub(redir, " ", ...)`. Mutating it to
   `""` leaves the whole suite green. Fusion is impossible under either replacement because
   `_CMD_REDIR`'s target is mandatory and greedy, so a match always eats through to a
   boundary that blocks the join — measured over 18 deliberate fusion attempts. That is an
   EQUIVALENT mutant, and the first version of the guard comment asserted the opposite as
   if it were a proof. Corrected in place.

**Residual opened (not closed by this, and deliberately not pursued):** an `--auto` glued to
an operator carrying `&`/`|` (`--auto>&2`, `--auto>|log`) still over-denies — but the cause
is the CLAUSE CUT, not the scan. Branch 1 of `_OUT_POS_SUFFIX_MERGE_CLAUSE` stops at a
command separator, so the scan receives `gh pr merge 42 --auto>` and the bare `>` has no
target to match. Widening that cut is exactly the reverted 2026-09-05 CRITICAL. The SPACED
spellings allow, and the pair is pinned so the residual stays attributed to the cut.
Disclosed in the guard's DOCUMENTED RESIDUALS; deliberately NOT filed as a todo, because a
todo saying "make the clause read past a redirect" is an invitation to reintroduce a
CRITICAL.

### Review round 2 — the fix reintroduced the bug it closes, in the granting direction

Security review caught it, and the baseline reviewer independently caught its mirror image.
Both are one cause. `_CMD_REDIR` opens with an **optional fd prefix** (`[0-9]*` or `{name}`),
and a plain `gsub` let a match **open on a mid-word digit run**, eating characters off a real
argv word. Measured under bash 5.3.15, shadowing function reporting on a preserved fd (a
stdout stub reads "not invoked" — every one of these rows redirects fd 1):

| construction                  | real argv                      |
| ----------------------------- | ------------------------------ |
| `gh pr merge 42 --auto>x`     | `[pr][merge][42][--auto]`      |
| `gh pr merge 42 --auto2>x`    | `[pr][merge][42][--auto2]`     |
| `gh pr merge 42 --auto{fd}>x` | `[pr][merge][42][--auto{fd}]`  |
| `gh pr merge 42 -b2>x --auto` | `[pr][merge][42][-b2][--auto]` |

- **Under-denial (v1 introduced it):** `--auto2>x` has **no `--auto` in argv**, and v1
  normalised it to `--auto` and **GRANTED**. That is precisely the forgery this todo exists
  to close, recreated by its own fix, in the file's one read where a mistake becomes an
  ALLOW. v1 also _pinned it as correct_ — an `assert_allow` reading "is a real armed
  automerge" plus a corpus `ALLOW` row — so the false claim was about to become a required
  check.
- **Over-denial (the same erosion, other direction):** `-b2>x` is one word `-b2` (`-b` with
  the attached value `2`), so the later `--auto` reaches gh unmasked. v1 eroded it to `-b`,
  matched `GH_MERGE_VALUE_FLAGS`, and denied a real armed automerge.

Fixed by `strip_redirs()`: `_CMD_REDIR` still says **what** a redirect is; the function adds
only **where a match may open**, re-anchoring at the operator when the match began on a
mid-word fd prefix. That is a positional rule, deliberately not a second grammar.

**The lesson is the one this file keeps relearning, one level up.** The v1 safety argument
had two ends — a deletion can forge a flag by JOINING two words or by EATING characters off
one — and it argued only the join end, at length, with measurements. The defect was at the
unargued end. Writing the careful half is what made the missing half invisible.

**Also corrected:** the generated operator axis claimed to be "taken from `_CMD_REDIR`'s own
alternations" and listed six of ten. Widened to all ten (`<`, `>&`, `>!`, all-digit brace
body added) rather than softening the claim — this file's standing lesson is that a
completeness claim has been wrong every time it was made.

**Residual found in round 2, PRE-EXISTING and disclosed rather than fixed:**
`gh pr merge 42 --auto{fd}>x` ALLOWs on **both** trees. Branch 1 of
`_OUT_POS_SUFFIX_MERGE_CLAUSE` excludes `{`/`}`, so the clause truncates to
`gh pr merge 42 --auto` and the scan sees a clean `--auto`, while real argv is `--auto{fd}`.
A forged grant via the CUT, not the scan. Pinned as `fautobrace-pre` at what both trees do —
flipping it would claim a fix this change does not make.

**Evidence.** Test suite 596 → 636 assertions, 0 failed; full hook suite 34/34. Corpus
498 → 573 rows, 420 → 483 attributions, 187 → 220 all-path gaps; **precise-path gaps
unchanged at 31**, and **no pre-existing row moved** — every drift line the pin reported was
a new `fauto*`/`mauto*` id. Four mutations, each with a named expected outcome:

| mutation                                   | result                                           |
| ------------------------------------------ | ------------------------------------------------ |
| re-anchoring discarded (cut at `RSTART`)   | **7 red** — the digit rows, BOTH directions      |
| normalisation removed (`norm = $0`)        | **13 red** — forged + masked rows                |
| spaced-target support removed from `redir` | **8 red** — exactly the SPACED rows, glued green |
| `" "` → `""` replacement                   | **green — EQUIVALENT**, recorded, not chased     |

### False-positive population, measured by execution (AC item 6)

Flagged by the baseline reviewer as the one acceptance criterion the first Resolution
silently dropped — correctly, so it is recorded here in full rather than asserted.

Every distinct Bash command in local transcript history (**143,328**) was harvested and
filtered to **10,381**; each was replayed through the guard on `origin/main` and on this
branch and the decisions diffed per command. **Three known flips were injected into the
population** and the run fails if they do not flip — a harness that never ran prints the
same clean zero (`feedback_a_clean_zero_needs_its_denominator`).

**Population filter, stated because a filter is a completeness argument:** the only
non-comment edit is inside the `elif [ "${GH_PR_MERGE_OCCURRENCES:-0}" -eq 1 ]` branch, in
the `else` arm of the `$`-sigil mask, so a command can only change decision if
`GH_PR_MERGE_RE` matches — which needs the literal verb `merge` in the clause. `$CLAUSE` is
cut from plain `$WORDS`, so a verb split by a substitution never reaches the scan (empty
clause, unchanged decision either way); `$WORDS` deletes quote characters but not letters,
hence the quote-tolerant `m['"]*e['"]*r['"]*g['"]*e` spelling. Unioned with a plain `gh`
filter anyway, because a filter derived for one change is exactly what goes stale.

**Result — 4 differences in 10,384 rows:**

| direction  | command                                              | what it is         |
| ---------- | ---------------------------------------------------- | ------------------ |
| ALLOW→DENY | `gh pr merge 42 > --auto`                            | injected control ✓ |
| ALLOW→DENY | `gh pr merge 42 -b>x --auto`                         | injected control ✓ |
| DENY→ALLOW | `gh pr merge 42 --auto>/dev/null`                    | injected control ✓ |
| ALLOW→DENY | `  gh > --auto pr merge 42   and   gh pr > --auto …` | see below          |

All three controls flipped, so the zero is a measured zero. **Zero unexpected flips in
either direction over real command history.**

The fourth is not a user command: it is a line of this project's own PROSE about the forge,
harvested because it once appeared inside a Bash argument. It now denies — a new, minor
false positive on documentation text that names the construction, and the same class as
`todos/P2-2026-09-10-outward-cli-guard-denies-prose-naming-two-pr-verbs.md`. Recorded rather
than counted as a real-command regression, and it is the reason this todo's own
Implementation Notes say to build such text with file tools rather than a Bash argument.

**Honest bound:** a history harvest sizes FALSE POSITIVES only. Nobody types the decoy, so
no harvest contains it — reachability is bounded by the constructed adversarial rows above,
never by this number (`feedback_history_harvest_is_not_reachability_evidence`).
