---
title: "A count pin can be correctly re-derived from a fresh run while a narrative paragraph describing the SAME arithmetic, a few lines away, silently keeps the old numbers — the pin check has no visibility into prose"
track: bug
category: code-quality
tags: [harness, hooks, testing, bash, documentation, safety-gate]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A count pin (EXPECTED_X=N) is bumped and re-verified against a fresh run, but a comment block elsewhere in the same file that narrates the SAME decomposition in prose ('N1 of N2 rows deny; the other N3 are ALLOW: N4 + N5 = N3') still states the pre-bump numbers", "The automated self-check (_pin_count/_pin_members or equivalent) reports green, because it only reads the scalar constant assigned on the pin line, never the adjacent comment describing the same arithmetic", "The file's own header already documents multiple PRIOR instances of exactly this failure ('the Nth stale copy'), and the paragraph recording that history is itself sitting a few lines above the pin where the NEXT staleness recurs", "Every individually-bumped pin constant is correct; only the prose glued to one of them (not the constant itself) is wrong, so a diff of just the assignment lines looks clean", "Found only by a human reviewer re-running the prose's own stated arithmetic, never by CI or the file's own suite"]
created: 2026-09-16
severity: medium
---

# Adjacent decomposition prose goes stale independently of its own pin

## Problem

`.claude/hooks/repro-outward-cli-corpus.sh` pins several scalar counts
(`EXPECTED_ROWS`, `EXPECTED_PRECISE_GAPS`, `EXPECTED_ALLPATH_GAPS`,
`EXPECTED_DENY_ATTRIB_ROWS`) and re-derives them from the script's own printed
output on every bump — never hand-incremented. Several of these constants are
preceded by a multi-line comment that explains the arithmetic in prose, e.g.
(paraphrased): "761 of the 876 rows deny on the precise path; the other 115
are ALLOW there: 91 rows EXPECTED to allow, plus the 24 precise-path gaps.
91 + 24 = 115 and 876 - 761 = 115, so the decomposition closes."

Adding two new corpus mechanisms bumped every pinned constant correctly
(`EXPECTED_ROWS` 876→912, `EXPECTED_DENY_ATTRIB_ROWS` 761→780,
`EXPECTED_PRECISE_GAPS` 24→41 — all copied verbatim from a fresh run's own
output, per the file's own "measured, not computed" discipline) — and the
script's automated pin check (`_pin_count`) went fully green, confirming
every constant matched. But the narrative paragraph sitting five lines above
`EXPECTED_DENY_ATTRIB_ROWS`, which restates that exact decomposition in
prose for a human reader, was never touched: it still read the pre-bump
876/761/115/24, discovered only by a reviewer who re-ran the paragraph's own
stated arithmetic (`91 + 24 = 115 and 876 - 761 = 115`) against the new pins
and found it no longer closed.

The file's own comment block *already* documents this as a recurring class —
literally labelled "THE SIXTH STALE COPY" from a prior incident, with a
warning sentence directly beneath it: "prose has no gate: no pin reddens, no
suite fails." That warning describes exactly what happened again, one bump
later, in the same file, despite every scalar pin being correctly
re-derived.

## Symptoms

- A count pin is bumped and independently re-verified (script re-run,
  `_pin_count`/`_pin_members` green) — but a comment paragraph narrating the
  same decomposition in prose, a few lines away, still states the old
  numbers.
- The stale paragraph's own internal arithmetic no longer closes once you
  substitute the current pin values (e.g. `91 + 24 ≠ 132`), but nothing
  automated computes that check — only a human re-reading the comment does.
- The file's own history already names this exact failure mode from a prior
  incident ("the Nth stale copy"), and the paragraph recording that history
  is itself adjacent to where it recurs.
- A diff of the bump touches only the assignment lines (`EXPECTED_X=N`);
  the stale prose block produces no diff noise to draw attention to it.

## Root Cause

A scalar pin and a prose paragraph narrating the same fact are two
**independent copies of one piece of knowledge**, and only one of them is
machine-checked. `_pin_count` (or any equivalent scalar-comparison gate)
reads the variable assignment; it has no way to parse a comment and verify
that the English sentence above it still agrees with the current value. The
duplication is invisible at write time — the author who bumps the pin is
looking at the constant, not scrolling up to the explanatory paragraph — and
invisible at review time too, unless the reviewer independently re-derives
the prose's own stated arithmetic rather than trusting that a passing suite
implies the whole file is internally consistent.

This is the same duplication class that motivated `_pin_subset` and
`_pin_denominator` elsewhere in this file (checks added specifically because
"a total can hold while rows swap" or "two independently-computed quantities
drift apart") — but those checks were built for two *machine-readable*
copies. A comment is not machine-readable, so the same class of drift has no
analogous check, and the file has now caught this recurrence by review at
least six times.

## Solution

Treat a scalar pin's *narrative paragraph* as part of the pin, not as
separate documentation: every time a pin bump is prepared, grep the
surrounding comments (both above and below the assignment, in this file
often 10-20 lines) for the pin's own prior numeric value and for any prose
performing the same arithmetic, and recompute those numbers from the same
fresh-run output used to bump the constant — never by hand, never by
"looks about right." In this incident the fix was mechanical once found:
substitute the four changed numbers (876→912, 761→780, 115→132, 24→41) into
the existing sentence, preserving everything else the paragraph explains
(the 91-row/nineteen-family breakdown was itself unaffected, because neither
new mechanism landed in the `EXPECTED=ALLOW ∧ PRECISE=ALLOW` bucket that 91
counts — confirming *which* numbers move and which don't is itself part of
verifying the fix, not just editing all four to look plausible).

## Prevention

- **When bumping any pinned constant that has a prose paragraph nearby,
  re-derive the paragraph's own stated arithmetic from the same fresh-run
  output, not from memory or pattern-matching the old sentence.** A pin
  check going green proves the *constant* is current; it proves nothing
  about prose next to it.
- **Search for OTHER copies of the same number before declaring a bump
  complete** — `grep` the old value across the whole file, not just the
  assignment line, since a file with this "prose explaining a pin" idiom
  tends to repeat the number in more than one place (this file's own
  comment history: "the Nth stale copy" across several prior incidents).
- **A file that documents its own history of this exact failure is not
  protected by that history** — the warning paragraph is prose too, and
  reading it does not substitute for re-deriving the numbers it warns about.
- When writing a NEW pinned constant with explanatory prose, consider
  whether the paragraph can be *generated* alongside the pin (printed by the
  script itself) rather than hand-maintained as a separate comment — that
  closes the duplication instead of relying on discipline to keep two copies
  in sync.

## Related Files

- `.claude/hooks/repro-outward-cli-corpus.sh` — the decomposition paragraph
  above `EXPECTED_DENY_ATTRIB_ROWS`, and the "SIXTH STALE COPY" comment
  documenting the prior recurrences of this exact class.

## See Also

- [a pin records its value but must also record whether it is correct](a-pin-records-its-value-but-must-also-record-whether-it-is-correct-2026-09-13.md) — the sibling lesson for the pin's VALUE; this entry is the same discipline applied to prose ADJACENT to a pin that is itself correct.
- [a clean merge leaves a stale count pin](a-clean-merge-leaves-a-stale-count-pin-2026-09-14.md) — a different mechanism (merge arithmetic) producing the same class of invisible drift in this file's pinned constants.
