---
title: "Verification streak premium unlocks (actual feature unlocks, not just display)"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-18
assignee:
labels: [deferred, product]
github_issue:
---

# Verification streak premium unlocks (actual feature unlocks, not just display)

## Summary

Grant a real premium feature unlock to free-tier users who maintain a verification
streak. Product decisions are now made (see below) — this is implementation work.

## Product Decisions (2026-05-18)

- **Feature unlocked:** `extendedPlanRange` only.
- **Threshold:** verification streak `>= 7` consecutive UTC days.
- **Duration:** active _while the streak stays alive_. The unlock is purely
  **derived** from the current streak — when the streak drops below 7 the unlock
  disappears on the next feature resolution. No grant table, no expiry job, no
  persisted state.
- **Priority bumped low → medium:** this changes which features a `free` user can
  access (revenue-affecting gating code), so it ships via a reviewed PR, not a
  direct-merge low-priority branch.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding L2). Verification
streak _tracking_ and _display_ already exist:

- `getUserVerificationStats(userId)` (storage facade) returns `{ count,
frontLabelCount, compositeScore, streak }`; `streak` is computed in
  `server/storage/verification.ts:117-157` as consecutive UTC days with >=1
  verification.
- This todo adds the _functional unlock_ on top of that display.

## Acceptance Criteria

- [ ] Add `VERIFICATION_STREAK_UNLOCK_THRESHOLD = 7` and a pure helper
      `applyStreakUnlocks(features: PremiumFeatures, streak: number): PremiumFeatures`
      to `shared/types/premium.ts`. The helper returns a **copy** of `features` with
      `extendedPlanRange: true` when `streak >= VERIFICATION_STREAK_UNLOCK_THRESHOLD`,
      otherwise returns `features` unchanged. It must never downgrade a feature a user
      already has (only ever flips `extendedPlanRange` to `true`).
- [ ] Apply the override at **all three** feature-resolution sites — the unlock is
      meaningless unless the _enforcing_ site (#3) honors it:
  1. `server/routes/subscription.ts:59` — `GET /api/subscription/status`, the
     `features` field consumed by the client `PremiumContext`.
  2. `server/services/subscription-tier-cache.ts:43` —
     `resolveSubscriptionTierFeatures()`, used for general server-side gating.
     Apply inside the cache-miss path so the streak-adjusted result is covered by
     the existing 60s TTL.
  3. `server/routes/grocery.ts:98-101` — the **actual enforcement point** for
     meal-plan range (`maxDays = ...extendedPlanRange ? 90 : 7`).
- [ ] Use `storage.getUserVerificationStats(userId).streak` as the streak source —
      the same value the existing verification badge uses, so the unlock and the
      displayed streak never disagree (this naturally includes the existing
      "yesterday counts as streak start" lookback in `verification.ts:147-149`).
- [ ] Perf: `subscription.ts` and `grocery.ts` routes are NOT cached. To avoid a
      `getUserVerificationStats` query on every poll, add a small 60s-TTL streak cache
      helper (mirror the `subscription-tier-cache.ts` Map+TTL pattern) and use it at
      those two sites. The `subscription-tier-cache.ts` site is already cache-covered.
- [ ] AC4 — surface the unlock state: add `streakUnlocks: PremiumFeatureKey[]` to
      the `SubscriptionStatus` interface (`shared/types/premium.ts`) and populate it in
      the `/api/subscription/status` response (the features currently granted via
      streak — `["extendedPlanRange"]` when unlocked, `[]` otherwise). Expose it
      through `PremiumContext`, and show one short line near the existing verification
      streak display (`client/components/VerificationBadge.tsx` or its host) such as
      "Extended meal planning unlocked by your 7-day streak". Keep the UI to a single
      small text element — minimal change, no new screens.
- [ ] Tests: cover `applyStreakUnlocks` (below threshold, at threshold, above; does
      not clobber other features; premium users unaffected). Add a route-level test
      that a free user with `streak >= 7` gets `extendedPlanRange: true` from
      `/api/subscription/status` and a free user with `streak < 7` does not.

## Implementation Notes

- Premium system is **binary** (`free`/`premium`); `features` come straight from
  `TIER_FEATURES[tier]`. There is no per-user feature-override layer — this todo
  introduces a derived one (`applyStreakUnlocks`), not a persisted one.
- Do **NOT** route `subscription.ts`'s `features` through
  `resolveSubscriptionTierFeatures()` to "share the cache" — that resolver resolves
  tier from `subscription.tier` _without_ the route's premium-expiry check
  (`subscription.ts:48-54`), so reusing it would regress expired-premium handling.
  Keep the three sites independent; share only the pure `applyStreakUnlocks` helper
  and the streak-cache helper.
- Out of scope (do NOT fix here, just leave alone): `resolveSubscriptionTierFeatures`
  not applying the premium-expiry downgrade is a pre-existing latent issue,
  unrelated to this todo.

## Dependencies

- None. Premium system and verification streak tracking both already exist.

## Risks

- The enforcing site is `grocery.ts` — if the override is applied only to the
  status route and the tier cache, the unlock will _display_ but not _function_.
  The route-level test (AC) guards the status side; verify `grocery.ts` honors it
  by reading the changed code.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding L2).

### 2026-05-18

- Product decisions made (feature = `extendedPlanRange`, threshold = 7 days,
  duration = while-streak-alive). Respecced with concrete architecture; priority
  bumped low → medium so it ships via a reviewed PR.
