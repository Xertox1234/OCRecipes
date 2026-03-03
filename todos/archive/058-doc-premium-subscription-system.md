---
title: "Document premium/subscription system in project docs"
status: done
priority: medium
created: 2026-02-08
updated: 2026-02-08
assignee:
labels: [documentation, premium, subscription]
---

# Document Premium/Subscription System

## Summary

Premium feature gating and subscription tiers are undocumented. Explore the system and add documentation.

## Background

The app has a subscription tier system (free/paid) with feature gating for recipe generation, community recipes, and scan limits. None of this is documented.

## Acceptance Criteria

- [x] Document subscriptionTier/subscriptionExpiresAt columns on users table in DATABASE.md
- [x] Document PremiumContext in FRONTEND.md
- [x] Document /api/subscription/\* endpoints in API.md
- [x] Document recipe generation rate limiting (recipeGenerationLog table) in DATABASE.md
- [x] Document premium-gated features in ARCHITECTURE.md

## Implementation Notes

Key files to explore:

- `client/context/PremiumContext.tsx`
- `client/hooks/usePremiumFeatures.ts`
- `server/routes.ts` — search for /api/subscription endpoints
- `shared/schema.ts` — recipeGenerationLog table, subscriptionTier on users

## Updates

### 2026-02-09

- IAP purchase flow implemented in commit 62d05ae: expo-iap integration with mock/real switching, usePurchase hook, UpgradeModal wired to purchase flow, server subscription endpoint tests, pattern and learning documentation added
