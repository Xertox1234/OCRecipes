---
title: "Leftovers from the screen-chrome and broken-flows runs: scroll headers, FAB overlap, insets, scan-flow polish"
status: done
priority: medium
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, qa-sweep, ui]
github_issue:
---

# Leftovers from the screen-chrome and broken-flows runs

## Summary

The 2026-10 visual QA sweep findings that PRs #1401 (screen chrome) and #1404 (broken flows) left out of scope. Most are about collapsing headers and overlaps, plus some polish on the scan flow.

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local); screenshots `~/qa-sweep-2026-10/`. Finding numbers match the report.

**Scroll-linked headers (Medium).**

- #2: opening Quick Log at the top of Home scrolls the row under the sticky "0 / 2,000 cal" bar. The likely cause is that the row is measured with the header expanded (100) and the header then collapses to 44 during the glide, an overshoot of about 56pt. See `client/screens/HomeScreen.tsx` ~`:350-365` and `client/components/home/inline-drawer-utils.ts` `glideToTopOffset`.
- #7: the RecipeBrowser header (about 330pt) never collapses on scroll, so cards slide under it. See `client/screens/meal-plan/RecipeBrowserScreen.tsx`.
- #31: when FeaturedRecipeDetail is scrolled, the grabber and ✕ float over the content with no header band behind them. See `client/screens/FeaturedRecipeDetailScreen.tsx`.
- #63: the collapsed Profile header turns see-through and the calorie card scrolls through it. See `client/screens/ProfileScreen.tsx`.

**Overlap and insets.**

- #35 Medium: in the default Home view, the Scan FAB covers half of the first For You card's ✕. See `client/components/ScanFAB.tsx` and HomeScreen.
- #62 Low: InlineSettings rows sit about 65pt in from the edge, against the 20pt gutter used elsewhere, because padding is doubled. See `client/components/profile/InlineSettings.tsx`.
- Low: the EditDietaryProfile loading skeleton has no header inset. See `client/screens/EditDietaryProfileScreen.tsx`.
- Low: `client/hooks/useKeyboardVisible.ts` has never been checked with an iPad floating keyboard or a hardware keyboard.

**Left over from #1404.**

- Low: after a cross-tab "+ Add" (Profile → Recipes → + Add), the Plan tab stays on the Add Recipe hub. See `RecipeBrowserScreen.tsx` and `source-tab-utils.ts`.
- Low (#84 remainder): on PhotoIntent the pre-selected option has a green outline (off-brand), the step bar shows 2/3 before a photo exists, and the FAB label "Scan Menu" opens this general picker. See `client/screens/PhotoIntentScreen.tsx`.
- Low (#86 remainder): the found state of NutritionDetail has several problems.
  - The nutrition card is pure white in light mode.
  - "1 tsp (4g)" and "1 tbsp (12g)" servings are offered for a can of Coke.
  - It shows "PER 1 × 1 PORTION".
  - A "Contains caffeine" badge sits next to "Caffeine: Not recorded".
  - See `client/screens/NutritionDetailScreen.tsx`.
- Unmeasured: the UpgradeModal pinned footer may clip at the largest Dynamic Type sizes on an SE-size screen. See `client/components/UpgradeModal.tsx`.
- Review note on #1405: the new `describe("RecipeChatScreen — free user (QA sweep #59)")` was inserted between the `// P2-2026-09-24:` comment and the abort-on-unmount describe it documents. Move it above that comment. See `client/screens/__tests__/RecipeChatScreen.test.tsx`.

## Acceptance Criteria

- [ ] #2, #7, #31, #63: the header never covers content at rest or while scrolling, checked in light and dark.
- [ ] #35: the FAB doesn't cover the For You ✕ in the default Home view.
- [ ] #62 and the EditDietaryProfile skeleton inset are fixed.
- [ ] Plan tab leftover, PhotoIntent polish and NutritionDetail found-state items are each fixed or declined with a reason in the PR.
- [ ] `useKeyboardVisible` behaviour on iPad keyboards is checked in the iPad simulator, or declined with a reason.
- [ ] UpgradeModal footer measured at the largest accessibility text size; fixed if it clips.
- [ ] RecipeChatScreen test comment placement corrected.

## Implementation Notes

- Fix by root cause. #7 and #63 may share the `useScrollLinkedHeader` path.
- Check every visual change in the simulator, in light and dark.
- Don't touch colour tokens beyond the PhotoIntent outline. The rest of the colour drift belongs to `P2-2026-10-12-design-system-coach-pro-and-colour-drift`.

## Scope Contract

- **Mechanisms to use:** existing header-inset hooks, `useScrollLinkedHeader`, theme tokens.
- **Files in scope:** the files named above and their `__tests__`.
- No new mechanisms.

## Dependencies

- None. PRs #1401 and #1404 are merged.

## Risks

- Scroll-header changes are easy to regress on other screens that share the hook, so re-check Home, Profile and RecipeBrowser together.

## Updates

### 2026-10-12

- Filed from the deferred lists of #1401 and #1404.

### 2026-10-12 (executor)

Fixed: #2 (glide accounts for the shrinking Home header), #7 (discovery feed now drives the RecipeBrowser header collapse), #31 (header band behind grabber and close once scrolled), #63 (Profile collapsed bar slides in opaque instead of fading), #35 (For You card actions left-aligned, off the FAB), #62 (doubled gutter removed), EditDietaryProfile skeleton inset, PhotoIntent (green outline to link, no step bar without a photo), NutritionDetail ("1 x" prefix dropped for a single serving, no tsp/tbsp for beverages), RecipeChatScreen test comment moved.

Declined, with reasons:

- Plan tab left on the Add Recipe hub: the fix goes through `usePreventRemove` re-dispatch in RecipeEntryHubScreen; unverifiable without the simulator and Low priority.
- "Scan Menu" opens the general picker: a menu-specific entry needs a new Scan mode param (new mechanism, outside the Scope Contract).
- NutritionDetail white card: `theme.surface` is a deliberate token; colour drift belongs to the design-system colour-drift todo.
- "Contains caffeine" next to "Not recorded": the flag comes from product evidence and the always-show-every-row panel is deliberate; reconciling is a product decision.
- `useKeyboardVisible` on iPad floating/hardware keyboards: needs an iPad simulator, not available here.
- UpgradeModal footer at largest Dynamic Type: not measured; an unmeasured footer-scroll change was reverted after review (it could push the CTA below the fold). Still open.
- Home's own collapsed bar still fades (same translucency as Profile's old one); not reported in the sweep, left unchanged.
- No simulator verification (light/dark) was performed for any visual change.
