---
title: "A union over RENDERINGS does not cover selection WITHIN one — an unanchored cut gated by an anchored counter picked the decoy clause"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative, verification]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A check unions over every rendering/variant it knows about, the union rule is fully satisfied, and the bypass still works because all variants independently select the SAME wrong candidate", "A `grep -o ... | head -1` extractor is defended by an occurrence count taken with a DIFFERENT regex", "A widening change measured 0 regressions against real command history and a security review immediately constructed hundreds", "A comment asserts an extractor can only ever see one candidate 'because the caller counted', and the caller counted something else", "Fixing a detector opens a hole in a consumer that reads the same text with a differently-anchored pattern"]
created: 2026-09-07
severity: critical
---

# A union over renderings does not cover selection within one

## Problem

`.claude/hooks/guard-outward-cli.sh` blocks outward-facing CLI mutations. One check,
`gh_pr_clause_has_repo`, denies a `gh pr merge|create|comment` that carries `--repo`/`-R`
— i.e. one retargeted at an arbitrary repository with the user's PAT.

It extracts the clause and tests it:

```bash
for rendering in "$WORDS_DEEP" "$WORDS_VANISHED" "$WORDS_VANISHED_BLIND"; do
  clause=$(printf '%s' "$rendering" | grep -oiE "$re" | head -1)
  [ -n "$clause" ] || continue
  grep -Eq "$_OUT_REPO_FLAG_RE" <<< "$clause" && return 0
done
```

The loop is deliberate and correct as far as it goes. This file had already learned
**"a subtractive rendering must be UNIONED IN, never SUBSTITUTED FOR"** the hard way, and
that rule is visibly obeyed here: every rendering is evaluated, results OR'd, none picked
over another.

The bypass:

```
echo gh >x pr merge && gh pr merge 42 --auto --repo o/r     -> ALLOW
```

Real argv, from a PATH-shadowed argv-printing stub: `gh pr merge 42 --auto --repo o/r` —
an auto-merge in an arbitrary repository. Measured across 3 subcommands × 8 redirect
spellings × 2 slots × both flag spellings, **512 rows that really execute**.

## Root cause

Two independent things, and only their combination is fatal.

**1. The union covered the wrong axis.** Rendering-level unioning cannot help when every
rendering selects the *same* wrong candidate. The defect is `head -1` — selection *within*
one rendering. "Which clause" was an axis nobody had named, so the union rule was fully
satisfied and completely useless.

**2. The count that licensed `head -1` measured a different quantity.** A shipped comment
defended the extractor:

> "Per-rendering `head -1` stays correct: both call sites gate on an occurrence count that
> is already a per-rendering MAXIMUM, so reaching here means each rendering holds at most
> one clause. This is not choosing among several."

`$re` here is the file's **only** cut with no `${_OUT_POS_PREFIX}` anchor. The counters
that gate it (`GH_PR_MERGE_RE`, `GH_PR_CREATE_RE`) both carry it. So *"exactly one
COMMAND-POSITION occurrence"* and *"exactly one extractable clause"* were never the same
quantity — a one-word difference, in two regexes a thousand lines apart, that reads as
identical.

A mention that is not in command position adds a clause the counter cannot see. `head -1`
takes it. The real clause goes unexamined.

## Solution

Extend the union to the selection axis. The consumer is deny-shaped — two call sites
`deny()` on true with no carve-out — so scanning every clause can only ever ADD a deny.

```bash
local clauses
for rendering in "$WORDS_DEEP" "$WORDS_VANISHED" "$WORDS_VANISHED_BLIND"; do
  clauses=$(printf '%s' "$rendering" | grep -oiE "$re")
  [ -n "$clauses" ] || continue
  grep -Eq "$_OUT_REPO_FLAG_RE" <<< "$clauses" && return 0
done
```

**Capture first, then test — never `grep -oiE ... | grep -Eq ...`.** Under `set -o pipefail`
an early-exiting reader makes the pipeline report failure: `grep -q` stops at its first
match, the writer takes SIGPIPE, and the `&&` never fires. Written as a pipeline this fix
would fail **open** on exactly the inputs it exists to catch.

`grep` is line-oriented and `grep -o` puts each clause on its own line, so a `--repo`
cannot be forged across the seam between two clauses.

## Prevention

**Enumerate the axes on which a check picks one candidate from several.** Rendering,
clause, occurrence, match position are all separate axes. Satisfying the union rule on one
says nothing about the others. Ask of any `head -1` / `-m1` / `[0]`: *what makes this the
only candidate, and is that the same quantity something upstream actually measured?*

**An unanchored pattern gated by an anchored counter is a quantity mismatch, not a style
inconsistency.** When a detector and its consumer read the same text, diff the two regexes
character by character and account for every difference. Here the whole defect is one
missing `${_OUT_POS_PREFIX}`.

**A census of real history is not a census of constructible inputs.** The widening that
enlarged this bypass was measured against every redirect-bearing command in local transcript
history — 0 regressions, correctly, and the same result held on a later re-run over all
31,382 distinct commands with no filter at all. Real history contains no decoys. **Enlarging
the sample does not fix this**: history bounds *what has happened*, and says nothing about
*what an input can be shaped into*. A deny gate is threat-modelled against the second. Pair
every historical harvest with constructed adversarial rows, and treat a clean harvest as
evidence about false positives only — never as evidence about reachability.

**A completeness argument covers exactly the change it was derived for.** The argument here
("only redirect-bearing commands can change decision, because the absorber reduces to the
old pattern at zero iterations") was sound — for the absorber. A second change in the same
PR touched a consumer that is not redirect-gated at all, and the argument was quietly
carried over to it. When a PR contains two changes, the census filter must be the union of
both, or re-derived.

## Related

- [Occurrence-ambiguity guard applied selectively, not uniformly](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md)
  — the same detector/consumer split, one layer over.
- [A subtractive rendering disarms presence checks](../code-quality/summary-count-cannot-express-a-row-getting-strictly-worse-2026-09-06.md)
  — the union rule this check obeyed, and which was not enough.
- [Command-position anchor missed brace/backtick/bang boundaries](cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md)
  — the interior-redirect absorber whose landing exposed this.
