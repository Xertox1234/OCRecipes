---
title: "Extract a getEffectiveTierForUser(userId) storage helper"
status: backlog
priority: low
created: 2026-05-25
updated: 2026-05-25
assignee:
labels: [deferred, refactor, security]
github_issue:
---

# Extract a getEffectiveTierForUser(userId) storage helper

## Summary

Introduce a single `getEffectiveTierForUser(userId): Promise<SubscriptionTier>` storage helper that selects `subscriptionTier + subscriptionExpiresAt` and applies `resolveEffectiveTier` internally. Migrate the four call sites that currently inline this resolution. Makes the codified `docs/rules/security.md` "never index TIER_FEATURES[rawTier] without resolveEffectiveTier" rule enforceable by construction — there is one obvious right way to get a tier, and it is always the effective tier.

## Background

Surfaced from the 2026-05-25 full audit (H3 + H4). The expired-premium downgrade bug existed because four separate call sites each rolled their own `select tier + expiresAt + resolveEffectiveTier` block (or skipped it entirely). The audit fixed all four, but the _shape_ of the pattern is still error-prone for future contributors: a new TIER_FEATURES caller can copy any of several "looks reasonable" forms and silently re-introduce the leak.

A single helper eliminates the foot-gun:

```ts
// server/storage/users.ts (or similar)
export async function getEffectiveTierForUser(
  userId: string,
): Promise<SubscriptionTier> {
  const [row] = await db
    .select({
      tier: users.subscriptionTier,
      expiresAt: users.subscriptionExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const tier = row?.tier ?? "free";
  return resolveEffectiveTier(
    isValidSubscriptionTier(tier) ? tier : "free",
    row?.expiresAt ?? null,
  ).effectiveTier;
}
```

## Acceptance Criteria

- [ ] `getEffectiveTierForUser(userId)` exists and is exported from `server/storage/users.ts` (or sibling).
- [ ] Migrate the four call sites: `server/routes/_helpers.ts` `getPremiumFeatures`, `server/storage/nutrition.ts` (`maxSavedItems`), `server/storage/favourite-recipes.ts` (`maxFavouriteRecipes`), `server/routes/grocery.ts` (range + pantry — grocery additionally needs `applyStreakUnlocks` so it can either get the streak separately or use a slightly different sibling helper).
- [ ] Tests still pass unchanged (the helper produces the same effective tier as the inlined logic).
- [ ] `docs/rules/security.md` rule updated to recommend the helper as the primary path; inline `resolveEffectiveTier` remains valid for niche cases.
- [ ] Code-reviewer agent updated to flag inline `select tier + TIER_FEATURES[...]` blocks in favor of `getEffectiveTierForUser`.

## Implementation Notes

- Storage layer (`server/storage/users.ts`) is the natural home — it's where `getSubscriptionStatus` already lives and it's a pure read.
- Do NOT route per-request route gates through `resolveSubscriptionTierFeatures` (the cached resolver) — that path has a `getUserVerificationStats` dependency and a 60s `tierCache` singleton that broke ~20 route tests when attempted during the 2026-05-25 audit. The new helper must be cache-free and single-storage-call.
- `grocery.ts` has the extra `applyStreakUnlocks` step. Either add a `getEffectiveFeaturesForUser` variant or keep grocery's manual composition (`getEffectiveTierForUser` + `resolveVerificationStreak` + `applyStreakUnlocks(TIER_FEATURES[effectiveTier], streak)`). Prefer the latter for now — only one site needs streak.
- B2B `ApiTier` sites (`api-rate-limit.ts`, `public-api.ts`) are NOT affected — they use the api-key tier, not user subscriptions.

## Dependencies

- None.

## Risks

- Low. The helper is a pure read; the migration is mechanical and behavior-preserving.

## Updates

### 2026-05-25

- Initial creation (deferred from 2026-05-25 full audit; flagged as optional follow-up in the audit's codification + PR #252 review).
