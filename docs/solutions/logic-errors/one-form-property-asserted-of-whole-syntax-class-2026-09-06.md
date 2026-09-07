---
title: "A property proven of ONE expansion form is not a property of its syntax CLASS — the overclaim justified leaving a live bypass open"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative, verification]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A comment or todo justifies NOT widening a detector by asserting a property of a whole syntax class (\"a bare $name cannot split a token\"), and the property is only true of the one example the author had in mind", "A gated command is DENIED with the documented spelling but ALLOWED with a sibling spelling from the same syntax class", "The PRECISE execution path allows what the DEGRADED paths deny — inverting the usual fail-closed asymmetry", "A detector's allow-list is incomplete against its own written eligibility criterion", "Every spelling the enumeration anticipated is caught; the bypass uses a second MECHANISM the enumeration's key (a sigil, a prefix) cannot see at all"]
created: 2026-09-06
severity: critical
---

# A property proven of one expansion form is not a property of its syntax class

## Problem

`.claude/hooks/guard-outward-cli.sh` blocks an agent from invoking outward-facing CLIs
(`eas update`, `npm publish`, `gh pr merge`). Its fast path declines a cheap `exit 0`
when the command contains `${`, `$(` or a backtick — the three digraphs that can hide a
token split. A shipped comment justified NOT extending that to a bare `$`:

> Deliberately not widened: `$` alone appears in a large share of real commands, so
> including it would move most of them onto the full path **for a shape that cannot split
> a token mid-word anyway (a bare `$name` greedily consumes following alphanumerics, so it
> cannot rejoin two halves of a verb).**

The bolded clause is true of an **ordinary identifier** and false of the rest of the class.
Bash's **special parameters** — `$!`, `$@`, `$*`, `$?`, `$$`, `$#`, `$1`–`$9` — are **one
character** long, so they terminate against a following letter instead of absorbing it.
`e$!as` really is `e` + `$!` + `as`, and with `$!` empty the argv word is `eas`.

Measured on the live hook, all four execution paths:

```
e$!as update --branch preview     ALLOW ×4     ← a real OTA publish to end users
e$1as update --branch preview     ALLOW ×4
g$1h pr merge 42                  ALLOW ×4
eas up$!date --branch preview     precise=ALLOW, all 3 degraded=DENY
```

Controls isolate the spelling as the only variable — `e${UNSET}as update` and
`e$'a's update` DENY on all four.

The same review found a second, harder case. A **brace range** splits a token with **no `$`
and no backtick anywhere in the command**:

```
{e..e}as update --branch preview   ALLOW ×4
eas up{d..d}ate --branch preview   ALLOW ×4
gh pr merge{1..3} 42               DENY ×4    ← control: brace AFTER an intact verb
```

## Symptoms

- A detector denies the documented spelling and allows a sibling spelling of the same class.
- The justification for not widening reads as a proof but names only one example.
- The precise path is weaker than the degraded paths for one input shape.
- The allow-list contradicts its own stated eligibility rule.

## Root Cause

**Two distinct errors, and the second is the one that has no cheap fix.**

1. **Generalising from one instance to a syntax class.** `$RUNNER` and `$!` are both
   "a bare `$name`" in prose and behave oppositely at the lexer. The greedy-absorption
   property belongs to the *identifier* production, not to the `$`-sigil class. The
   allow-list in `lib/cmd-detect.sh`'s `cmd_words_vanished` states its own criterion —
   *"an expansion form must be PROVEN capable of evaluating to EMPTY before it may be
   deleted"* — and `$1` with no positional args satisfies it. The list was **incomplete
   against a rule written directly above it**, which is why reading the code did not
   surface the gap.

2. **Enumerating spellings of one mechanism can never cover a second mechanism.** Every
   fix in this guard keys on a **sigil**. A brace range carries none, so no amount of
   `$`-spelling enumeration reaches it. This is not a missing case; it is the axis being
   wrong. Adding `{` to the sigil list is not the fix either — `{` is ubiquitous in real
   commands (`find -exec {} \;`, JSON, awk programs), so keying the decline on it moves
   nearly everything onto the slow path for no benefit.

## Solution

**Retract the overclaim first, before deciding whether to fix.** The false sentence is
worse than the gap: it tells the next reader the class is closed and converts an open bug
into a settled decision. The retraction states what was measured, including the inverted
asymmetry, and says plainly that the reason for not widening is **cost**, not harmlessness.

**Do not widen the allow-list at the trigger alone.** `cmd_words_vanished 'e$1as update'`
returns the string unchanged, so extending the fast path's trigger changes nothing — the
detector and its consumer must widen in ONE change, in the shared scanner.

**Close a no-sigil mechanism with a narrow deny, not another rendering.** A brace-deleting
rendering re-opens the "where does the construct END" problem that took three review rounds
to close; the sound shape is a deny on a brace RANGE glued to gated text.

**Measure the gap on every run instead of describing it.** 56 generated corpus rows
(4 mechanisms × 2 glue positions × 7 families) carry `DENY` expectations and currently
report as gaps. Flipping them to match today's behaviour would encode "this bypass is fine"
into the fixture and retire the only artifact pointing at it.

## Prevention

- **Before writing "X cannot do Y", instantiate the whole class of X and run it.** The
  sentence that reads most like a proof is the one to execute. Here, four one-line probes
  would have refuted it.
- **Check an allow-list against its own stated criterion.** If the rule above the list
  admits a form the list omits, that is a defect visible without any new insight.
- **Never assume the degraded path fails closed.** It held for every earlier finding in
  this guard and inverted here: the degraded mirror keys on a gated binary near a `$`, and
  the precise path had no equivalent. Fail-closed is a per-check property, not an invariant.
- **A corpus that varies one axis reproduces the blind spot that chose the axis.** Vary
  family × glue POSITION × mechanism, and treat "is there a second mechanism entirely?" as
  its own question — a sigil-keyed axis cannot ask it.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — DOCUMENTED RESIDUALS carries the retraction and both open classes
- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words_vanished`'s allow-list and its eligibility criterion
- `.claude/hooks/repro-outward-cli-corpus.sh` — the `r4spec-`/`r4dig-`/`r4ansic-`/`r4brange-` rows
- `todos/archive/P0-2026-09-06-cmd-detect-bare-paren-subshell-breaks-substitution-scanners.md`
- `todos/P2-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md`

## See Also

- [cmd-position anchor missed brace/backtick/bang boundaries](cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md) — the same guard, the same "the author enumerated what they thought of" failure, one layer down in the character classes
- [a deletion pass must prove the construct can be empty](deletion-pass-must-prove-construct-can-be-empty-2026-09-02.md) — the criterion this allow-list was incomplete against
- [a summary count cannot express a row getting strictly worse](../code-quality/summary-count-cannot-express-a-row-getting-strictly-worse-2026-09-06.md) — the measurement error found in the same review round
- [verifying a test fails without its fix proves it catches THAT bug, not the class](../conventions/test-verified-against-one-trigger-misses-its-siblings-2026-08-05.md) — the testing-side sibling of the same generalisation error
