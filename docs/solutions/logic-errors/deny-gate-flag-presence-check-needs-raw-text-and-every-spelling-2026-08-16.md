---
title: "A deny-gate flag-presence check needs RAW text (not quote-blanked) and EVERY standard spelling — quote-blanking is right for confirming an invocation, wrong for confirming a flag on one already confirmed"
track: bug
category: logic-errors
module: shared
tags: [harness, hooks, bash, security, flag-parsing, quote-handling, deny-gate, command-matcher, code-review]
symptoms: ["A deny check for a specific flag (e.g. --admin) allows the exact command it is meant to deny when the flag is spelled with '=value' instead of a trailing space", "The same deny check allows the command when the flag is wrapped in quotes, even though the shell passes an identical argv token either way", "A mutating-verb detector (e.g. an HTTP method check) misses the glued short-flag spelling (-XPOST) while catching the spaced form (-X POST)", "Widening a regex to add a missed spelling still fails because the check operates on already-quote-blanked text, so a QUOTED instance of the newly-added spelling is invisible too", "A carve-out's own safety comment asserts a check 'can only ever add a deny, never grant a bypass' while the check itself is the thing silently granting the bypass"]
created: 2026-08-16
last_updated: 2026-08-16
severity: high
---

# A deny-gate flag-presence check needs RAW text (not quote-blanked) and EVERY standard spelling — quote-blanking is right for confirming an invocation, wrong for confirming a flag on one already confirmed

## Problem

`.claude/hooks/guard-outward-cli.sh` (a PreToolUse deny gate for outward-facing
CLI mutations) carves out `gh pr merge --auto ...` from a blanket deny,
*unless* `--admin` is also present (which contradicts the carve-out's premise
— see the file). Round 1 built the `--admin` check as:

```bash
if grep -Eq '(^|[[:space:]])--admin([[:space:]]|$)' <<< "$CLAUSE"; then
```

where `$CLAUSE` is derived from `$BARE` — the output of this repo's shared
`cmd_bare()` (`.claude/hooks/lib/cmd-detect.sh`), which deliberately blanks
the *contents* of every quoted span. Round 2 review (two independent
reviewers, empirical stdin-only testing, no real CLI executed) found this
ALLOWS the exact command it exists to deny:

```
gh pr merge 42 --auto --admin=true --squash --delete-branch   # ALLOWED
gh pr merge 42 --auto "--admin" --squash --delete-branch      # ALLOWED
```

The sibling `gh api` mutating-HTTP-method check had the identical shape and
the identical class of miss:

```bash
grep -Eqi '(^|[[:space:]])(-X|--method)([[:space:]]+|=)(post|put|patch|delete)([[:space:]]|$)' <<< "$GH_API_CLAUSE"
```

missed the glued short-flag spelling `-XPOST` (no separator between flag and
value — the same idiom as `curl -XPOST` or `gcc -oFILE`).

## Symptoms

See frontmatter `symptoms`. The unifying observable: a deny check named
after the exact flag it means to catch (`--admin`, `-X`/`--method`) still
allows a command carrying that exact flag, spelled a standard-but-uncommon
way.

## Root Cause

Two independent, compounding under-models — the same "matcher and extractor
must be updated TOGETHER" trap as
[the command-gate option-cardinality doc](command-gate-option-cardinality-and-verb-boundary-2026-07-20.md),
but on a different axis (spelling completeness, not option cardinality):

1. **Incomplete spelling coverage.** A boolean pflag/cobra flag (the
   convention `gh` and most Go CLIs use) accepts at least three equivalent
   spellings: bare (`--admin`), `=value` (`--admin=true`), and — for a
   short-form flag with a value — glued (`-XPOST`). A regex written against
   only the spelling the author happened to type first (`--admin` with a
   trailing space, `-X POST` with a trailing space) silently excludes the
   others. This alone is a straightforward, low-stakes bug to catch and fix
   — widen the alternation.

2. **The deeper trap: quote-blanking is directional, and this check used it
   backwards.** `cmd_bare()` blanking quoted CONTENT is *correct and
   necessary* for one specific question this same hook file asks elsewhere:
   "is `eas`/`gh pr merge`/etc. genuinely invoked at command position, or
   merely MENTIONED inside a quoted string (a commit message, a `--body`
   value)?" For THAT question, a quoted occurrence must be treated as
   non-existent, or `git commit -m "never run eas update"` would falsely
   deny.

   The `--admin`/`-X` checks are asking a **different** question: "does
   THIS ALREADY-CONFIRMED-REAL invocation carry flag `--admin`?" For that
   question, quoting is irrelevant — the shell strips quote characters
   during word-splitting and passes `gh pr merge 42 --auto "--admin"` and
   `gh pr merge 42 --auto --admin` as *byte-identical* argv to `gh`. A
   quoted flag is not a "mention" the way a quoted commit message is; it is
   a real, functioning argument. Feeding a flag-presence check the
   quote-blanked `$BARE`/`$CLAUSE` text — built for the FIRST question —
   silently answers the SECOND question wrong, in the dangerous direction
   (a real flag reads as absent).

   This is why simply widening the round-1 regex to add `=` was not enough
   on its own to close the quoted-flag hole: the fix has to change *which
   text the check reads*, not just *what pattern it matches*.

