---
title: "A sanitiser that truncates and then substitutes can return more characters than its cap"
track: bug
category: logic-errors
tags: [ai-prompting, security, architecture, typescript, sanitization, zod]
module: server
applies_to: ["server/lib/ai-safety.ts", "server/services/recipe-finder/**/*.ts"]
symptoms: ["a field passed through sanitizeContextField(text, N) is longer than N", "a schema with .max(N) rejects a block built from sanitised text, but only for inputs containing an injection-looking token", "a cap test passes with plain text and fails with '[INST]' or 'ignore previous instructions' in the input"]
created: 2026-10-09
severity: medium
---

# A sanitiser that truncates and then substitutes can return more characters than its cap

## Problem

`sanitizeContextField(text, maxLen)` in `server/lib/ai-safety.ts` slices to `maxLen` **first**. It then
runs `sanitizeUserInput`, which replaces known injection patterns with the literal `[filtered]`. That
replacement is longer than some of the patterns it replaces (`[INST]` is 6 characters, `[filtered]` is
10), so the output can be longer than the `maxLen` the caller asked for.

The coach recipe offer (#1330) passed sanitised ingredient strings into a block whose Zod schema caps
each one at 60 characters. The task reviewer caught, before it shipped, that an ingredient containing
`[INST]` near the cap could come back at up to 64 characters. The schema would then reject the whole
block and the offer would fail.

## Symptoms

- A field passed through `sanitizeContextField(text, N)` is longer than N.
- A `.max(N)` schema rejects a block built from sanitised text, but only when the input contains an
  injection-looking token.
- Cap tests pass with plain text, because plain text never triggers the substitution.

## Root Cause

The cap and the substitution happen in the wrong order for a caller that relies on the cap. Truncating
first is right for the sanitiser's own job, since it bounds the regex work. But the substitution can
grow the string afterwards, so `maxLen` limits the **input** to the substitution, not the **output**.

## Solution

Re-cap at the call site after sanitising, whenever the result feeds a length-validated schema or a
fixed-size prompt slot:

```ts
// server/services/recipe-finder/offer.ts
sanitizeContextField(i, INGREDIENT_MAX).slice(0, INGREDIENT_MAX).trim();
```

Where the schema's bound is the contract, sanitise to `max + 1` and let the schema reject anything over
`max`, as `parseDish` does with `DISH_MAX + 1`. Do not assume the sanitiser's argument is an output
bound.

## Prevention

- When a test checks a length cap on sanitised text, include an input that triggers the substitution
  (`[INST]`, "ignore previous instructions") close to the cap. A plain-text input cannot fail that test.
- The INJECTION_PATTERNS regexes have no `g` flag, so each pattern substitutes at most once and the
  overshoot is small: a few characters per pattern. It is still enough to break an exact `.max(N)`.

## Related Files

- `server/lib/ai-safety.ts` — `sanitizeContextField` (slice, strip, then `sanitizeUserInput`)
- `server/services/recipe-finder/offer.ts` — the re-capped ingredient map and `parseDish`'s `+ 1`
- `server/services/recipe-finder/adjust.ts` — per-item caps on the adjust card's fields

## See Also

- [AI input sanitisation boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md) — which sanitiser applies where
