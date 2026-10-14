---
title: "Standard icons for recipe attributes (vegan, spice level, contains nuts …)"
status: backlog
priority: medium
created: 2026-10-14
updated: 2026-10-14
assignee:
labels: [feature, react-native, design]
github_issue:
human_led: true
---

# Standard icons for recipe attributes

## Summary

The owner asked for one standard way to show recipe facts as icons: vegan, spice level, contains nuts, and so on. Every screen should use the same icon, colour and spoken label for the same fact. This needs a short written design (brainstorming, architectural path) before any code. It's a new shared building block, not a change to one screen.

## Background

The owner raised this on 2026-10-14 while approving the text-only inspired idea cards, which shipped with no icon so this design could cover them. What exists today:

- **Allergens:** 9 fixed ids in `shared/constants/allergens.ts` (`allergenIds`), worked out from each recipe's ingredients (`deriveRecipeAllergens`) and stored as `allergens` jsonb on `community_recipes` and `meal_plan_recipes`. `client/components/AllergenBadge.tsx` already shows a Feather icon for each severity. A `null` list means **unknown**, never "safe".
- **Diet tags:** free strings (`dietTags` jsonb, `string[]`), with no fixed list. They show as text chips (`RecipeDetailContent`, `recipe-wizard/TagsStep`, `PreviewStep`).
- **Spice level:** `spiceLevelSchema` (mild/medium/hot) in `shared/schemas/recipe-finder.ts`, used only as a Recipe Finder filter (`SPICE_LABELS` in `client/components/recipe-finder/recipe-offer-utils.ts`). Recipes don't store it.

## Open questions for the owner (ask before designing)

- Where the icons appear first: everywhere recipes show, idea cards only, or saved recipes only. Idea cards are AI guesses, not checked ingredient lists.
- Which facts get icons: diet, spice level, allergens, quick/effort.

## Acceptance Criteria

- [ ] Owner answers the open questions; design written and approved
- [ ] One shared list of attributes (id → icon, colour token, spoken label) used by every screen
- [ ] A missing allergen icon never reads as "free of" that allergen. Keep the `null` = unknown rule, and decide how AI-guessed facts on idea cards are shown.
- [ ] Each icon has an accessibility label; colour is never the only signal
- [ ] Tests for the mapping and for at least one card that renders it

## Implementation Notes

- `shared/constants/allergens.ts`, `shared/schemas/recipe-finder.ts` (`spiceLevelSchema`)
- `client/components/AllergenBadge.tsx`, `client/components/allergen-badge-utils.ts`
- `client/components/inspired/SuggestionCard.tsx`, `client/components/recipe-finder/RecipeResultsList.tsx`
- Diet tags are free text today; a fixed list may need a normaliser for existing rows
