---
title: "A fast-path pre-filter's 'superset by construction' proof must be re-verified every time the matcher it gates learns to consume a new character"
track: knowledge
category: conventions
tags: [harness, parsing, shell-quoting, security, performance]
module: server
applies_to: [".claude/hooks/**"]
created: 2026-08-17
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
