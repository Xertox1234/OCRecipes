---
title: "Screen chrome: bottom content behind the tab bar, content under the header, invisible cards"
status: backlog
priority: high
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [qa-sweep, ui, layout]
github_issue:
---

# Screen chrome: bottom content behind the tab bar, content under the header, invisible cards

## Summary

Three shared layout causes found in the 2026-10 visual QA sweep make buttons unreachable (behind the tab bar), hide first lines under the header, and waste width (cards with no visible surface). Fix each cause once, then re-check every listed screen.

## Background

From the simulator sweep (iPhone 17 Pro, light + dark), report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local) — groups A and B plus SYS-B. Screenshots in `~/qa-sweep-2026-10/`.

**SYS-A — bottom budget (High).** Screens pushed inside a tab stack still show the floating 88pt tab bar (`TAB_BAR_HEIGHT`) but reserve only `insets.bottom` (~34pt).

- #13 RecipeCreate wizard (all 7 steps): "Next" behind the tab bar when the keyboard is down — `client/components/recipe-wizard/WizardShell.tsx:420-422`.
- #20 GroceryList: "Add item…" field + snackbar behind the bar at max scroll (re-confirmed 2026-10-12) — `client/screens/meal-plan/GroceryListScreen.tsx:460`, `:571`.
- #24 Pantry: "Add pantry item…" field, same — `client/screens/meal-plan/PantryScreen.tsx`.
- #67 TasteProfile: fixed Save footer behind the bar, only ~18pt visible, unreachable — `client/screens/TasteProfileScreen.tsx:220`.
- #82 SavedItems: last item's Share/Delete on the bar's edge at max scroll — `client/screens/SavedItemsScreen.tsx`.
- #28 (Low) CookbookCreate: CTA half under the bar on arrival — `client/screens/meal-plan/CookbookCreateScreen.tsx`.
- #60 Coach chat: the opposite case — input keeps `paddingBottom: TAB_BAR_HEIGHT` while the keyboard covers the bar, plus `keyboardVerticalOffset={90}`, so it floats ~230pt above the keyboard — `client/screens/ChatScreen.tsx:605-608`, `:656`.
- Unverified suspects from a static sweep (pad `insets.bottom`, never reference tab-bar height): RecipeBrowser, RecipeAIGenerate, RecipeEntryHub, RecipeImport, RecipePhotoImport, RecipeTextImport, CoachReminders, ItemDetail.

**SYS-D — header inset (Medium; #13a High).** Screens without a header-inset hook draw under the header.

- #13a WizardShell: progress bar + "Step 1 of 7" under the transparent header — `WizardShell.tsx:353-356`.
- #67b TasteProfile intro + row 1; #73 CoachReminders intro + first switch title (`client/screens/CoachRemindersScreen.tsx`); #81 EditDietaryProfile "Allergies" heading (`client/screens/EditDietaryProfileScreen.tsx`).
- Related header overlaps: #2 Home Quick Log drawer lands under the sticky calorie bar (`client/screens/HomeScreen.tsx:350-365`, `client/components/home/inline-drawer-utils.ts`); #7 RecipeBrowser header never collapses (`RecipeBrowserScreen.tsx:754-766`); #31 recipe-detail grabber + ✕ float over content; #63 Profile collapsed header translucent over the calorie card; #37 Remix modal icon flush to header.
- Settings, SignInMethods, ChangePassword, TwoStepSetup also lack the hook but render correctly — leave them.

**SYS-B — invisible card (Medium; owner ruling 2026-10-12: not intended, fix it).** `getBackgroundColorForElevation(1)` returns `backgroundDefault`, which equals `backgroundRoot` in light (`#FAF6F0`) and dark (`#1E1814`) — `client/components/card-utils.ts:27-28`, `client/constants/theme.ts:22-23`, `:85-86`. Effects: Profile settings rows inset ~65pt (#62, also double padding in `client/components/profile/InlineSettings.tsx:102-115`), Settings, SignInMethods, GoalSetup sections, SavedItems / ScanHistory gaps (#80, #82), PhotoIntent option gaps (#84).

**#5 Scan FAB (owner ruling 2026-10-12: Home-only is right).** Plan/Profile still pad `FAB_CLEARANCE` (72pt) for a FAB that never shows there — remove that padding outside Home. `client/components/ScanFAB.tsx:51-57`, `client/navigation/MainTabNavigator.tsx:314`. Also #35: on Home the FAB covers half of the first For You card's ✕.

## Acceptance Criteria

- [ ] One shared way for tab-stack screens to get their bottom budget (tab bar height, not `insets.bottom`); applied to every SYS-A screen above, including footers and snackbars.
- [ ] Chat input (#60) sits directly on the keyboard when it is up and on the tab bar when it is down.
- [ ] The 8 unverified suspects checked on screen; fixed if affected.
- [ ] Every tab-stack screen whose content is clipped takes `useHeaderContentInset()` (WizardShell, TasteProfile, CoachReminders, EditDietaryProfile); #2, #7, #31, #63, #37 fixed.
- [ ] Elevation-1 cards have a visible surface in light and dark; Profile settings / Settings / SavedItems / ScanHistory / PhotoIntent no longer show dead inset (remove double padding in InlineSettings).
- [ ] No `FAB_CLEARANCE` padding on tabs without the FAB; FAB no longer covers the For You card's ✕.
- [ ] Re-checked in the simulator, light + dark, keyboard up and down, scrolled to max.

## Implementation Notes

- Prefer `useBottomTabBarHeight()` or `TAB_BAR_HEIGHT` from the existing constants; do not invent a new layout primitive if a hook already fits.
- A SYS-B change touches every Card — check one screen per area for contrast regressions; pick the surface token from the theme (likely `backgroundSecondary` or a new `surface` token if the design system has one).
- Visual check helpers: `.claude/skills/verify-ui/`; coordinate taps without Maestro: see the `reference_sim_dev_loop_gotchas` memory (bundled `axe`).

## Scope Contract

- **Mechanisms to use:** existing `TAB_BAR_HEIGHT` / `useBottomTabBarHeight`, `useHeaderContentInset`, theme tokens.
- **Files in scope:** the screen and component files named above, `client/components/card-utils.ts`, `client/constants/theme.ts`, `client/components/ScanFAB.tsx`, `client/navigation/MainTabNavigator.tsx`, `client/components/profile/InlineSettings.tsx`, `client/components/home/inline-drawer-utils.ts`, and their `__tests__`.
- No new mechanisms beyond a shared bottom-budget helper if one is genuinely needed.

## Dependencies

- None. Do this before the design-system todo (P2-2026-10-12-design-system-coach-pro-and-colour-drift) — card surface changes interact with colour fixes.

## Risks

- Card surface change is app-wide; screens that layered their own background on Card may double up.
- Small-screen (SE) layout not yet checked — the sweep ran on one device size.

## Updates

### 2026-10-12

- Filed from the visual QA sweep triage (owner chose ~6 grouped todos, Lows folded in).
