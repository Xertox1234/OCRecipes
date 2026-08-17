---
title: "When you harden a primary detection path, its degraded/fallback paths need the identical hardening, not just the same intent"
track: knowledge
category: conventions
tags: [harness, security, parsing, shell-quoting]
module: server
applies_to: [".claude/hooks/**"]
created: 2026-08-17
---

# When you harden a primary path, its fallback paths need the identical hardening

## When this applies

A security-relevant check has a PRIMARY detection path (the precise, fully-featured
matcher) and one or more DEGRADED/FALLBACK paths that run when some dependency of the
primary path is unavailable — a broken interpreter, an unsourceable library, a missing
tool. The fallback exists specifically so the check still fails CLOSED (denies) rather
than silently ALLOWing when the primary path can't run.

## Rule

Every time the primary path's detection logic is strengthened (a new character
stripped, a new ambiguity guard added, a new bypass class closed), audit EVERY
fallback path that exists to cover the SAME check for the identical gap — a fallback
that was "good enough" before the primary path's upgrade is now a strictly WEAKER
version of a check that just got stronger, and an attacker (or an accidental bypass)
only needs the primary path's dependency to be unavailable to walk through the
now-comparatively-weaker gate.

## Why

One PR (`fix/cmd-words-quoting-bypass`) hardened a primary quote-scanning matcher to
strip an additional `$` sigil, closing a real bypass. A follow-up review found the
identical `$`-sigil gap independently in THREE separate fallback paths in the same PR:

1. `pr-preflight-guard.sh`'s `WORDS_BROKEN` fallback (awk present but non-functional) —
   used a 2-character quote-only strip (`${CMD//[\"\']/}`) instead of the primary
   path's 5-character strip. `g$'h' pr create --fill` on a broken-awk host silently
   skipped the preflight-stamp gate.
2. The same file's lib-unsourceable fallback — identical weaker strip, identical gap.
3. `guard-outward-cli.sh`'s `crude_smells_outward()` (the OTA-publish guard's smell
   test for when jq/awk/the lib itself is broken) — no quote-stripping at all, so the
   `$`-sigil split defeated its letter-adjacency regexes the same way it defeated the
   pre-fix primary path.

All three were pre-existing before the `$`-sigil fix landed on the primary path, and
none were updated alongside it — the primary path's own commit fixed only the one
place the reviewer happened to be looking.

## Examples

**The pattern to search for when hardening a primary path**: grep the same file (and
sibling files) for every OTHER place that implements "the same check, but weaker, for
when the real thing isn't available" — look for comments like "broken install",
"awk missing", "lib unsourceable", "crude", "smell test", "degraded", "fallback".

```bash
grep -n "broken\|unsourceable\|crude\|fallback\|degraded" .claude/hooks/*.sh
```

Then apply the identical strengthening to each match, not just the primary path.

## Exceptions

A fallback is allowed to stay a DIFFERENT SHAPE from the primary path (e.g. a crude
regex smell test vs. a precise anchored matcher) — the two don't need to be the same
implementation, only equivalently HARD to bypass with respect to the specific class of
input the primary path's hardening was defending against. Stripping punctuation before
a "crude" regex match, for instance, can only ever make that check fire MORE often —
directionally safe for a deny-only fallback even without matching the primary path's
exact strip-set precision.

## Related Files

- `.claude/hooks/pr-preflight-guard.sh` — the two fallback branches sharing one weak
  strip, now fixed to match the primary path's five-character strip.
- `.claude/hooks/guard-outward-cli.sh` — `crude_smells_outward()`, now strips
  quote/backslash/`$` before its regex scan.

## See Also

- [$-sigil not stripped by every fast-path pre-filter](dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — the primary-path instance of the same "two code paths drift out of lockstep" failure shape.
