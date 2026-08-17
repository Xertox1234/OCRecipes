---
title: "A quote-span closing check must distinguish a mid-word empty span from a standalone one — both 'emit nothing', only one needs a placeholder"
track: bug
category: logic-errors
tags: [harness, parsing, shell-quoting, security, false-negative]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A quote-aware command renderer inserts a placeholder character for an EMPTY quoted span (e.g. '', \"\") regardless of what's on either side of it", "A verb split by an empty quote mid-word (eas u''pdate) renders as two tokens (eas uxpdate) instead of the single word real bash produces (eas update)", "A security matcher anchored on the correct verb (eas[[:space:]]+update) silently misses the split rendering — a real, executing command is ALLOWED"]
created: 2026-08-17
severity: critical
---

# A quote-span closing check must distinguish a mid-word empty span from a standalone one

## Problem

A hand-rolled shell-quote scanner (`cmd_words()` in `.claude/hooks/lib/cmd-detect.sh`)
renders `eas u''pdate --branch preview --platform all` as `eas uxpdate --branch preview
--platform all` — splitting a single real argv word (`update`) into two fake ones
(`uxpdate`). Every downstream deny-pattern anchored on `eas[[:space:]]+update` misses
the split rendering, so the hook exits 0 and a real OTA publish is silently allowed.

## Symptoms

- The renderer's contract claims "a quoted span is exactly one argv word," but an EMPTY
  span with real word characters directly touching it on either side violates that
  contract.
- Existing tests only pin the two extremes — a STANDALONE empty span (`--body ""`,
  flanked by separators on both sides) and a non-empty MID-WORD span (`eas up"date"`,
  content survives) — never their intersection (an empty span, mid-word).
- A mutation/adversarial test that constructs the exact failing input
  (`eas u''pdate ...`) and pipes it through the live hook reproduces the bypass
  directly; reading the awk source alone does not obviously reveal it.

## Root Cause

The scanner tracked only "did this quoted span emit any bytes into the output" —
`if (length(out) == sp) out = out PH` — to decide whether to insert a placeholder at
the closing quote. That check is correct for the STANDALONE case
(`--body ""` — flanked by separators, so an empty span vanishing would silently
absorb the argument boundary and needs a placeholder to survive as one token) but
wrong for the MID-WORD case (`u''pdate` — flanked by literal word characters on both
sides, so real bash just concatenates through the empty span with nothing inserted).
"Did the span emit anything" cannot distinguish these two shapes; the check needs to
also ask "is this span flanked by word characters or by boundaries."

## Solution

Add a second condition to the placeholder-insertion check: only insert the placeholder
when the character immediately BEFORE the opening quote (or start-of-input) AND the
raw character immediately AFTER the closing quote (or end-of-input) are BOTH
boundary/separator characters (the same `neutral()` class already used for in-span
whitespace/separators). If either side touches a real word character, emit nothing —
matching real bash's concatenation semantics.

```awk
function empty_span_needs_ph(sp,    nc) {
  nc = (i < n) ? substr(buf, i + 1, 1) : ""
  return (sp == 0 || neutral(substr(out, sp, 1))) && (nc == "" || neutral(nc))
}
# at the closing-quote transition:
if (c == SQ) { st = 0; if (length(out) == sp && empty_span_needs_ph(sp)) out = out PH }
```

`sp` (the output length recorded when the span opened) gives free access to "the
character right before the span" via `substr(out, sp, 1)`; `i` (the closing quote's
position in the input buffer) gives free access to "the character right after the
span" via `substr(buf, i+1, 1)` — no extra lookahead pass needed, both are already in
scope at the point the decision must be made.

## Prevention

When a "did this span produce any content" check drives a structural decision
(insert a placeholder / merge tokens / drop a separator), test the FOUR shapes
independently, not just two: standalone-empty, standalone-nonempty, mid-word-empty,
mid-word-nonempty. A test suite that only pins the "obvious" extremes (empty +
standalone, nonempty + mid-word) will pass while their intersection ships broken.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words()`, the three quote-state closing
  transitions (single-quote, double-quote, ANSI-C `$'...'`) all shared this bug and
  all three needed the same fix.
- `.claude/hooks/test-cmd-detect.sh` — regression pins for all three quote forms,
  mid-word and empty.

## See Also

- [$-sigil not stripped by every fast-path pre-filter](../conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — a sibling bypass class found in the same review round, same root cause shape (a filter's coverage silently narrower than the renderer it gates).
