---
title: "Add food dislikes UI to onboarding and dietary profile"
status: backlog
priority: medium
created: 2026-04-08
labels: [ui, onboarding, profile]
---

# Add food dislikes UI to onboarding and dietary profile

## Summary

The `foodDislikes` field exists in the DB schema (`user_profiles.food_dislikes`) and onboarding context type but has no UI to populate it. Users cannot specify food dislikes, so the field is always an empty array. The AI dietary context builder (`buildDietaryContext`) already reads this field and the profile hash already includes it for cache invalidation.

## Background

The schema field was added anticipating a dislikes input, but the corresponding screen was never built. Meanwhile, `cuisinePreferences` — added at the same time — has full UI in both onboarding (`PreferencesScreen.tsx`) and edit profile (`EditDietaryProfileScreen.tsx`). The asymmetry means AI suggestions and coaching prompts never account for foods the user dislikes, reducing personalization quality.

## Acceptance Criteria

- [ ] Onboarding flow includes a food dislikes input (e.g., tag/chip input on `PreferencesScreen` or a dedicated screen)
- [ ] `EditDietaryProfileScreen` includes a food dislikes editor
- [ ] Dislikes are saved to `userProfiles.foodDislikes` as `string[]`
- [ ] `buildDietaryContext` output includes dislikes when non-empty (already implemented)
- [ ] Profile hash invalidates suggestion cache when dislikes change (already implemented)

## Implementation Notes

- `PreferencesScreen.tsx` already handles `cuisinePreferences` with a toggle grid — a similar pattern could work for common dislikes (cilantro, olives, mushrooms, etc.) with a free-text "Add other" option
- `EditDietaryProfileScreen.tsx` has the `useDietaryProfileForm` hook — add `foodDislikes` to the form state
- The `OnboardingContext` already carries `foodDislikes: string[]` (default `[]`)
- Consider a chip/tag input component for free-form entries

## Files affected

- `client/screens/onboarding/PreferencesScreen.tsx`
- `client/screens/EditDietaryProfileScreen.tsx`
- `client/hooks/useDietaryProfileForm.ts`

## Updates

### 2026-04-08
- Identified during code review of todo batch session — `foodDislikes` schema field has no write path
