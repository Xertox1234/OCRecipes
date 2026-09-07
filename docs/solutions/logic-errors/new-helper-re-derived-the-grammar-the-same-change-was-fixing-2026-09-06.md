---
title: "A new helper re-derived the quote grammar the same change was fixing — and got it wrong three lines away, under a fully green suite"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, parsing, testing]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A fix for a scanner desync ships alongside a NEW scan that has the same desync", "Every test for the new arm uses a 'clean' input that cannot exercise the bug", "The suite and the mutation run are both green over a live bypass", "A helper does its own byte-level counting next to a state machine that already answers the same question"]
created: 2026-09-06
severity: critical
---

# A new helper re-derived the grammar the same change was fixing

## Problem

A change to `.claude/hooks/lib/cmd-detect.sh` fixed a **quote-unaware paren counter** — the
`)` of an inner subshell was closing the enclosing `$(...)` early, so a split binary name never
re-formed and the outward-CLI guard silently ALLOWED an OTA publish.

The fix was correct. It also required exempting `$((arithmetic))` from deletion, and that
exemption needed to find where the arithmetic construct ends. The new end-finder was written as
a standalone byte-level loop:

```awk
k = i + 1; pdepth = 0
while (k <= n) {
  ch = substr(buf, k, 1)
  if (ch == "(") pdepth++
  else if (ch == ")") { pdepth--; if (pdepth == 0) break }
  k++
}
```

**That is a second quote-unaware paren counter, introduced three lines away from the fix for
the first one**, in a file that had already solved this grammar correctly.

## Symptoms

- A quoted paren inside a nested substitution inflates the count, so the walk runs PAST the
  true end of the construct.
- Everything in the over-consumed span is copied verbatim, which silently disables every
  deletion inside it — including the deletions the same change had just added.
- All assertions pass. Both the unit suite (530/0) and an 8-arm mutation run were green.

Measured end-to-end, with a PATH-stubbed binary proving real bash does invoke it:

```
(echo start; $(( $(echo '(' >/dev/null; echo 5) )); e$!as update --branch preview)
  guard verdict           ALLOW
  PATH-stubbed binary     CALLED WITH: update --branch preview
  same payload, no decoy  DENY
```

## Root Cause

Two independent causes had to coincide, and both are reusable warnings:

1. **The helper re-derived a grammar the file already implements.** `cmd_bare`, `cmd_words`,
   `cmd_extract_substitutions` and `cmd_words_vanished` all track quote state as 0/1/2/3 and act
   only in state 0. The new scan answered the same question — "where does this construct end?" —
   with none of that context. A scan that re-derives a solved grammar will re-derive it
   incompletely; that is the default outcome, not bad luck.

2. **Every test for the new arm used a CLEAN input.** The three arithmetic pins were
   `f$((1+2))oo`, `x=$((i+1))` and `$(( $(printf 1) ))` — none contains a quote, so none could
   exercise the arm's only failure mode. The pins were written from the implementation's happy
   path rather than from the grammar it claimed to parse, so the suite agreed with the code
   instead of checking it.

## Solution

Reuse the file's own quote-state model, and take the dangerous outcome only on positive
evidence:

```awk
# counts parens ONLY in unquoted state, mirroring every other scan in this file
function arith_end(p,   k, st, ch, pd) { ... }

# verbatim copying is the only outcome that can HIDE a deletion, so require
# positive evidence the construct really closed as `))`; anything else falls
# through to deletion, which is an over-DENIAL — the safe direction.
if (k > 1 && substr(buf, k-1, 1) == ")") { ...copy verbatim... }
```

A `(` inside a *double*-quoted span is deliberately not counted either. Under-counting fails to
balance, returns 0, and drops through to the deleting path — an over-denial rather than a
missed deny. **Pick the failure direction on purpose.**

## The same change produced a SECOND instance, with the opposite shape

The repair above fixed a scan that re-derived the grammar. Review then found that the fix
*itself* — the paren counter — had the same disease in a different form. It was **substituted
for** the previous close semantics rather than **unioned with** them, and a construct the
counter cannot read defeated it: a `(` inside a shell **comment** is inert to bash, but the
counter counts it, so the substitution level never closes and the rendering comes back EMPTY.

```
e$(: # (
)as update --branch preview
  main DENY  ·  branch ALLOW  ·  PATH-stub: eas CALLED WITH: update --branch preview
```

That is a **DENY→ALLOW regression**, strictly worse than the missed widening it was fixing.

**The rule was already written on the function being changed**: *"EVERY CONSUMER UNIONS THIS
IN; NONE SUBSTITUTES IT FOR the deep rendering."* It was stated about the rendering's
consumers and was just as true of the rendering's own close semantics. When you make a
scanner's decision *later* (or *earlier*), you have not improved one rendering — you have
produced a second one, and the old one still covers inputs the new one cannot read.

The fix keeps both and unions them at the deny-shaped consumers. Comment-tracking was
considered and rejected: `#` opens a comment only at word start, so a wrong guess under-counts,
closes early, and re-opens the original bug — a fifth grammar bet to repair the fourth. **A
union has no missed-deny direction at all; a smarter parser has two.**

One caveat worth carrying, because the first attempt got it wrong: the two renderings must stay
in **separate variables**, not be concatenated into one multi-line rendering. A consumer that
COUNTS occurrences then sees the same match twice — here, one `gh api` became two and tripped
an "ambiguous, cannot verify" deny on a genuine read-only call. Found in a false-positive
harvest over real command history, not by review.

## Prevention

- **When a change adds a scan over the same input an existing scanner already walks, reuse that
  scanner's state model or say in a comment why the simpler scan is sufficient.** "It is only a
  small lookahead" is how the second copy gets written.
- **Changing WHERE a scanner decides produces a second rendering, not a better one.** Keep both
  and union them at the deny-shaped consumers, in separate variables so a counting consumer
  does not see one match twice. This is the cheapest correct move whenever the new decision
  depends on grammar the scanner cannot fully read.
- **Derive test inputs from the grammar, not from the implementation.** For any scan over shell
  text the minimum set is: a quoted instance of the delimiter, an escaped one, a nested
  construct, and an unbalanced one. If every pin for a new arm is "clean", the arm is untested
  no matter how many pins there are.
- **Ask which outcome can HIDE a check, and require positive evidence for that one.** Here,
  copying verbatim hides deletions and deleting merely over-denies — so verbatim needs proof and
  deletion is the fallback, not the reverse.
- A reviewer found this by *constructing the input and running it*. Reading the arm — including
  writing its own header comment about pass-order hazards — did not.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `arith_end()` and the `$((` arm in `cmd_words_vanished`.
- `.claude/hooks/test-cmd-detect.sh` — the quoted-paren and `))`-evidence pins added afterwards.
- `.claude/hooks/test-guard-outward-cli.sh` — the end-to-end attack row plus its
  clean-arithmetic isolation control.

## See Also

- [Occurrence-ambiguity guard applied selectively, not uniformly](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md) — the sibling failure: the same grammar implemented in one place and not its twin.
- [A test pin normalised by a later pipeline stage is a decoration](../code-quality/test-pin-normalised-by-a-later-pipeline-stage-is-a-decoration-2026-09-06.md) — the other way a green assertion covered nothing in this same change.
- [A fast-path pre-filter's superset proof must be re-verified](../conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — the reachability corollary from this same change.
