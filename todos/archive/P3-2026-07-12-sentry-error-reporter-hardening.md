---
title: "Sentry error-reporter: close test-coverage gaps and header-scrub hardening"
status: done
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
- Implemented by /todo executor:
  1. Added `handleRouteError` unit tests in `server/routes/__tests__/_helpers.test.ts` asserting
     `reportError` IS called on the 500 branch and NOT called on the ZodError/400 branch.
  2. Added a static source-order test in `server/lib/__tests__/error-reporter.test.ts` enforcing
     `registerRoutes` → `attachExpressErrorReporter` → `setupErrorHandler` call ordering in
     `server/index.ts`.
  3. `server/index.ts`'s `uncaughtException` handler now chains
     `Promise.all([flushErrorReporter(400), minDelay]).finally(() => process.exit(1))` plus an
     independent 1000ms backstop timer (`Sentry.flush()`'s real worst case is ~800ms — 2x the
     passed timeout, per `@sentry/core` source — not 400ms; verified via advisor + server-reviewer).
  4. `SENSITIVE_HEADER_SNIPPETS` in `server/lib/error-reporter.ts` reconciled against the
     **installed** `@sentry/core` 10.65.0 `SENSITIVE_KEY_SNIPPETS` source (not docs; verified
     byte-for-byte by two independent reviewers) — added `password`, `passwd`, `pwd`, `jwt`,
     `bearer`, `sso`, `saml`, `csrf`, `xsrf`, `credentials`, `sid`, `identity`, `set-cookie`
     (the todo's own list omitted `identity`, added here for genuine parity).
  5. Documented DECISION: Referer header-VALUE scrubbing deferred (Origin excluded entirely —
     structurally cannot carry a token). Real protecting invariant identified and documented:
     `verify-email-page.ts` renders a live token in its own URL and is opened in real browsers
     today, but emits zero external subresources, so no request ever carries it as Referer.
     Revisit trigger corrected from "day a web client ships" to "day any http(s) link/asset is
     added to a token-bearing page."
  6. AC6 (real-SDK integration test) — NOT implemented. Documented why: `vitest.config.ts`'s
     global `@sentry/node` → `test/mocks/sentry-node.ts` resolve.alias operates at the bundler
     level, before Vitest's mock layer, so `vi.unmock`/`vi.importActual` cannot recover the real
     package from within a test file. Defeating it needs a per-file resolver override (e.g. a
     second Vitest project) — out of proportion for a P3. See the DECISION comment at the top of
     `server/lib/__tests__/error-reporter.test.ts`.
  - Reviewed by code-reviewer, server-reviewer, security-auditor in parallel — zero CRITICAL
    findings across all three. One WARNING (missing independent exit backstop after an interim
    edit) was caught by the advisor and independently confirmed by server-reviewer; fixed.
  - Deferred (not auto-filed as a todo per project convention — surfaced in the PR/report
    instead): an automated drift-detection test that reads the installed `@sentry/core` snippet
    list at test time and asserts `SENSITIVE_HEADER_SNIPPETS`'s credential subset matches exactly
    — flagged as the highest-value follow-up by both code-reviewer and security-auditor, but the
    vendor file isn't resolvable via a stable import path (`ERR_PACKAGE_PATH_NOT_EXPORTED`) and a
    hard-coded nested `node_modules` path is hoisting-fragile (would false-positive on an
    unrelated `npm ci` re-hoist).
