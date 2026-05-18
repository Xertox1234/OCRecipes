---
title: "Parallelize the two storage reads in GET /api/subscription/status"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, performance]
github_issue:
---

# Parallelize the two storage reads in GET /api/subscription/status

## Summary

The `GET /api/subscription/status` handler issues two independent storage reads
sequentially — `storage.getSubscriptionStatus()` then `resolveVerificationStreak()`.
They have no data dependency and should run concurrently via `Promise.all`.

## Background

Surfaced during the PR #224 code review (verification streak premium unlocks).
PR #224 added a `resolveVerificationStreak(req.userId)` call to the status route
to derive streak-based feature unlocks. It was placed after the `effectiveTier`
computation, so it `await`s sequentially behind `getSubscriptionStatus()`.

The streak value does not depend on the subscription record — the two reads are
independent. `server/routes/grocery.ts` already does this correctly:

```ts
const [subscription, streak] = await Promise.all([
  storage.getSubscriptionStatus(req.userId),
  resolveVerificationStreak(req.userId),
]);
```

`/api/subscription/status` is a frequently polled endpoint, so the extra serial
round-trip is paid on every poll. Non-blocking, but a free latency win.

## Acceptance Criteria

- [ ] In `server/routes/subscription.ts`, hoist the `resolveVerificationStreak()`
      call into a `Promise.all` alongside `storage.getSubscriptionStatus()` so the
      two reads run concurrently.
- [ ] Preserve existing behavior exactly: the `404` "User not found" path (fires
      when `getSubscriptionStatus` returns falsy), the premium-expiry `effectiveTier`
      computation, and the `streakUnlocks` diff all stay unchanged.
- [ ] Existing `server/routes/__tests__/subscription.test.ts` streak tests still
      pass (no test changes expected).

## Implementation Notes

- Primary file: `server/routes/subscription.ts` — the `GET /api/subscription/status`
  handler.
- Reference the pattern already used in `server/routes/grocery.ts` (the
  `POST /api/meal-plan/grocery-lists` handler).
- `resolveVerificationStreak` is exported from
  `server/services/verification-streak-cache.ts`.
- Pure mechanical change — fetch both, then run the existing tier/expiry/unlock
  logic against the results. No logic changes.

## Dependencies

- None.

## Risks

- Minimal. The only ordering subtlety is the `404` guard — keep it firing on a
  falsy `getSubscriptionStatus` result; resolving the streak in parallel for a
  non-existent user is harmless (the streak query just returns 0).

## Updates

### 2026-05-18

- Initial creation (PR #224 review follow-up).
