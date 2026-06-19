---
title: "Reuse a single Resend client instead of constructing one per send"
status: backlog
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, performance, api]
github_issue:
---

# Resend client lazy singleton

## Summary

`server/services/email.ts` `client()` does `new Resend(key)` on every send. Each
construction spins up the SDK's internal HTTP client. Promote to a module-level
lazy singleton.

## Background

From the PR #403 review (SUGGESTION). Sends are fire-and-forget and low-volume, so
the cost is negligible today — pure tidiness / micro-optimization.

## Acceptance Criteria

- [ ] `client()` returns a cached `Resend` instance, created once on first use
      when `RESEND_API_KEY` is present, `null` otherwise.
- [ ] The `email.test.ts` no-op/throttle/send tests still pass (they
      `vi.resetModules()` + `vi.stubEnv` per test, which re-imports the module and
      naturally resets a module-level singleton — confirm this holds).

## Implementation Notes

```ts
let _resend: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return (_resend ??= new Resend(key));
}
```

- `server/services/email.ts`. Note: because the key is read once and cached, a
  test (or runtime) that flips `RESEND_API_KEY` after first use would keep the old
  client — acceptable since the predicate `emailVerificationEnabled()` still gates
  every send, and the existing tests reset modules.

## Dependencies

- Builds on the email-verification feature (PR #403).

## Risks

- Low — verify the module-reset test isolation assumption holds before merging.
