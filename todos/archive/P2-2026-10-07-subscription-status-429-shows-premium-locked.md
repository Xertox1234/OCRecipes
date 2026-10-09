---
title: "A rate-limited subscription status call shows a premium user's features as locked"
status: done
priority: medium
created: 2026-10-07
updated: 2026-10-09
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

- [x] A 429 (and any non-2xx or network error) on the subscription status query does not downgrade a user. The client keeps the last known tier (cached or persisted) instead of falling back to free.
- [x] The query backs off on 429 instead of retrying immediately into the limit.
- [x] Tests: a 429 response with a previously premium cached tier still shows premium features unlocked. A genuinely free response still locks them.

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

### 2026-10-09

- Fixed in the read path only (`PremiumContext.tsx`, `usePremiumFeatures.ts`); no receipt validation, purchase or server code touched.
- Finding: `/api/subscription/status` is NOT in the persisted query allowlist (`PERSISTED_QUERY_KEYS` = `QUERY_KEYS` in `client/App.tsx`), so a cold launch has no cached tier. Per the scope ruling no persister/allowlist entry was added: a cold launch after a 429 cannot show premium; it shows an unknown tier (features not locked) until a successful read. In-memory data from an earlier success is already kept by React Query across a failed refetch (now pinned by a test).
- New `isTierUnknown` (status query errored AND no data). `usePremiumFeature` returns true while unknown, so no "Premium feature" lock is rendered for a user never confirmed free. A successful free response still locks. Server stays the entitlement authority.
- Backoff: the app's global retry policy already never retries a 4xx (incl. 429); pinned by a test under the real policy. No server limit change.
