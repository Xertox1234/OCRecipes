---
title: "A validation regex with two quantifiers over the same character class (\\d*\\.?\\d+) is quadratic on a long run with one bad character — make each alternative start differently"
track: bug
category: performance-issues
module: server
severity: high
tags: [security, performance, api]
symptoms: [The server stops answering while one request body is being validated, A z.string().regex check takes four times as long each time the input doubles, One request with a long digit string pins a CPU core]
applies_to: ["server/routes/_schemas.ts", "server/routes/**/*.ts", "shared/schemas/**/*.ts"]
created: 2026-11-15
---

# A validation regex with two quantifiers over the same character class is quadratic

## Problem

The shared number-string check in `server/routes/_schemas.ts` (behind
`numericStringField` and its siblings, which several route files use for nutrition
values) tested strings with a pattern built around `\d*\.?\d+`. On a long run of digits followed
by one character that cannot match, the test takes time proportional to the **square** of
the length. A 40 KB string took 1.6 s. Node runs the regex on the one thread that answers
every request, and the JSON body limit is 2 MB, so any signed-in user could stop the
server with one request (found by the security review of #1778, fixed before merge).

## Symptoms

- Time for one `.regex()` check grows ×4 per doubling of the input.
- Health checks time out while a single request is being validated.

## Root Cause

`\d*` and `\d+` can both take the same digits, and the `\.?` between them can match
nothing. So a run of n digits can be split between the two in n ways. When the character
after the run fails the match, the engine tries every split, and for each split it backs
the second quantifier off one digit at a time before giving up: n + (n−1) + … steps.
There is no nested quantifier, so the pattern does not look like the textbook
"catastrophic backtracking" shape.

The slow form never reached `main`; it was written and replaced inside #1778, and the
1.6 s figure is the one recorded in the comment on `DECIMAL_STRING`. Re-measured on
2026-11-15 (node v24.20.0) with the core shape `/^\d*\.?\d+$/` on `"1".repeat(n) + "x"`:

| n      | `/^\d*\.?\d+$/` | `DECIMAL_STRING` |
| ------ | --------------- | ---------------- |
| 20,000 | 185.6 ms        | 0.1 ms           |
| 40,000 | 743.5 ms        | 0.1 ms           |

A `.max(n)` on the string would also have bounded it, but the field had none: it was
validated as a number, so nobody thought of it as a string with a length.

## Solution

Write the alternatives so each one **starts differently**. Then the first character
decides which alternative applies and there is nothing to retry:

```ts
// server/routes/_schemas.ts
const DECIMAL_STRING = /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?$/i;
```

`\d+(?:\.\d+)?` starts with a digit; `\.\d+` starts with a dot. Inside each, a quantifier
is followed by a character the quantifier cannot take (`.`, `e`, end), so a digit run has
one way to be read.

## Prevention

- In a pattern that validates request input, look for two quantifiers that can take the
  same characters with only optional things between them (`\d*\.?\d+`, `\s*\S*\s*`,
  `[a-z]*[a-z0-9]+`). That is the shape.
- Time it at 20,000 and 40,000 characters of the repeated class plus one bad character.
  A ×4 step is quadratic.
- A string validated by `.regex()` still needs a `.max()` unless the pattern is known to
  be linear. "It is a number" is not a length bound.

## Related Files

- `server/routes/_schemas.ts` — `DECIMAL_STRING`, `boundedNumericStringField`

## See Also

- [tag-strip-regex-quadratic-on-unclosed-angle-brackets](tag-strip-regex-quadratic-on-unclosed-angle-brackets-2026-11-12.md) — the same cost from a different shape (a global scan on fetched text)
- [safety-classifier-regex-gotchas](../conventions/safety-classifier-regex-gotchas-2026-05-13.md) — `[\s\S]*` before an alternation
