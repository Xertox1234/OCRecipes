---
title: 'A comment/string-aware guard lexer must redact before its content predicate, not just its structural parsing'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [testing, guard-script, static-analysis, fast-check, lexer, fail-open, regex]
symptoms: [a text-based guard test asserting "file X must contain required-keyword" passes on a file whose only occurrence of required-keyword is inside a comment or an unrelated string value, the guard's own regression-test fixtures never put the literal checked keyword inside a string/comment so the gap is invisible in its own test suite, a hand-rolled paren/brace/comma lexer correctly skips string and comment content for balancing and splitting but a separate boolean regex check downstream runs against the raw unstripped text]
applies_to: ['scripts/__tests__/*-guard.test.ts', 'scripts/**/*.ts']
created: '2026-07-12'
---

## Problem

`scripts/__tests__/fast-check-property-seed-guard.test.ts` (PR #604) is a static guard that
flags any `fc.assert(...)`/`fc.check(...)` call lacking a pinned `seed:` key, either inline or
via a referenced `const IDENT = { seed: ... }` params object. To avoid false matches from stray
parens/commas inside assertion strings or comments, it built a small comment/string-aware lexer
(`skipStringOrComment`, `findOpaqueSpans`, `extractBalanced`, `splitTopLevelArgs`) and used it
correctly everywhere the STRUCTURE mattered: balancing the call's parens, splitting its
top-level arguments, and matching `const` declarations without being fooled by a commented-out
fake one.

But the actual pass/fail predicate — `/\bseed\s*:/.test(configText)` for the call's config
args, and `/\bseed\s*:/.test(body)` for a referenced const's object body — ran against the raw,
unstripped slice returned by that same lexer. A `seed:` substring landing inside a trailing
comment (`{ numRuns: 100 /* seed: omitted for now */ }`) or an unrelated string field
(`{ numRuns: 100, note: "seed: fixed elsewhere" }`) silently satisfied the check on a call/const
that pins no real seed — the exact defect class (an unseeded property test masking a real bug as
a flake on `retry: 2`) the guard exists to catch, now able to hide from the guard itself.
Verified empirically: both fixtures returned zero offenders before the fix.

## Symptoms

- A text-based guard test asserting "file X must contain required-keyword" passes on a file
  whose only occurrence of `required-keyword` is inside a comment or an unrelated string value.
- The guard's own regression-test fixtures never put the literal checked keyword inside a
  string/comment, so the gap is invisible in its own test suite even after several review
  rounds that hardened the structural parsing.
- A hand-rolled paren/brace/comma lexer correctly skips string and comment content for
  balancing and splitting, but a separate boolean regex check downstream runs against the raw
  unstripped text returned by that lexer.

## Root Cause

Building comment/string-aware span-skipping for STRUCTURAL parsing (so a `(` or `,` inside a
string can't desync nesting depth or argument boundaries) does not automatically make a
downstream CONTENT regex (checking whether a required keyword is present) comment/string-safe.
The two need the same treatment but are easy to reason about separately — the structural lexer
was reviewed and hardened twice (fixing an unbalanced-paren-in-string bug and a
commented-out-fake-`const` shadowing bug), and both times the fix was applied to the structural
parsing functions, not to the final `seed:` presence check that consumes their output.

## Solution

Add a `redactOpaqueSpans(src)` helper that reuses the existing `findOpaqueSpans` lexer to blank
every string/comment span (replace each character with a space, preserving length/offsets) and
run the content-presence regex against the redacted text instead of the raw slice:

```ts
function redactOpaqueSpans(src: string): string {
  const chars = src.split("");
  for (const [start, end] of findOpaqueSpans(src)) {
    for (let i = start; i < end; i++) chars[i] = " ";
  }
  return chars.join("");
}
```

Apply it at both check sites (`redactOpaqueSpans(configText)` before `hasInlineSeed`,
`redactOpaqueSpans(body)` before the referenced-const check), and add regression fixtures with
the checked keyword placed inside a comment and inside a string value — verified to fail against
the pre-fix logic and pass against the fix (confirmed by temporarily reverting the redaction
calls and re-running the new fixtures).

## Prevention

Whenever a guard script builds a comment/string-aware span-skipping lexer for structural
parsing, audit every downstream boolean/content regex that consumes the lexer's output and
confirm it also runs against redacted (not raw) text — a structural fix and a content fix are
not the same fix. When reviewing or extending a guard like this, write at least one regression
fixture that places the literal checked keyword inside a comment or string in the exact region
being scanned; a lexer's own test suite is not proof of comment-safety unless one fixture
exercises that specific trap. This repo has at least two sibling static-analysis guards with a
similar comment/string-aware structural lexer that are worth spot-checking against this same
class of gap during a future review pass (not audited as part of this fix):
`scripts/__tests__/worklet-directive-guard.test.ts` and
`scripts/__tests__/todo-automerge-guard.test.ts`.

## Related Files

- `scripts/__tests__/fast-check-property-seed-guard.test.ts` — the guard fixed here
  (`redactOpaqueSpans`, `findSeededIdentifiers`, `findUnseededCalls`)
- `docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md`
  — the seed-pinning convention this guard enforces
- `scripts/__tests__/worklet-directive-guard.test.ts` — sibling guard, unaudited follow-up
  candidate for the same class of gap
- `scripts/__tests__/todo-automerge-guard.test.ts` — sibling guard, unaudited follow-up
  candidate for the same class of gap

## See Also

- [fail-open-scanner-wrapper-error-envelope-not-clean-scan-2026-07-12.md](fail-open-scanner-wrapper-error-envelope-not-clean-scan-2026-07-12.md)
  — a different fail-open trap (nullish-coalescing collapses "tool errored" into "tool found
  nothing") in the same broad family: a guard/scanner silently reporting a clean result instead
  of flagging its own inability to check correctly