## Solution

For a flag-presence check inside a clause that a STRICT, command-position
predicate has already confirmed is a real invocation (the pattern this file
uses throughout: confirm the subcommand via `$BARE`/`cmd_bare`, THEN check a
specific flag), read the flag-presence check against the **raw**, unblanked
command text — not `$BARE`:

```bash
# WRONG: quote-blanked text hides a quoted-but-real flag
if grep -Eq '(^|[[:space:]])--admin([[:space:]]|$)' <<< "$CLAUSE"; then

# RIGHT: raw $CMD, boundary widened past whitespace-only so `=value` and a
# trailing quote/comma both count as a boundary
if grep -Eq '(^|[^-A-Za-z0-9])--admin([^-A-Za-z0-9]|$)' <<< "$CMD"; then
```

For a value-flag whose short form allows a glued spelling, add the glued
alternative explicitly rather than trying to express "optional separator" in
one branch — a `([[:space:]]+|=)?` with no separator often interacts badly
with the surrounding boundary classes; two explicit alternatives are clearer
and easier to verify by inspection:

```bash
'(^|[[:space:]])(-X(post|put|patch|delete)([[:space:]]|$)|(-X|--method)([[:space:]]+|=)(post|put|patch|delete)([[:space:]]|$))'
```

A false-positive from the widened boundary (matching an unrelated clause, or
a longer flag name that happens to contain the target as a substring) is the
**safe direction** on a deny gate — it costs an extra deny, never a bypass.
This is the same "over-inclusion here only tightens the check, it cannot
create a bypass" argument this hook already makes for its `--auto` decoy
check; the raw-text/boundary widening carries the argument one step further.

## Prevention

- **Before writing a flag-presence check, name which of the two questions it
  is answering**: "is the command really invoked" (use `cmd_bare` — blank
  quotes) or "does an already-confirmed invocation carry flag X" (use raw
  text — quotes don't matter to the program). Mixing them up is invisible in
  review unless someone tests a quoted spelling specifically.
- **Enumerate a flag's standard spellings before writing the regex**: bare,
  `=value`, and — for any short form — glued-with-value. Do this from the
  flag's own declared type (boolean vs. value-taking), not from one example
  invocation.
- **A comment asserting "this check can only ever ADD a deny, never grant a
  bypass" is a claim about the check's LOGICAL polarity (presence → deny),
  not proof the check actually detects every presence.** Both rounds of this
  incident had exactly that comment sitting directly above a check with a
  live detection gap — the polarity argument was true and irrelevant; the
  detection completeness was the actual open question, and nothing in the
  comment tested it.
- Regression-test every closed spelling explicitly (bare / `=value` /
  quoted / glued) rather than one representative case — see
  `.claude/hooks/test-guard-outward-cli.sh` for the shape (each fix in this
  incident got 2-3 targeted cases, not one).

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — the `--admin` check (raw `$CMD`,
  widened boundary) and the `gh api` mutating-method check (glued `-X`
  alternative), both fixed per this doc.
- `.claude/hooks/test-guard-outward-cli.sh` — regression cases for
  `--admin=true`, a quoted `"--admin"`, `-XPOST`, and `-Xpost`.
- `.claude/hooks/lib/cmd-detect.sh` — `cmd_bare()`, the shared quote-blanking
  primitive this doc's Root Cause explains the correct (and incorrect)
  direction for.

## See Also

- [quote-strip-escape-glue-hides-real-command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — the sibling lesson on the SAME primitive, from the opposite failure direction: there, not blanking quotes let a MENTION masquerade as an invocation; here, blanking quotes let a REAL flag masquerade as absent.
- [command-gate option cardinality and verb boundary](command-gate-option-cardinality-and-verb-boundary-2026-07-20.md) — the sibling "matcher and extractor must change TOGETHER" trap, on the cardinality/precedence axis instead of the spelling-completeness axis.
- [a stated invariant is not an enforced one](../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md) — the general form of "a comment asserting a safety property, sitting directly above the code that violates it."
- [gate test needs a two-sided negative control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — why the regression tests for this fix assert per-spelling, not just one representative case.
