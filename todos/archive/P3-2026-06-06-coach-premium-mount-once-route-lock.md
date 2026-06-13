<!-- Filename: P3-2026-06-06-coach-premium-mount-once-route-lock.md  (P3=low) -->

---

title: "Verify premium-gate cold-start can't lock a Pro user onto the free coach route"
status: done
priority: low
created: 2026-06-06
updated: 2026-06-06
assignee:
labels: [deferred, client-state]
github_issue:

---

# Verify premium-gate cold-start can't lock a Pro user onto the free coach route

## Summary

Confirm that `PremiumContext` can never surface `isLoading: false` while still holding the default/free feature set — because `ChatStackNavigator` evaluates `initialRouteName` once at mount, a premature "resolved-as-free" would lock a premium user onto the basic coach for the whole session. If the hole exists, close it; if the guard is already airtight, document why and add a regression test.

## Background

Deferred from the 2026-06-06 session investigating a reported "coach reverted to an old version." Root cause was **not** a code bug: the coach tab is premium-gated (Coach Pro → `CoachProScreen` rich coach; free → `ChatScreen` "NutriCoach" basic), and the symptom was transient — the app was cold-started while Metro was still doing a cache-cleared rebuild, so `/api/subscription/status` hadn't resolved when the navigator mounted. A clean relaunch fixed it.

The latent concern that remains: `ChatStackNavigator` blocks on `usePremiumContext().isLoading` precisely to avoid mounting the free route for a Pro user (`initialRouteName` is mount-once — see the comment at `ChatStackNavigator.tsx:28-30`). That guard is only sound if `isLoading` stays `true` until premium is _genuinely_ resolved. If `isLoading` can ever be `false` while the features still default to free (e.g. on query error, or initial-data/placeholder before first success), a premium user gets stuck on the basic coach until they fully restart the app. Real-world trigger would be a slow or failing `/api/subscription/status` on a cold start.

## Acceptance Criteria

- [ ] Determine whether `usePremiumContext().isLoading` can be `false` while the resolved feature set is the default/free one (specifically: before the first successful `/api/subscription/status` fetch, and on query **error**).
- [ ] If it can: ensure a premium user is never locked onto the free coach route — e.g. keep gating on "premium genuinely resolved" (not merely "not loading"), recover/re-route when `isCoachPro` flips true after mount, and treat a failed status fetch as "unknown → keep waiting/retry" rather than silently "free".
- [ ] If the guard is already airtight: add a short code comment documenting why and close as verified with no behavior change.
- [ ] Add a regression test for the cold-start path: premium account, `isLoading` true → then resolves `coachPro: true` → navigator lands on `CoachPro` and is never stuck on `ChatList`/`Chat`. Include the query-error variant.

## Implementation Notes

In scope:

- `client/navigation/ChatStackNavigator.tsx` (lines ~23-51) — the gate: `const { isLoading: isPremiumLoading } = usePremiumContext(); const isCoachPro = usePremiumFeature("coachPro"); ... initialRouteName={isCoachPro ? "CoachPro" : "ChatList"}`. `initialRouteName` is evaluated once at mount; the `if (isPremiumLoading) return <spinner>` is the only thing preventing a premature free mount.
- `client/context/PremiumContext.tsx` — how `isLoading` is derived from the `["/api/subscription/status"]` query. Key question: is it the raw query pending state (stays true until first success), and what is the value/`isLoading` on **error**? Does an error fall back to free with `isLoading: false`?
- `client/hooks/usePremiumFeatures.ts` — what `usePremiumFeature("coachPro")` returns during loading/error (likely `TIER_FEATURES.free` default from `shared/types/premium.ts`).

Reference: backend `/api/subscription/status` is correct (returns `coachPro: true` for the demo premium account); this is purely a client load-timing/error-handling question. See memory `project_coach_premium_gated_architecture`.

## Dependencies

- None.

## Risks

- Low severity and self-healing on restart; verify before changing behavior. Avoid over-correcting the loading gate in a way that adds a perceptible spinner on every Coach-tab open for the common (fast-resolve) case.

## Updates

### 2026-06-06

- Initial creation (deferred from the coach-revert investigation; see memory `project_coach_premium_gated_architecture`).
