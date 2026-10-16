---
title: "Inspired recipes — client polish (expired cards, inert rows, double-tap ref, made-card cache)"
status: backlog
priority: low
created: 2026-10-13
updated: 2026-10-14
assignee:
labels: [deferred, react-native]
github_issue:
---

# Inspired recipes — client polish

## Summary

These are small UX gaps that the per-task reviews of the inspired-recipes feature (#1429, #1433) found and deferred under the one-review-pass rule. None of them breaks data, because the server's 409 and 410 paths cover the races.

## Background

They come from the mobile and code reviews of Tasks 10–12 (ledger: `.superpowers/sdd/2026-10-12-inspired-recipes/progress.md`).

## Acceptance Criteria

- [ ] In CoachChat and RecipeChatScreen, a 410 (ideas expired) on "Make this mine" disables or clears that finder list's idea buttons, like the Recipe Browser's `resetIdeas()`. Today the expired cards stay tappable and show the same toast again.
- [ ] In RecipeResultsList, while one idea is being made, the other idea rows' buttons show as disabled instead of staying enabled but doing nothing.
- [ ] The one-make-at-a-time guard in RecipeBrowserScreen, CoachChat and RecipeChatScreen uses a ref, so two taps landing in the same frame can't both pass.
- [ ] After a successful make, the cached listing query's `madeRecipeId` for that card is updated or invalidated.

## Implementation Notes

- `client/components/coach/CoachChat.tsx` (~:775), `client/screens/RecipeChatScreen.tsx` (~:558)
- `client/components/recipe-finder/RecipeResultsList.tsx` (~:110-118)
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` (`handleMakeIdea` ~:579)
- `client/hooks/useInspiredSuggestions.ts` (`useMakeSuggestion` onSuccess)
- 2026-10-14: the photo-fade and photo-poll items were dropped, because idea cards are text-only now.
