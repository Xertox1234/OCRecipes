---
title: "A fast-path pre-filter's 'superset by construction' proof must be re-verified every time the matcher it gates learns to consume a new character"
track: knowledge
category: conventions
tags: [harness, parsing, shell-quoting, security, performance]
module: server
applies_to: [".claude/hooks/**"]
created: 2026-08-17
last_updated: 2026-09-06
---

# A fast-path pre-filter's superset proof must be re-verified when the matcher's character set changes

## When this applies

A cheap "necessary substring" pre-filter gates an expensive precise matcher: the
pre-filter strips a fixed set of characters the precise matcher can delete/insert,
re-tests for the needle, and only invokes the expensive matcher on a hit. The
pre-filter's soundness argument is "strip the same characters the matcher can consume,
so the pre-filter's positive set is a strict superset of the matcher's."

## Rule

That superset proof is a claim about TWO pieces of code staying in lockstep — the
matcher's character-consumption set, and the pre-filter's strip set — and it silently
breaks the moment either one changes without the other. Every time the matcher gains
the ability to consume/synthesize a NEW character, every pre-filter that gates it must
be re-audited (and, in this codebase, re-audited at EVERY call site — the filter was
copy-pasted seven times, not shared), not just the one call site where the change was
made.

## Why

This project's own hook guards demonstrate the failure twice in the same PR. First: the
fast-path filters stripped `'`, `"`, `\`, and newline to match what `cmd_words()` could
delete — correct at the time. Later in the same branch, `cmd_words()` grew a new
capability: consuming the `$` sigil immediately before an ANSI-C/locale quote
(`$'eas'` → `eas`). None of the seven fast-path filters were updated to strip `$` too,
so a command split as `g$'h' pr create --fill` reconstructed correctly under
`cmd_words()` (which the precise matcher would have caught) while remaining invisible
to every fast path (which exits before the precise matcher ever runs) — silently
allowing the exact class of bypass the whole mechanism exists to close.

The comment justifying the filter ("four literal substitutions... a superset by
construction") stated a TRUE fact about the matcher's character set AT THE TIME IT WAS
WRITTEN. It did not — and structurally could not — remain true automatically when the
matcher changed later; nothing forced a re-check.

## Examples

**Before (the bug):**
```bash
_T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}
case "$_T" in *gh*pr*create*) _PRE=1 ;; esac
```

**After (the fix — one of seven identical call sites that all needed the same edit):**
```bash
_T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}; _T=${_T//\$/}
case "$_T" in *gh*pr*create*) _PRE=1 ;; esac
```

## The corollary: a fix in the right file can still be UNREACHABLE (added 2026-09-06)

The rule above is about a pre-filter that STRIPS characters. The same lockstep failure has a
second form, and it is worth stating separately because it changes **where a fix has to
land**, not merely whether two lists agree:

> **A correct fix in the right file is still unreachable when a pre-filter upstream of it
> declines on a NARROWER signal than the fix's own grammar.**

`guard-outward-cli.sh`'s stage-3 pre-filter does not strip; it DECLINES its cheap exit for any
command containing `${`, `$(` or a backtick, on the argument that no construct the matcher can
neutralise exists without one of those digraphs. True when written. Then
`cmd_words_vanished` learned to delete SPECIAL parameters (`$!`, `$@`, `$*`, `$1`–`$9`) and to
decode ANSI-C respellings (`$'\x65'`) — none of which carries any of the three digraphs. So:

```
e$1as update --branch preview     # a real OTA publish to end users
  stage 1 (raw needle)      miss
  stage 2 (stripped needle) miss   -- stripping `$` gives `e1as`, never `eas`
  stage 3 (digraph decline) CHEAP EXIT
  => ALLOWED, before cmd_words_vanished was ever computed
```

The trap is that **two separate places named the wrong single fix location and both read as
authoritative**: the tracking todo's acceptance criteria, and the guard's own DOCUMENTED
RESIDUALS, which asserted "the fix is in lib/cmd-detect.sh's allow-list". Necessary, not
sufficient — and nothing in the allow-list's own file could have revealed that, because
reachability is a property of the call path, not of the file where the logic belongs.

**How to check it in five minutes, before writing the fix.** Do not reason about the pre-filter
from its comment — run it on the construction and see which branch decides:

```bash
. .claude/hooks/lib/fastpath-filter.sh
cmd_fastpath_has 'e$1as update --branch preview' '*eas*' '*gh*' '*npm*'; echo "stage1/2 rc=$?"
case 'e$1as update --branch preview' in *'${'*|*'$('*|*'`'*) echo DECLINE ;; *) echo cheap-exit ;; esac
```

Then apply the smallest widening and a single arm of the real fix, run ONE construction
end-to-end, and read the deny **REASON** — not the verdict. A deny from an unrelated ambiguity
branch looks exactly like success and means the intended mechanism never fired.

**Widen on a measured cost, not an asserted one.** The previous residual declined to widen
because "`$` alone appears in a large share of real commands" — true of a bare `$`, false of
the narrow set actually needed. Measured over 28,469 real Bash tool calls harvested from this
project's transcripts: the three original digraphs match 13.0%; adding `$!`, `$@`, `$*`,
`$'` and `$<digit>` pushes only **0.8% (238 commands) newly onto the slow path**, about
+0.7 ms on the average call. Harvest and count before accepting a cost objection.

## Exceptions

None — this is a structural risk inherent to duplicating a "superset by construction"
filter anywhere it isn't literally the same function call. The durable fix (filed as
`todos/P3-2026-08-16-extract-shared-fastpath-filter-helper.md`, not yet done as of this
writing) is to make the strip set a single shared function the matcher and every
pre-filter both call through, so a future character addition is one edit instead of
seven kept in sync by inspection.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words()`'s `$`-sigil consumption (the
  capability that outran its pre-filters).
- `.claude/hooks/{branch-preflight,commit-verify,core-bare-guard,drift-detect,
  drift-detect-update,guard-outward-cli,pr-preflight-guard}.sh` — the seven duplicated
  fast-path filters, all needing the identical one-line fix.
- `.claude/hooks/test-cmd-detect.sh` — the "EVERY hook's fast path must be
  quote-tolerant" self-check exists for exactly this failure mode, but only verifies
  the pattern's textual PRESENCE (`grep -q '_T=\${CMD//'`), not its correctness — a
  hook could satisfy the meta-test with an incomplete strip set and still show green.

## See Also

- [Empty quote-span mid-word vs standalone](../logic-errors/empty-quote-span-closing-check-needs-mid-word-vs-standalone-2026-08-17.md) — a sibling bypass in the matcher this pre-filter gates, found in the same review round.
- [Degraded fallback paths lag the primary path's hardening](degraded-fallback-path-needs-same-hardening-as-primary-path-2026-08-17.md) — the same "two code paths must stay in lockstep" failure shape, one layer over.
