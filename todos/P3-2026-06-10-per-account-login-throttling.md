---
title: "Per-account login throttling (failed-attempt counter per username)"
status: backlog
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, security]
github_issue:
---

# Per-account login throttling

## Summary

`loginLimiter` is IP-keyed only; even with correct per-client keying and IPv6 /56 bucketing (PR #393), a distributed attacker rotating source IPs against a single account is unthrottled. Add a per-username failed-attempt control.

## Background

Surfaced as a SUGGESTION in the 2026-06-10 security audit's S3 per-fix review (manifest: `docs/audits/2026-06-10-security.md`, Deferred Items). IP-keyed limiting can never fully stop distributed credential attacks regardless of subnet choice — the stronger brute-force control is account-scoped. Pre-existing gap, not introduced by PR #393.

## Acceptance Criteria

- [ ] Repeated FAILED login attempts against the same username are throttled independently of source IP (e.g. N failures per window → temporary lockout or backoff for that username)
- [ ] Successful login resets/does not count toward the counter
- [ ] Response for a throttled account is indistinguishable in timing/shape from the generic rate-limit response (no account-existence oracle — keep parity with the existing "same response as missing" security rule)
- [ ] Unit tests: failure-count increment, reset on success, lockout threshold, no oracle leak
- [ ] The existing IP-keyed `loginLimiter` stays in place (defense layers compose)

## Implementation Notes

- Route: `server/routes/auth.ts` (login handler); limiter defs in `server/routes/_rate-limiters.ts`.
- express-rate-limit CAN key by `req.body.username` (keyGenerator runs after body parsing), but counting only _failed_ attempts needs either `skipSuccessfulRequests: true` (library-supported — evaluates after response) or a small storage-backed counter. Prefer `skipSuccessfulRequests: true` with a username-keyed limiter as the minimal approach; normalize the username (lowercase/trim) in the key.
- Beware: username comes from unvalidated body at keyGenerator time — cap length and coerce to string before keying (an object/array body field must not throw).
- In-memory store is acceptable (single Railway instance — see `project_deployment_plan_railway_cloudflare`); revisit if Redis lands.

## Dependencies

- None (single-instance in-memory store is fine today).

## Risks

- Account-lockout DoS: an attacker can deliberately lock out a victim's username. Mitigate with short windows/backoff rather than hard lockout, and keep the threshold well above typical typo counts (e.g. 10/15min per username).

## Updates

### 2026-06-10

- Initial creation (deferred from `/audit security` 2026-06-10, S3 review SUGGESTION)
