---
title: "Server log lines for a failed query carry every bound value, including health data"
status: backlog
priority: medium
created: 2026-11-16
updated: 2026-11-16
assignee:
labels: [security, privacy]
github_issue:
---

# Server log lines for a failed query carry every bound value, including health data

## Summary

When a database statement fails, the server error log records every value bound to it, next to
the user id. For profile and coach writes those values are health data. Sentry is already
scrubbed; the pino log line is not.

## Background

Found by the security review of PR 1890 (family profiles, 2026-11-16), measured with the real
`DrizzleQueryError` class and pino's default error serializer.

- Drizzle wraps a failed statement in a `DrizzleQueryError` whose message ends with
  `\nparams:` followed by every bound value.
- `handleRouteError` (`server/routes/_helpers.ts`) logs `err: toError(error)` unchanged, and the
  logger mixin adds `userId`.
- `scrubEvent` in `server/lib/error-reporter.ts` cuts the `\nparams:` tail (and redacts quoted
  inputs in the pg cause) before an event reaches Sentry. Nothing does the same for the log.

PR 1890 closed this for the two family-profile write routes only, with a local
`withoutBoundValues` in `server/routes/family.ts`. Every other route still logs bound values:
the user's own allergies and health conditions on `PUT /api/user/dietary-profile`, coach
message text, and so on. It needs a database failure to occur, not an attacker, and exposes
nothing across users; the exposure is to whoever can read the server logs.

## Acceptance Criteria

- [ ] A failed Drizzle statement logged through `logger.error` (any route, service or
      background job) never includes the `\nparams:` tail.
- [ ] The pg cause's quoted inputs are redacted in the log the same way `scrubEvent` redacts
      them for Sentry, from one shared function so the two cannot drift.
- [ ] The log line still says which statement failed and keeps the pg error code.
- [ ] A test builds a real `DrizzleQueryError`, runs it through the real logger serializer, and
      asserts a marker value is absent; with a control that the marker is present before the fix.
- [ ] `withoutBoundValues` in `server/routes/family.ts` is removed once the logger covers it,
      and `server/routes/__tests__/family.log-redaction.test.ts` still passes.

## Implementation Notes

Fix it once at the logger: a pino `err` serializer in `server/lib/logger.ts`, or inside
`toError`. Reuse the redaction logic already in `scrubEvent`; extract it rather than copying.

## Scope Contract

- **Mechanisms to use:** a pino `err` serializer or `toError`; the redaction already in `scrubEvent`.
- **Files in scope:** `server/lib/logger.ts`, `server/lib/error-reporter.ts`, `server/routes/family.ts`,
  and their tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR 1890 need not merge first; if it has not, skip the last acceptance criterion.
