---
title: "Accessibility, layout bugs and copy polish from the visual QA sweep"
status: backlog
priority: medium
created: 2026-10-12
updated: 2026-10-23
assignee:
labels: [qa-sweep, ui, accessibility]
github_issue:
human_led: true
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

- [ ] Every sheet/modal listed in #32 hides the screen beneath from VoiceOver (_code sets `accessibilityViewIsModal` on all five; needs a device VoiceOver pass_); ~~RecipeChat chips individually reachable; ring icon not announced as a glyph~~ (_done in #1417_).
- [ ] #39/#39b checked with VoiceOver on a device; fixed if real, closed if not (_device pass, owner_).
- [x] Medium layout bugs (#30, #26, #15, #68, #69, #70) fixed (_#1417, #1421_); Lows fixed or declined in the PR body with a reason (_#6, #8, #21, #22, #46, #64 fixed; #33, #25 and the chrome items moved to `todos/P3-2026-10-18-screen-chrome-consistency-followups-from-qa-sweep.md` at the owner's request; #23 not reproduced_).
- [x] Copy items fixed or declined; British spelling ("Favourites") consistent (_polish PR, owner decisions 2026-10-18_).
- [x] Re-checked light + dark (_simulator, 2026-10-18: Plan, Browse Recipes, Profile, Saved Items, discard sheet_).

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

### 2026-10-12 (simulator check of the #1417 fixes)

Checked on the iOS 26.5 simulator, light mode (grocery row also dark), against main plus this branch:

- #15 RecipeImport error buttons: pass. Both buttons span the gutter with centred labels.
- #22 grocery title: pass ("Grocery List Oct 12 - Oct 18"). #46 "1 item": pass.
- #21 strike-through: **was not fixed by #1417.** The name container did shrink-wrap (measured 44.67pt for "Garlic"), but the line's `width: "100%"` resolved against the whole row (~296pt) and still ran to the screen edge. Fixed on `fix/qa-sweep-ingredient-spacing-strikethrough`: the line's width now comes from the name's measured `onLayout` width, in points. Checked static and animated (uncheck, re-check), light and dark.
- #19 "1 lemon": **#1417 fixed the recipe detail list only** (passes on recipe 269551, "4 red bell peppers"). The sweep saw it on the import result card, which builds `{quantity} {unit} {name}` in JSX, as do four other components. Fixed on the same branch with `formatIngredientLine` in `client/lib/format.ts`, used by all five. The import card itself is unit-tested only; reaching it on the simulator needs an AI import.
- #26 cookbook name and cover: pass (verified with #1421).
- Side finding, filed: `todos/P3-2026-10-12-recipe-import-every-failure-says-no-recipe-data.md`.

Still open in this todo: #32 and #39/#39b need VoiceOver on a real device. The Lows and copy items marked "needs a product call" in pass 1 (#6, #8, #33, #34 tags, #64, #12, #17, #14, #29, #27, #3, #25, #23, #66, #80, #82, Community vs Curated) are still undecided.

### 2026-10-18 — copy and consistency polish (orchestrator)

Owner decisions, asked in plain words before any change: the recipe browser is "Browse Recipes" in all three stacks and Plan's generate screen is "Generate with AI" (#12/#17; the hub keeps "Add Recipe"); the Profile tile is "Recipe Catalog" (#64); "Saved Items" everywhere (#82); the design-system items are filed, not declined.

Done in one PR, keyed by finding ID, each behaviour change with a failing test first:

- #12/#17 titles; #64 tile; #82 header + heading, and Saved Items time estimates get one spelling through `formatDuration` ("1 hr 15 min"), which now spells hr/min (it had no callers).
- #34 diet tags that differ only by case are one chip (`uniqueTagsIgnoringCase`).
- #27 an empty cookbook shows "Add Recipes" once (the header button waits for a list).
- #14 RecipeCreate's "Discard changes?" uses the shared confirmation sheet.
- #6 Plan quick-link chips are one horizontal scroll row; the week strip shares the chip gutter.
- #8 the browser's "+ Add" sits at the end of the filter-chip row; the collapsible header shrank from 160 to 60.
- Profile tile screen-reader label pluralises ("1 item"), the same slip as #46.

Checked on the iOS 26.5 simulator in light and dark: Plan, Browse Recipes, Profile, Saved Items, the discard sheet, Generate with AI, the hub.

Not reproduced: #23 — with the photo permission genuinely reset (`simctl privacy reset photos com.williamtower.ocrecipes`, app relaunched), granting "Allow Full Access" on the import sheet's From Gallery opened the picker without a second tap. The other picker paths (cookbook cover, avatar, capture screens) use PHPicker and never prompt.

Moved to `todos/P3-2026-10-18-screen-chrome-consistency-followups-from-qa-sweep.md` (owner: "file a todo for the out of scope items"): #3, #29, #66, #80 list cues, Favourites "Community" vs "Curated", #33 (Ask Coach is a Card like the Tips card above it; Community is the flat one — a section-style decision), #25 (the dairy category image is an AI-generated asset whose text reads "Boiry").

Still open here, human-led: #32 on-device VoiceOver confirmation; #39/#39b.

### 2026-10-23 — device pass on stale code, simulator checks, carousel fix (owner-led `/todo-fast`)

The owner's first VoiceOver pass ran on the **TestFlight app**, i.e. an old bundle, not main. It saw no × on the open scan menu, which main draws. Treat those device results as stale. The owner then chose to wait for the Expo SDK 54→58 upgrade before the phone pass.

Simulator checks on main (AXe `describe-ui`, which includes disabled and off-screen elements):

- #39b: **not a bug.** "Calculate my goals" is in the tree, disabled, followed by a "Still needed: …" hint. "Save my goals" appears after calculating. The sweep's snapshot tool leaves out disabled buttons.
- #39 heart/✕: by design. They are VoiceOver actions on the card (`CarouselRecipeCard.tsx`), not separate stops; each card carries both.
- **New, fixed in this PR:** For You and Curated Recipes exposed only the visible card and the one peeking in. Card 3 entered the tree only after a manual scroll, because `removeClippedSubviews` detaches off-screen cells (the Discover row, which doesn't clip, exposed all its cards). The fix passes `removeClippedSubviews={false}` on the three horizontal recipe rows (`RecipeCarousel`, `CuratedRecipeCarousel`, `PresetRecipeRow`). An omitted prop still clips on Android. After the fix: For You 8/8 cards in the tree (was 2), Curated 10 (was 2; FlatList's default `initialNumToRender` is 10, the rest mount on scroll).
- Scan menu (#32): the × is drawn, and "Close scan menu" comes right after "Batch Scan" in tree order.
- Recipe detail: the whole page is in the tree, so the owner's "last item repeats, no scroll" (seen on old code) is not clipping. Side finding: ingredient checkmarks and the time/difficulty icons are focusable with empty labels.

Still open here, human-led, after the SDK 58 upgrade lands: a phone VoiceOver pass on #32 (all five sheets, incl. the scan menu reaching "Close scan menu"), the recipe-detail scroll, swiping For You and Curated past card 10, and the empty-label icons.
