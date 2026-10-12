---
title: "Accessibility, layout bugs and copy polish from the visual QA sweep"
status: backlog
priority: medium
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [qa-sweep, ui, accessibility]
github_issue:
---

# Accessibility, layout bugs and copy polish

## Summary

The remaining 2026-10 visual QA sweep findings: VoiceOver gaps, one-off layout bugs, and copy/consistency issues. Each is small; together they are one session.

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local), groups F, H, I; screenshots `~/qa-sweep-2026-10/`.

**Accessibility.**

- #32 Medium: sheets/modals aren't modal for VoiceOver — the screen underneath (and the Scan FAB) stays in the tree: recipe detail (`client/screens/FeaturedRecipeDetailScreen.tsx`), paywall (`client/components/UpgradeModal.tsx`), GoalSetup, DailyNutritionDetail, SpeedDial (#4b, `client/components/SpeedDial.tsx`).
- #58 Medium: RecipeChat suggestion chips unreachable — wrapping View has `accessible` + role none, merging 8 buttons into one (`client/screens/RecipeChatScreen.tsx` ~`:864`, ~`:893-897`).
- #83 Low: calorie ring flame icon read as an icon-font glyph ("󰈸") on Plan and DailyNutritionDetail — shared ring component; "0g / 0g" when no macro goal (say "No goal set").
- #39 / #39b (unconfirmed): For You card heart/✕ may not be separate controls; GoalSetup "Calculate"/"Save" never appeared in snapshots — verify with VoiceOver on a device before changing.
- #34 Low: recipe detail servings −/+ look < 44pt; "Hold any step" hint low contrast; duplicate tags by case. #46: "1 items". S2: TextInputs without labels (`client/screens/meal-plan/CookbookCreateScreen.tsx:524`, `:542` likely false positives).

**Layout bugs.**

- #30 Medium: recipe detail last instruction step doesn't wrap. #26 Medium: CookbookDetail never shows the cookbook's name/cover (`client/screens/meal-plan/CookbookDetailScreen.tsx`). #15 Medium: RecipeImport error buttons have no side padding (`client/screens/meal-plan/RecipeImportScreen.tsx`).
- #68 Medium: GoalSetup Age field too narrow ("25" → "2!"). #69 Medium: placeholders 25/70/170 look like values; Calculate stays disabled with no hint; number pad has no Done key (`client/screens/GoalSetupScreen.tsx:227-229`, `:248`, `:380-394`). #70 Medium: results grid one column — `goalItem width: "48%"` + `gap` > 100%; locked macros opacity 0.4, lock glyph over digits, no lock explanation, no auto-scroll (`:793-803`, `:559`, `:599`, `:639`).
- Lows: #1 Discover watermark emoji clipped (`client/components/home/DiscoveryCard.tsx:38`, `:86`); #6 Plan chips wrap / week strip gutter (`client/screens/meal-plan/MealPlanHomeScreen.tsx`); #8 RecipeBrowser lone "+ Add" row (`RecipeBrowserScreen.tsx:765-806`); #33 "Ask Coach" inset; #21 grocery strike-through full width (`GroceryListScreen.tsx:119-121`, `:679`); #64 Profile "Recipes 27" counts the catalog (`client/components/profile/library-config.ts:57-60`).

**Copy and consistency (Low).**

- #3 Home drawer rows vs subtitled cards; #12 two screens titled "Add Recipe" (and the browser is "Recipes" in the Profile stack); #17 "Generate Recipe" vs "Generate with AI" are different flows; #14 native alert for "Discard changes?"; #29 header "+" vs FAB for create; #27 two "Add Recipes" buttons, "favorites" vs "Favourites"; #22 grocery title shows raw ISO dates; #25 Dairy icon looks like a "Baby" jar; #19 "1 lemon" double space; #23 first photo-permission grant doesn't open the picker; #66 back button pill vs plain text across screens; ScanHistory 3 navigation cues and expand-then-open taps (#80 list part); SavedItems tile "Saved Items" vs screen "My Library", "1 hr" vs "1 hour" (#82 copy part); Favourites "Community" vs browser "Curated" label; "Sign Out" styled as destructive like "Delete Account".

## Acceptance Criteria

- [ ] Every sheet/modal listed in #32 hides the screen beneath from VoiceOver; RecipeChat chips individually reachable; ring icon not announced as a glyph.
- [ ] #39/#39b checked with VoiceOver on a device; fixed if real, closed if not.
- [ ] Medium layout bugs (#30, #26, #15, #68, #69, #70) fixed; Lows fixed or declined in the PR body with a reason.
- [ ] Copy items fixed or declined; British spelling ("Favourites") consistent.
- [ ] Re-checked light + dark.

## Implementation Notes

- The simulator snapshot tool omits checkbox/link/tab roles and disabled or off-screen buttons — use a positive control before calling something inaccessible (see the `reference_sim_dev_loop_gotchas` memory).

## Scope Contract

- **Mechanisms to use:** existing components (`ConfirmationModal`, `EmptyState`, `ThemedText`), `accessibilityViewIsModal`.
- **Files in scope:** files named above and their `__tests__`.
- No new mechanisms.

## Dependencies

- Better after the screen-chrome and design-system todos (fewer overlapping edits), but not blocked.

## Risks

- Grab-bag scope — keep the PR body's checklist mapped to finding IDs.

## Updates

### 2026-10-12

- Filed from the visual QA sweep triage.

### 2026-10-12 (executor pass 1 - partial)

Done in branch `todo/P2-2026-10-12-accessibility-layout-and-copy-polish` (finding IDs):

- #32: all five listed surfaces (FeaturedRecipeDetail, UpgradeModal, GoalSetup, DailyNutritionDetail, SpeedDial) already set `accessibilityViewIsModal` on their root - no code change; needs on-device VoiceOver confirmation that the Scan FAB is actually hidden.
- #58 chips: wrapper `accessible`/role-none removed so each chip is its own element. #83: flame glyph hidden from AT; macro rows say "No goal set" when goal is 0.
- #30 step text `flex:1` removed (clip); #34 hint contrast (opacity removed). #26 CookbookDetail shows name + cover. #15 error buttons stretch inside gutter. #68 Age field min width; #69 "e.g." placeholders at lower contrast, "Still needed: ..." hint, drag-to-dismiss keyboard; #70 results grid two columns, lock glyph moved to a Premium note, auto-scroll to results.
- Lows: #1 watermark line box; #21 strike-through spans text; #22 grocery title dates formatted (`formatGroceryListTitle`); #46 grocery "1 item"; #19 trims blank unit; "Favourite" spelling (HistoryScreen swipe action, Cookbook empty state); "Sign Out" no longer styled as danger.

Not done (needs a device or a product call): #39/#39b VoiceOver device check; #34 tags dedupe; #6, #8, #33, #64 (what should Profile "Recipes" count?), #12/#17/#14/#29/#27/#3/#25/#23/#66/#80/#82 copy and consistency decisions; Favourites "Community" vs browser "Curated" label; light/dark re-check.
