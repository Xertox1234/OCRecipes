---
title: "A grammar written for presence checks eats a neighbouring character when used to BLANK text — `_CMD_REDIR`'s optional fd-digit prefix turned `--method2>x` into `--method ` and manufactured a method flag; anchor a subtractive match at a word start"
track: bug
category: logic-errors
module: shared
tags: [harness, hooks, security, testing, bash, regex]
applies_to: [".claude/hooks/**/*.sh"]
symptoms: ['A deny predicate that reads a cleaned view of the input flips main-DENY to head-ALLOW on an input the cleaning was never meant to touch', 'A `sed -E "s/${SHARED_GRAMMAR}/ /g"` blank leaves a token with its trailing digit missing', 'A regression on a NON-executable input (the manufactured flag does not exist in the tool) that a corpus keyed on executable shapes cannot see']
created: '2026-09-22'
severity: high
---

# A grammar written for presence checks eats a neighbouring character when used to BLANK text — `_CMD_REDIR`'s optional fd-digit prefix turned `--method2>x` into `--method ` and manufactured a method flag; anchor a subtractive match at a word start

## Problem

PR #1012 closed a bypass of both merge guards' implicit-POST arm by reading the arm's NEGATED
conjunct (`! grep -Eq "$ANYMETHOD"`) over an "argv view" of the clause: the trailing comment cut
at an unquoted `[[:space:]]#`, and every redirect operand blanked to a space with the shared
grammar `_CMD_REDIR` from `lib/cmd-detect.sh`. The first head blanked with
`sed -E "s/${_CMD_REDIR}/ /g"`, unanchored.

`_CMD_REDIR` opens with an OPTIONAL fd-digit prefix, `([0-9]*|[{]…[}][[:space:]]*)?`, so that
`2>&1` and `{fd}>o` register as redirects. Unanchored, that prefix also matched the `2` at the END
of the preceding word in `--method2>x`, the blank removed `2>x` together, and what remained was
`--method ` — a string that satisfies the method closer `--method([^-A-Za-z0-9]|$)`. The negated
conjunct went false, the implicit-POST arm stood down, and a row that main DENIED read ALLOW on
the branch. Measured by the one-pass security review on both guards for `--method2>x`,
`--method1>&2` and `--method0<x`, with `--methodology>x` and `--method2x` denying on both sides
as controls.

The change had been described, in the guard, the suite headers and the todo, as monotone in the
deny direction — "removing text cannot invent a method token". That sentence was false as
written.

## Symptoms

- A "can only add denials" claim about a change that removes text from the input of a negated
  predicate, stated without saying WHERE the removal is anchored.
- A shared regex reused in a `sed s///` substitution when every prior consumer used it in
  `grep -E` — the additive consumers never cared that an optional leading group could match part
  of a neighbouring token; the subtractive one does.
- Rows that flip main-DENY → head-ALLOW on an input the real tool would REJECT (gh has no
  `--method2` flag, so the row cannot execute) — which is exactly why an executable-shape corpus
  reports nothing.

## Root Cause

`_CMD_REDIR` is an ADDITIVE grammar: for a presence check, a match that starts one character
early only widens what counts as a redirect, and wider is the safe direction for a DENY-shaped
check. Substitution inverts that property. A match that starts one character early DELETES that
character from the neighbouring token, and a deletion can produce a string the original never
contained. The monotonicity a grammar has under `grep -q` does not transfer to `sed s///` — the
same lesson this repo already recorded for renderings
(`../code-quality/…subtractive…` — see the See Also links): a property of one FORM of use is not
a property of the grammar.

## Solution

Anchor the subtractive use at a boundary the grammar itself does not own:

```bash
# unanchored — the fd-digit prefix can start inside the previous word
_GH_API_ARGV=$(printf '%s' "$_GH_API_ARGV" | sed -E "s/${_CMD_REDIR}/ /g")
# anchored — the blank can never alter the token before it
_GH_API_ARGV=$(printf '%s' "$_GH_API_ARGV" | sed -E "s/(^|[[:space:]])${_CMD_REDIR}/\1 /g")
```

Then restate the monotonicity claim as the property that actually holds: "the cut removes a
SUFFIX at a space and the blank replaces a WORD-INITIAL match with a space, so neither can alter
the token before it". The anchor has a cost — an operator GLUED to the preceding word with a
SPACED operand (`-f k=v> -X`) is no longer blanked — and that cost is a shape main allowed
identically, so it is pinned KNOWN-WRONG beside controls rather than left unstated. Do NOT
tighten the shared grammar to fix a subtractive consumer: every additive consumer is correct as
is, and narrowing a grammar three guards and a required corpus read needs its own base-vs-head
run in both directions.

Verified afterwards by a generated 2304-row corpus (positions × preceding words × glues × fd
prefixes × operator families × operand glues × operands, argv ground truth from a stub under bash
5.3.15 and zsh 5.9): 0 DENY→ALLOW rows in either guard, every new denial word-initial.

## Prevention

- Before reusing a shared regex in `sed`/`awk` substitution, ask whether any OPTIONAL leading
  group can match characters of the preceding token. If it can, anchor the substitution.
- A monotonicity sentence must name the mechanism ("word-initial match", "suffix at a space"),
  not the intent ("removing text cannot invent…"). A reviewer can test a mechanism.
- Probe the cleaned VIEW, not just verdicts: print the string the predicate sees for each row
  (`--method ` was visible on sight once printed).
- Include non-executable inputs in the regression corpus: the manufactured flag cannot run, and
  a corpus of executable shapes will never contain it.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — `_GH_API_ARGV`, the anchored blank and the NON-ARGV TEXT
  residual bullet that records the regression
- `.claude/hooks/merge-review-guard.sh` — `MRG_API_ARGV`, byte-for-byte the same pipeline
- `.claude/hooks/lib/cmd-detect.sh` — `_CMD_REDIR`, unchanged on purpose
- `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/test-merge-review-guard.sh` — the
  three manufactured-method rows, two controls and the KNOWN-WRONG anchor-cost row
- `todos/archive/P1-2026-09-18-trailing-comment-disarms-grant-shaped-negated-predicates.md`

## See Also

- [an allowlist inside a deny predicate fails open](an-allowlist-inside-a-deny-predicate-fails-open-2026-09-19.md) — the sibling failure: narrowing a deny predicate's INPUT is the same class as narrowing the predicate
- [widening is monotone on a boolean read, not on a count](widening-is-monotone-on-a-boolean-read-not-on-a-count-2026-09-14.md) — the same "a property of one form of use is not a property of the grammar" argument for counts
- [compose a precise detector from shared primitives without widening the extractor](../conventions/compose-precise-detector-from-shared-primitives-without-widening-extractor-2026-09-14.md) — why the shared grammar stays as it is
