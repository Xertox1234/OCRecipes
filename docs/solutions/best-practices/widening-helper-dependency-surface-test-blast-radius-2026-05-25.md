---
title: 'Widening a shared helper''s dependency surface — verify callers'' tests, not just the unit''s'
track: knowledge
category: best-practices
module: server
tags: [testing, mocking, refactoring, tanstack-query, route-tests]
applies_to: [server/routes/_helpers.ts, server/lib/**/*.ts, server/services/**/*.ts]
created: '2026-05-25'
---

# Widening a shared helper's dependency surface — verify callers' tests, not just the unit's

## When this applies

You are editing a helper function called by many existing routes/components (e.g. `getPremiumFeatures`, `apiRequest`, `requireAuth`). The change *adds a new dependency call* to the helper — a new `storage.X()` lookup, a new service call, a new module-level singleton read. The helper's own unit tests pass, including the tests for the new behavior.

**Run the callers' tests before you commit.** A passing helper test is not evidence the change is safe; route/component tests that mock the helper's *previous* dependency set will break when the new dependency is unmocked and throws on access.

## Why

Route test files in this project mock the storage facade per-test:

```ts
vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    // ... only the deps the route's gates previously needed
  },
}));
```

If a route uses `checkPremiumFeature(...)` and you add a `storage.getUserVerificationStats()` call inside `getPremiumFeatures` (via a delegation to a richer resolver), every route test mocking only `getSubscriptionStatus` now calls an undefined `vi.fn()` whose default `undefined` return blows up when the helper does `stats.streak`. Result: every gate returns 500 in the test environment. **The helper's own tests don't catch this** because they mock the helper's *immediate* deps directly; only the caller tests, which mock the storage facade at the boundary, expose the gap.

A second compounding hazard: if the new dependency is a *cached* helper with a module-level singleton (e.g. a 60s TTL `Map`), the cache state leaks across tests in the same worker. Test A populates the cache for `userId`; Test B (different mock) gets the cached value, not its own mock. The test failure mode is now non-deterministic — order-dependent — which is worse than a clean 500.

Both failure modes happened on the 2026-05-25 audit's H3 first attempt (commit `5bcdb390`, reverted in `758febdb`). The "elegant" delegation to a cached resolver — strictly more correct in isolation — broke ~20 route test suites and would have introduced a hidden cache-leak class of flakiness.

## Examples

**Good — surgical helper change, no new dep:**

```ts
// Before: indexed raw stored tier; after: applies expiry downgrade.
// Both calls go through storage.getSubscriptionStatus — every existing route
// test already mocks this. Zero caller-test impact.
export async function getPremiumFeatures(req) {
  const sub = await storage.getSubscriptionStatus(req.userId);
  const { effectiveTier } = resolveEffectiveTier(
    isValidSubscriptionTier(sub?.tier ?? "free") ? sub.tier : "free",
    sub?.expiresAt ?? null,
  );
  return TIER_FEATURES[effectiveTier];
}
```

**Bad — widens dep surface AND imports a cached singleton:**

```ts
// Both new failure modes: storage.getUserVerificationStats is unmocked in
// route tests → 500. The internal tierCache (60s TTL) is a module singleton
// that leaks across tests in the same vitest worker → flaky pass/fail.
export async function getPremiumFeatures(req) {
  return resolveSubscriptionTierFeatures(req.userId);
}
```

## Exceptions

- **The helper is private/internal with one or two known callers.** Run the known callers' tests; you don't need a project-wide audit.
- **You're explicitly updating every caller's test mock as part of the change.** Then the widened surface is intentional — but plan for the mock-update churn before starting.
- **The new dependency is *injected*, not imported.** A helper that takes its dependencies as parameters (functional core) doesn't widen the import-time surface — caller tests can pass whatever stub they like.

## Verification checklist before committing a helper change

- [ ] `git grep -l "<helper-name>" server/routes/__tests__ client/**/__tests__` — enumerate caller test files.
- [ ] Run a representative subset (3–5 files) covering different routes — if those pass cleanly, run the full caller surface or rely on CI.
- [ ] If the helper now imports a module-level singleton with mutable state (cache, in-flight set, registry), audit *that* module's tests for cross-test leakage and add a `beforeEach` reset.

## Related Files

- `server/routes/_helpers.ts` (`getPremiumFeatures` / `checkPremiumFeature` — the canonical wide-fanout helper)
- `server/services/subscription-tier-cache.ts` (`resolveSubscriptionTierFeatures` — the cached resolver this case warned against using in a per-request gate)
- Audit manifest `docs/audits/2026-05-25-full.md` — H3 process note

## See Also

- [expired-premium-not-downgraded-before-tier-features-2026-05-25.md](../logic-errors/expired-premium-not-downgraded-before-tier-features-2026-05-25.md) — the underlying bug whose fix surfaced this lesson
- `docs/rules/testing.md` — never mix real and mocked implementations in storage facade `vi.mock`
