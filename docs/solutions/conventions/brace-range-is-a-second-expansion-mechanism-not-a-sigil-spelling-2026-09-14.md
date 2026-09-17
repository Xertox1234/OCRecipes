---
title: "A sigil-keyed fast-path decline can never be complete — bash brace RANGE expansion splits a token with no $ and no backtick anywhere"
track: knowledge
category: conventions
tags: [harness, security, shell-quoting, false-negative, parsing]
module: server
applies_to: [".claude/hooks/**"]
created: 2026-09-14
last_updated: '2026-09-16'
---

# Enumerating spellings of one expansion mechanism cannot cover a second, unrelated one

## When this applies

A text-matching guard decides whether a command is safe by looking for a gated binary or
verb as a literal substring, and defends against a bypass where the shell reconstructs that
substring from an expansion the guard's raw text never contains (`e${UNSET}as` → `eas`).
Applies whenever that defense is an enumerated list of the SIGILS that introduce such an
expansion (`$`, `` ` ``, `${`, `$(`, `$!`, `$'`, …).

## Rule

Closing every spelling of a sigil-keyed expansion mechanism (`$`-prefixed forms, backtick
substitution) does not close the class "an expansion can reconstruct a split token." Bash has
a **second**, syntactically unrelated mechanism that does the identical thing with **no `$`
and no backtick anywhere**: brace RANGE expansion. `eas up{d..d}ate` and `{e..e}as update` are
both real, single bash words after expansion (`eas update` / `eas update`), and neither
contains a byte any `$`/backtick-keyed decline, strip, or vanish-rendering can key on. A fix
that enumerates every `$`-spelling exhaustively is complete against the sigil family it
enumerated and mute about a sibling family that shares the *symptom* (token reconstruction)
but not the *mechanism* (no dollar sign is ever involved).

The corollary that matters for where a fix has to land: a **fast-path pre-filter** that
declines its cheap exit on a fixed sigil set (`${`, `$(`, `` ` ``) is *invisible* to a
mechanism the set doesn't name — the command takes the cheap exit before the precise matcher
downstream is ever reached, so a correct deny added to the precise matcher is unreachable for
that mechanism specifically. The two problems ("does the matcher recognize this construct"
and "does anything upstream of the matcher let this construct reach it") have independent
fixes and must both be checked.

## Why

`guard-outward-cli.sh`'s fast-path stage 3 declines its cheap exit for any command containing
`${`, `$(` or a backtick — closing three prior gaps in this exact chain (special parameters
`$!`/`$@`/`$1`..`$9`, ANSI-C `$'…'` requoting, ambient `$`-sigils generally). Each of those
closures was a real, measured fix. None of them helped brace RANGE, because `{e..e}as` and
`eas up{d..d}ate` carry none of the three digraphs the decline set checks for — confirmed by
running the guard's own fast-path helper directly:

```bash
. .claude/hooks/lib/fastpath-filter.sh
cmd_fastpath_has 'eas up{d..d}ate --branch preview' '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'
# rc=0 (matched — "eas" is intact in raw text) -> skips the stage-3 decline entirely
cmd_fastpath_has '{e..e}as update --branch preview' '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'
# rc=1 (no needle) -> falls to stage 3, which has no brace-range arm -> cheap exit
```

The split matters structurally, not just as a curiosity: it separates the mechanism into two
independently-reachable shapes. A brace range glued **inside** a verb (`up{d..d}ate`) or after
a namespace word (`gh pr me{r..r}ge`) leaves the *binary name itself* intact in raw text, so
the existing needle-based fast path (stage 1/2, unrelated to the sigil decline) still finds
`eas`/`gh` and lets the command through to the precise matcher — a narrow deny placed there
closes it with no fast-path change at all. A brace range glued inside the **binary's own**
first letters (`{e..e}as`, `{g..g}h`) supplies no needle either, so it takes the cheap exit
regardless of what the precise matcher would do — closing that shape needs the fast path's
own decline set widened, a materially different (and, for at least one project's Scope
Contract, explicitly out-of-bounds) change. **Measure which shape you're looking at before
promising a fix closes "the" gap** — it may only close one of two independently-gated halves.

## Examples

```bash
# VERB-position (binary name intact in raw text) — closeable with a precise-path-only fix:
eas up{d..d}ate --branch preview      # real argv: eas update ...
gh pr me{r..r}ge 42                   # real argv: gh pr merge 42

# TOOL-position (binary name itself split) — needs the fast-path decline widened too:
{e..e}as update --branch preview      # real argv: eas update ...
{g..g}h api repos/o/r -X POST         # real argv: gh api ...

# The already-documented, DIFFERENT shape that this is not: a range that follows an
# INTACT, complete verb. Bash's own `{`/`}` boundary handling (a plain closer-class
# widening, unrelated to expansion at all) already denies this — do not conflate the two:
gh pr merge{1..3} 42                  # DENIES via the pre-existing boundary check
```

A fix targeting the split-token shape must not accidentally ALSO fire on the
already-handled trailing-range shape above with a *different* reason than the existing
check's — see
[a stale deny-reason assertion](../logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md)
for why a new check placed earlier than an existing, more specific one can silently steal its
attribution even while the verdict stays correct. Confirmed live during this fix's own
construction: before an explicit exclusion was added, the new brace-range check ran before
`gh pr merge`/`gh pr create`/`gh pr comment`/`gh api`'s own checks and reported its own reason
for `gh pr merge{1..3} 42`, `gh pr create{1..3} ...`, `gh pr comment{1..3} ...` and
`gh api{1..3} ...` instead of theirs — construct-and-run against the live hook, not derived
from reading the regex, is what found it (the same discipline this whole chain already
mandates for the primary bypass).

**Second-order lesson, found by an independent reviewer one round later, on the FIX for the
above:** an exclusion clause added to stop a new check from stealing an existing check's deny
reason is *itself* a new boolean condition, and inherits the SAME "narrow means anchored to
position, not merely present in the text" requirement as every deny arm in this file — a
requirement its own author skipped writing it, precisely because it reads as "just suppress
this one case," not as a new attack surface. The first shipped version was a bare
`grep -Eq "(merge|create|comment|api)\{X..Y\}<boundary>"` with no `_OUT_POS_PREFIX` anchor —
correct for the cases it was written against, and defeatable by a **decoy**: any literal
occurrence of `merge{1..3}` *anywhere in the command*, including inside a wholly unrelated
argument, satisfied the exclusion and silently disabled the entire brace-range narrow-deny
block for the WHOLE command line, not just for the token that happened to match it:

```bash
eas up{d..d}ate --branch preview && echo merge{1..3}
# real argv: eas update --branch preview && echo merge1 merge2 merge3 -- an OTA publish,
# ALLOWED, even though the bare `eas up{d..d}ate --branch preview` alone correctly denied
```

The generalization: **a suppression/exclusion condition is a deny-arm in the opposite
direction, and gets the SAME anchoring scrutiny as any other arm — "this text exists
somewhere" is never sufficient for a security-relevant boolean, whichever way it points.**
Writing the exclusion as "prevent this one case from double-firing" framed it as a narrow
patch, which is exactly what let it ship unanchored — the same mental category error as
writing a deny check and forgetting `_OUT_POS_PREFIX` on it.

## Exceptions

None for the "second mechanism" rule itself — it is a structural fact about bash grammar
(brace expansion and parameter/command expansion are unrelated syntax), not a heuristic that
degrades gracefully. A project MAY choose to leave the TOOL-position half open as a
documented residual when closing it would require a broader change (e.g. widening a
fast-path sigil class that a Scope Contract deliberately protects) — that is a scope
decision, not a claim that the mechanism doesn't exist. State which half is closed
explicitly; do not let "the brace-range bypass is fixed" imply both halves when only one is.

## A THIRD sibling mechanism confirms the rule, and nesting exposes a path asymmetry neither of the first two ever surfaced (2026-09-16)

`todos/archive/P2-2026-09-14-brace-list-expansion-reconstructs-a-gated-verb.md` added bash brace
**LIST** expansion (the comma form, `{a,b}`) as a third, independent reconstruction mechanism —
no `$`, no backtick, and no `..`. `eas up{d,x}ate --branch preview` (real argv: `eas update
upxate --branch preview`) is invisible to the sigil-keyed checks above AND to the brace-RANGE
token above it, for the identical reason each is invisible to the others: three unrelated bash
grammars share only the symptom (a split token reconstructs a gated verb), not the mechanism.
The fix reused `_OUT_BR_RANGE_TOKEN`/`_OUT_BR_RANGE_ALREADY_HANDLED`'s shape verbatim
(`_OUT_BR_LIST_TOKEN`/`_OUT_BR_LIST_ALREADY_HANDLED`), applying the command-position anchoring
and per-occurrence exclusion discipline from the start — the range block needed two live-bypass
review rounds to reach that shape; the list block shipped it directly and both this todo's own
two review rounds confirmed it holds. **Nothing new to the rule itself** — this is confirmation,
not a fourth spelling of the lesson.

**What IS new: nesting a construct inside a LIST alternative exposes an asymmetry no prior
mechanism in this chain surfaced**, because it is the first time one expansion construct sits
*inside* another rather than beside it. `_OUT_BR_LIST_TOKEN`'s item class excludes `{`/`}` (no
nested braces, by design — the Scope Contract forbids a new scanner), so `up{d,{a..z}}ate` or
`up{d,{x,y}}ate` (a RANGE or a LIST nested inside a LIST alternative) reaches no check on the
**precise** path and ALLOWS. But all three **degraded** paths DENY the identical construction —
not via anything new, but because `crude_smells_outward`'s gap between the binary name and its
trailing alternative (`[^;&|]*`) is not brace-depth-aware: it lets the INNER span alone (`{a..z}`
via the pre-existing RANGE alternative, `{x,y}` via the new LIST alternative) satisfy its own
alternative, independent of and blind to the outer list it sits inside. The precise path's
careful, item-class-scoped token and the degraded path's loose, depth-blind gap disagree on the
identical input for structurally different reasons — a property that could not appear anywhere
in this chain until there were two nestable mechanisms to put one inside the other. State which
path a nested-residual claim is about; "ALLOWS" or "DENIES" without a path qualifier is
ambiguous exactly here.

**Second recurrence, one level up from the detector:** round 1 of this todo's own review found
that the nested-residual's PROSE — not a regex this time, a doc comment — asserted a property
("this nested form is a residual") from the one example that happened to be measured
(range-in-list) and left a structurally identical sibling (list-in-list) unmeasured and
unmentioned. This is
[a property proven of one construction asserted of its whole class](../logic-errors/one-form-property-asserted-of-whole-syntax-class-2026-09-06.md)
recurring in a THIRD shape: that document already covers it happening to a regex boundary class
and to a scope claim; here it happened to a residual's own disclosure. Fixed the same way as
every prior instance — construct the untested sibling and run it (`eas up{d,{x,y}}ate --branch
preview` measured, not inferred) — and given its own corpus row (`r4brlist-nested-list-*`) so
the class, not one member of it, is what's tracked.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — the brace-range narrow-deny block (VERB-position,
  placed next to the existing `$`/backtick expansion-token narrow deny) and its
  `_OUT_BR_RANGE_ALREADY_HANDLED` exclusion; the sibling brace-LIST narrow-deny block
  (`_OUT_BR_LIST_TOKEN`/`_OUT_BR_LIST_ALREADY_HANDLED`) placed directly after it; the
  DOCUMENTED RESIDUALS entries for both mechanisms' still-open TOOL-position halves and
  the shared nested-in-a-list residual (search "NESTED form"); `crude_smells_outward`'s
  degraded-mirror trailing-sigil class, widened with both the range and list alternatives.
- `.claude/hooks/lib/fastpath-filter.sh` — `cmd_fastpath_has`, the needle-based stage 1/2
  that (incidentally, not by design for this mechanism) already lets VERB-position
  constructions reach the precise matcher.
- `.claude/hooks/repro-outward-cli-corpus.sh` — the `r4brange-tool-*` / `r4brange-verb-*`
  generated rows and their `r4brlist-tool-*` / `r4brlist-verb-*` siblings (both share
  `R4_RSP_IDS`'s generation loop), plus the `r4brlist-nested-*` /
  `r4brlist-nested-list-*` residual axes; NOTE6's attribution of which halves are closed.
- `todos/archive/P2-2026-09-14-brace-list-expansion-reconstructs-a-gated-verb.md` — the
  brace-LIST todo this section documents.
- `.claude/hooks/test-guard-outward-cli.sh` — the brace-range positives, the
  already-documented-boundary controls (pinning the pre-existing check's OWN reason), and
  the `assert_allow` false-positive bounds (numeric loop ranges, comma-form braces, bare
  `find -exec {}` placeholders, non-command-position ranges).

## See Also

- [dollar-sigil-not-stripped-by-fastpath-prefilter](dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — the sibling lockstep failure for the `$`-sigil family this mechanism is NOT a spelling of.
- [../logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md](../logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md) — the already-documented "range after an intact verb" boundary-closer shape this mechanism must not be confused with or re-deny under a different reason.
- [../logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md](../logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md) — the reason-attribution collision this fix hit during its own construction.
- [../logic-errors/one-form-property-asserted-of-whole-syntax-class-2026-09-06.md](../logic-errors/one-form-property-asserted-of-whole-syntax-class-2026-09-06.md) — the general shape of "a property proven of one construction asserted of its whole class," which this document's own single-vs-multi-value-range ruling deliberately avoids by denying both identically rather than asserting one is safe.
