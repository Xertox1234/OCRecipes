---
title: "CodeQL js/clear-text-logging flags the generic error logger because error-code names contain MFA/PASSWORD"
track: knowledge
category: conventions
module: server
tags: [codeql, code-scanning, logging, false-positive, security, auth]
applies_to: [server/routes/_helpers.ts, shared/constants/error-codes.ts, server/routes/**/*.ts]
created: 2026-10-11
---

# CodeQL js/clear-text-logging flags error-code names

## When this applies

A CodeQL `js/clear-text-logging` alert (high severity) points at the generic
error logger in `server/routes/_helpers.ts`:

```ts
logger.error({ err: toError(error) }, `${context} error`);
```

The alert message lists error-code constants as the "sensitive data", for example:

```
This logs sensitive data returned by an access to MFA_NOT_ENABLED as clear text.
This logs sensitive data returned by an access to PASSWORD_UPGRADE_NEEDED as clear text.
```

## Why

The rule decides what is sensitive from **names**. Any property or constant
whose name contains words like `password`, `mfa`, `secret` or `token` counts as
a source. Our `ErrorCode` values (`MFA_NOT_ENABLED`, `MFA_NEEDS_PASSWORD`,
`PASSWORD_UPGRADE_NEEDED`, …) are fixed labels, the same for every user. They
flow into error objects that reach the logger, and CodeQL treats each one as a
leaked secret.

Alert #248 (opened 2026-10-10 with 2FA part 1, gained `PASSWORD_UPGRADE_NEEDED`
with password policy part 2) was this. It was dismissed as a false positive on
2026-10-11.

## What to do

1. **Check what actually reaches the log line.** Follow each listed source. If
   every one is an `ErrorCode` constant or other fixed label, it is this false
   positive.
2. **Dismiss it per alert:**

   ```bash
   gh api -X PATCH repos/<owner>/<repo>/code-scanning/alerts/<id> \
     -f state=dismissed -f dismissed_reason='false positive' \
     -f dismissed_comment='Flags fixed error-code labels (MFA_*, PASSWORD_*) as secrets; no password, code or token reaches this log line.'
   ```

   The guard blocks mutating `gh api` calls from the agent, so the owner runs
   this with `!`.

3. **Do not rename the error codes** to dodge the heuristic. They are a shared
   contract between server and app. A rename means a server deploy and an OTA
   just to quiet a tool.

## Exceptions

- If any listed source is a real value — a request body field, a password, a
  TOTP code, a recovery code, a token, a pass, an email — it is a **real
  finding**. Remove the value from the log or redact it. Do not dismiss.
- A new `MFA_*` or `PASSWORD_*` code can raise the alert again on a different
  line, or add sources to an existing one. Re-run step 1 each time; the earlier
  dismissal does not cover a new line.
- Prefer per-alert dismissal over a query-level suppression, so the rule stays
  live for a genuine leak.

## Related Files

- `server/routes/_helpers.ts` — `handleRouteError`, the flagged `logger.error`
- `shared/constants/error-codes.ts` — the `ErrorCode` constants CodeQL lists

## See Also

- `docs/solutions/conventions/codeql-missing-rate-limiting-untraceable-factory-2026-06-26.md` — another CodeQL heuristic false positive, handled the same way
