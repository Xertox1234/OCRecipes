---
title: "Sentry error-reporter: close test-coverage gaps and header-scrub hardening"
status: backlog
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, server, observability]
github_issue:
---

# Sentry error-reporter: close test-coverage gaps and header-scrub hardening

## Summary

Dual review (server-reviewer + security-auditor) of PR #589 (server-side Sentry error
tracking) confirmed the core wiring and PII controls are correct, but surfaced 5
non-blocking hardening/coverage gaps worth closing as a follow-up.

## Background

All findings were WARNING/SUGGESTION-tier — reviewers explicitly recommended a deferred
low-priority todo rather than blocking the PR. Filed during the "review, fix, codify, close
all open PRs" session, 2026-07-12.

## Acceptance Criteria

- [ ] A test asserts `handleRouteError`'s 500 branch actually calls `reportError`
      (`server/routes/_helpers.ts` — currently only unit-tested in isolation, never verified
      as wired into `_helpers.ts`).
- [ ] A test (static grep or integration) enforces `registerRoutes(app)` →
      `attachExpressErrorReporter(app)` → `setupErrorHandler(app)` ordering in
      `server/index.ts` — currently correct by inspection only, unguarded against reordering.
- [ ] `server/index.ts`'s `uncaughtException` handler explicitly chains `flushErrorReporter()`
      into the `setTimeout(() => process.exit(1), 500)` path (`.finally()`-style, matching the
      graceful-shutdown path's pattern) instead of relying on the implicit 400ms-flush <
      500ms-exit-delay timing coupling.
- [ ] `SENSITIVE_HEADER_SNIPPETS` in `server/lib/error-reporter.ts` is reconciled with
      Sentry's actual `SENSITIVE_KEY_SNIPPETS` list (missing today: `password`, `passwd`,
      `pwd`, `jwt`, `bearer`, `sso`, `saml`, `csrf`, `xsrf`, `credentials`, `sid`,
      `set-cookie`) — the docstring currently claims parity it doesn't have.
- [ ] Decide whether header-VALUE scrubbing (not just header-name matching) is needed for
      `Referer`/`Origin` headers that could carry a token-bearing URL — low-risk today
      (mobile-only clients) but becomes live the day a web client ships; document the
      decision either way.
- [ ] Consider one lightweight integration test against the real `@sentry/node` SDK (not the
      `vi.mock`) asserting the final outgoing event payload — the existing unit tests mock
      Sentry entirely, so a future SDK upgrade that restructures where PII lands (exactly the
      bug class this PR fixes for the current version) wouldn't be caught.

## Implementation Notes

- `server/routes/_helpers.ts`, `server/index.ts`, `server/lib/error-reporter.ts`
- `server/lib/__tests__/error-reporter.test.ts`, `server/routes/__tests__/_helpers.test.ts`

## Dependencies

None.

## Risks

Low — all gaps are hardening/coverage improvements on code already verified correct by
direct inspection against real SDK source.

## Updates

### 2026-07-12

- Filed from dual code review of PR #589 during the "review, fix, codify, close all open PRs" session.
