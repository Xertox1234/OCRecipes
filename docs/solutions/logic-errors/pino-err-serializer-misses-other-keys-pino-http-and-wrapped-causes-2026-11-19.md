---
title: A redacting pino `err` serializer covers one key on one logger — an error under another key, pino-http's child logger, and a wrapped cause all still print a failed query's bound values
track: bug
category: logic-errors
module: server
severity: medium
tags: [security, privacy, api, pino, pino-http, drizzle, logging, health-data]
symptoms: ["a server log line contains 'params:' followed by query values", "a log line carries a pg error's detail or where field", "an error logged as { error } prints its own fields instead of type/message/stack"]
applies_to: [server/lib/logger.ts, server/lib/log-url.ts, server/index.ts, "server/services/**/*.ts", "server/routes/**/*.ts"]
created: '2026-11-19'
---

# A redacting pino `err` serializer covers one key on one logger

## Problem

PR 1932 added a pino `err` serializer that strips a failed Drizzle statement's bound values
from the server log. A security review then measured, with a marker value in every field,
that four shapes still printed the values even though the serializer was correct for the
case it was written for.

## Symptoms

- A log line with `\nparams:` and the bound values, or a pg `detail` / `where` field.
- An error logged as `{ error }` shows up as a bag of its own fields (`query`, `params`,
  `cause`) rather than `type` / `message` / `stack`.

## Root Cause

1. **Serializers are keyed by field name.** `serializers: { err }` runs only for a field
   named `err`. `logger.error({ error, conversationId }, ...)` skips it, and pino then
   JSON-stringifies the error's own enumerable fields. A `DrizzleQueryError` has `query`
   and `params` as own fields.
2. **pino-http overrides the root serializer.** `pinoHttp({ logger: rootLogger, serializers:
   { req, res } })` installs pino's standard `err` serializer on its child logger, which
   replaces the root logger's.
3. **pino-http hands a custom `err` serializer pre-serialized output.** With
   `wrapSerializers` on (the default) it calls `custom(stdSerializers.err(error))`. The value
   is no longer an `Error`, so a serializer that starts with `instanceof Error` passes it
   through untouched. The thrown error is on the `raw` property.
4. **The failed statement can sit below the top error.** A wrapper `new Error("x", { cause:
   drizzleError })` and an `AggregateError` have clean top-level messages; pino's standard
   serializer appends every cause's message and stack. A bare pg error carries values in
   `detail` and `where`, and has no `\nparams:` marker at all.

Two smaller traps met on the way:

- Redacting only the failed statement and what lies beneath it leaves a wrapper that repeats
  its cause's message (`` `saving failed: ${e.message}` ``) unredacted. Redact every message
  in a tree that contains a failed statement.
- Preserving a wrapper's message "because it carries no values" was the special case that
  leaked. The simpler rule (redact all of them) removed a flag and a branch.

## Solution

- Log caught errors as `{ err: toError(error) }`. `toError` returns a redacted copy for a
  failed statement, so it is safe under any key; the `err` key adds the serializer as a
  second layer.
- Export one `errSerializer` and give it to every pino instance. For pino-http, read `raw`:

  ```ts
  export const httpLogSerializers = {
    err(serialized: unknown) {
      const raw = (serialized as { raw?: unknown } | null)?.raw;
      return errSerializer(raw instanceof Error ? raw : serialized);
    },
    req: requestLogFields,
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  };
  ```

- Decide "needs redaction" over the whole tree (`cause` chain and `errors`), then build a
  fresh `Error` per node carrying only message, name, stack and `code`. Building fresh
  drops `params`, `query`, `detail` and `where` without listing them.
- pino's serializer copies only the top error's own fields, so hoist the pg `code` from the
  cause onto the copy or it is lost.

## Prevention

- Test through the real serializer, read from the logger
  (`rootLogger[pino.symbols.serializersSym].err`), and through a real `pinoHttp(...)`
  middleware (`middleware.logger`). A test that calls the redaction function directly
  proves none of the four shapes above.
- Keep a control that must leak (the stock `pino.stdSerializers.err`). Note its limit: the
  stock serializer never prints a cause's `detail` or an `errors` array under a cause, so
  for those shapes only a walk over the returned object's fields is evidence.
- Not covered by this fix: an error stored on a custom field of another error (not `cause`
  or `errors`), and scripts that print `err.message` with `console.error`.

## Related Files

- `server/lib/logger.ts` — `redactBoundValues`, `errSerializer`, `toError`
- `server/lib/log-url.ts` — `httpLogSerializers`
- `server/index.ts` — `setupRequestLogging`
- `server/services/notebook-extraction.ts` — the `{ error }` call site that leaked
- `server/lib/__tests__/logger.test.ts`

## See Also

- [Drizzle params reach Sentry](drizzle-query-error-message-carries-bound-params-to-sentry-2026-10-29.md) — the same message tail on the Sentry path
- [pinoIntegration ships the whole log line](pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md) — what a log line's fields become in Sentry
- [String.replace expands dollar patterns](string-replace-string-replacement-expands-dollar-patterns-2026-11-19.md) — the stack-redaction bug found in the same PR
