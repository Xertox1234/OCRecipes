---
title: String.replace with a string replacement expands $&, $` and $' — a redaction that swaps a message for its redacted form can paste the secret back
track: bug
category: logic-errors
module: server
severity: medium
tags: [security, typescript, javascript, redaction, logging, sql]
symptoms: ["a redacted string still contains the value that was cut", "the bug appears only when the replacement text contains a dollar sign, such as a SQL placeholder"]
applies_to: [server/lib/logger.ts, server/lib/error-reporter.ts, "server/lib/**/*.ts"]
created: '2026-11-19'
---

# String.replace with a string replacement expands dollar patterns

## Problem

`redactChain` in `server/lib/logger.ts` rewrote an error's stack with
`error.stack.replace(error.message, message)`, where `message` is the redacted form of
`error.message`. For a statement containing `$&` or `$'` the redacted stack contained the
bound values again.

## Symptoms

- The redacted output still contains the secret, but only for some inputs.
- Ordinary inputs pass every test: the trigger is a `$` followed by `&`, `` ` ``, `'`, `$`
  or a digit in the replacement text.

## Root Cause

When the second argument to `String.prototype.replace` is a **string**, JavaScript treats it
as a template even if the first argument is a plain string and not a regex:

| Pattern | Inserts                          |
| ------- | -------------------------------- |
| `$&`    | the matched text                 |
| `` $` `` | the text before the match        |
| `$'`    | the text after the match         |
| `$$`    | a literal `$`                    |

Here the matched text is the unredacted message, so `$&` in the replacement inserts the
whole thing back, and `$'` inserts whatever follows it. SQL text is full of `$1`, `$2`
placeholders; those are harmless with a string pattern (no capture groups), which is why
the bug hides until a statement happens to contain `$&` or `$'`.

## Solution

Pass a function. A function's return value is inserted as-is:

```ts
safe.stack = error.stack?.replace(error.message, () => message);
```

## Prevention

- Whenever the replacement text is not a literal you wrote (user input, SQL, a message from
  another system), use the function form of `replace` / `replaceAll`.
- Test a redaction with an input that contains `$&` and `$'`, and assert the marker value
  is absent from the result.

## Related Files

- `server/lib/logger.ts` — `redactChain`
- `server/lib/__tests__/logger.test.ts` — "a statement containing replacement patterns"

## See Also

- [A redacting pino err serializer covers one key on one logger](pino-err-serializer-misses-other-keys-pino-http-and-wrapped-causes-2026-11-19.md) — the PR this was found in
