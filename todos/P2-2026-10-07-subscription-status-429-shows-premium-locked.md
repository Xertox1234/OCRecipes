---
title: "A rate-limited subscription status call shows a premium user's features as locked"
status: backlog
priority: medium
created: 2026-10-07
updated: 2026-10-07
assignee:
labels: [deferred, client, iap]
github_issue:
---

# A rate-limited subscription status call shows a premium user's features as locked

## Summary

When `GET /api/subscription/status` returns 429, the client treats the user as free. A premium user then sees Generate and Search Spoonacular as a locked "Premium feature" until the next successful status fetch.

## Background

This came up during the coach-recipe-offer Maestro runs (Task 15, 2026-10-07). The status endpoint is limited to 10 requests per 15 minutes, and each app launch and login uses about 2. Back-to-back test runs hit the limit.

Evidence: run 6, at `scratchpad/t15-maestro/.maestro/tests/2026-10-07_065002`, and the session server log around 06:50:12.

A real user who relaunches the app several times, or a flaky network that triggers retries, could hit the same state. It looks like their subscription vanished.

## Acceptance Criteria

- [ ] A 429 (and any non-2xx or network error) on the subscription status query does not downgrade a user. The client keeps the last known tier (cached or persisted) instead of falling back to free.
- [ ] The query backs off on 429 instead of retrying immediately into the limit.
- [ ] Tests: a 429 response with a previously premium cached tier still shows premium features unlocked. A genuinely free response still locks them.

## Implementation Notes

- Find the subscription status hook or query in `client/` (grep `subscription/status`) and its error/fallback default.
- Consider whether 10 per 15 minutes is the right limit for a read-only status endpoint called on launch. Raising it is a server change. Keep it separate unless it's clearly the root cause.
- IAP is security-sensitive. Don't touch receipt validation; this is only the read path's error handling.

## Scope Contract

- **Mechanisms to use:** the existing React Query options (`placeholderData` / keep-previous / retry). Nothing new.
- **Files in scope:** the client subscription status hook/query and its test.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Keeping a stale "premium" after a real downgrade. Only keep the last known tier on errors, never on a successful "free" response.

## Updates

### 2026-10-07

- Initial creation, from the coach-recipe-offer Task 15 Maestro runs.
