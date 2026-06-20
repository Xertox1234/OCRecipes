---
title: "Wrap Resend email send with a timeout + 429-aware retry/backoff"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, api]
github_issue:
---

# Wrap Resend email send with a timeout + 429-aware retry/backoff

## Summary

`resend.emails.send()` has no timeout, no retry, and does not distinguish a 429
rate-limit from a transient network failure. A transient blip silently loses the
verification email (the user must re-trigger by re-registering).

## Background

Finding L6 of the 2026-06-19 full audit (reliability, class 2). Verified against
the Resend Node SDK (`resend@6.14.0`) docs + source: the SDK exposes no timeout /
AbortSignal / built-in retry; `emails.send(payload, options?)` `options` only
accepts `idempotencyKey`. Resend's own docs recommend implementing exponential
backoff for 429/5xx in application code, and surface `error.name ===
"rate_limit_exceeded"` to distinguish a rate-limit.

The current pattern is acceptable (fire-and-forget via `fireAndForget`, failure
is logged, the user already received their 201), so this is an enhancement, not a
live defect — deferred.

## Acceptance Criteria

- [ ] `sendVerificationEmail` / `sendSignupAttemptNotice` wrap the send with a
      timeout (e.g. `AbortSignal.timeout` or `Promise.race`) so a hung connection
      can't linger as a multi-minute background promise.
- [ ] Transient failures (network / 5xx) get a bounded retry/backoff; a 429
      (`error.name === "rate_limit_exceeded"`) backs off distinctly.
- [ ] Failures still log with context (preserve current `logger.error`).
- [ ] Unit test covers the timeout + a 429-vs-network branch.

## Implementation Notes

- `server/services/email.ts:50,68` — the two `resend.emails.send(...)` calls.
- Resend rate-limit + errors docs: implement backoff app-side; `error.name`
  carries `rate_limit_exceeded`.
- Keep the per-recipient throttle (`canSendTo`) and the fail-open
  `emailVerificationEnabled()` gate intact.
