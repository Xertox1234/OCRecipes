# Recipes Section Inline Drawers — Design

- **Date:** 2026-06-27
- **Status:** Draft (awaiting spec-review approval)
- **Scope owner:** Home screen / Recipes section
- **Location note:** This file lives under the gitignored `docs/superpowers/` tree (project convention — specs are local-only).

## Summary

Recreate an inline "drawer" interaction on the Home screen's **Recipes** collapsible section. Tapping **Search Recipes** or **Generate Recipe** no longer navigates straight to a separate screen. Instead the tapped row glides to the top of the screen and expands an inline drawer (mini-interface) in place. The drawer is the entry point; submitting (typing, tapping a chip, or tapping a carousel item) hands off to the existing results/chat screens.

This reuses the `renderInline` mechanism already proven by `QuickLogDrawer` on the same screen, plus a new shared drawer shell that adds three behaviors Quick Log does not have: glide-to-top, close-on-scroll, and a 75%-of-screen height clamp.

## Scope

### In scope

- **Search Recipes** row → inline drawer (search box + recent-search chips + trending carousel).
- **Generate Recipe** row → inline drawer (prompt box + idea chips), premium-gated.
- A shared inline-drawer shell encapsulating the open/close/scroll interaction.
- New per-user local storage for recent recipe searches.
- A trending-terms data source reusing existing recipe popularity data.

### Out of scope (explicitly unchanged)

- **Import Recipe** and **Create Cookbook** rows — keep navigating to their screens.
- The **Planning** section (Meal Plan / Grocery List / Pantry) and the **Nutrition** section (incl. the existing Quick Log drawer) — untouched.
- The standalone `RecipeSearchEntry` search bar near the top of Home (left as-is; not part of this work).
- The **first-use tour** for Generate — deferred to its own follow-on spec (see Phase 4). The Generate drawer ships fully functional without it.

## Locked decisions

| Decision        | Choice                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drawer style    | Inline accordion (expands in place, pushes rows below down) — **not** a bottom sheet.                                                               |
| Rows affected   | Search Recipes, Generate Recipe.                                                                                                                    |
| Open behavior   | Tapped row glides to the top of the screen, then drawer expands.                                                                                    |
| Animation       | Paced, smooth; Reanimated timing configs; respects `reducedMotion`.                                                                                 |
| Close behavior  | Any **user-initiated** scroll closes the open drawer.                                                                                               |
| Exclusivity     | Single-open — opening one Recipes drawer closes the other.                                                                                          |
| Height          | Content **bounded to fit** under 75% of screen height; 75% is a safety clamp that never triggers an internal scroll. No nested vertical ScrollView. |
| Generate gate   | Premium gate preserved — non-premium tap shows `UpgradeModal`; drawer opens only for premium.                                                       |
| Trending source | Reuse existing recipe popularity data, aggregated into **topic terms** (default — see Open decisions).                                              |

## Architecture

### Insertion point

`client/components/home/action-config.ts` already defines a `renderInline?: boolean` flag and `HomeScreen.renderInlineAction(action)` switches on `action.id`. Set `renderInline: true` on `search-recipes` and `generate-recipe`, and add their cases to `renderInlineAction`.

### Coordination owner: HomeScreen

HomeScreen already holds the `Animated.ScrollView` ref and is the module where `renderInlineAction` lives, so it owns coordination:

- **Which drawer is open** (`openDrawerId: string | null`) — enforces single-open.
- **Glide-to-top** — scrolls the tapped row to the top via the ScrollView ref.
- **Close-on-drag** — an `onScrollBeginDrag` handler on the ScrollView that clears `openDrawerId`.

Drawers stay presentational; they receive `isOpen`, `onToggle`, and an `onOpened` callback (to request glide-to-top) and render their own body content. This avoids prop-drilling churn through `CollapsibleSection` by keeping the open-state map and handlers in HomeScreen and passing only what each inline action needs.

_Alternatives considered:_ a dedicated React context for scroll coordination (cleaner at many-drawer scale, overkill for two); fully self-contained drawers reaching up to the parent ScrollView (fragile — rejected).

### `renderInline` bypasses `handleActionPress` — the gate and recording move into the drawers

Inline actions render via `renderInlineAction(action)` (`HomeScreen.tsx:49-56, 262-275`) and **never call `handleActionPress`** (`112-124`). Both the premium check and `recordAction(...)` live in `handleActionPress`. Consequences the implementer must handle:

- `renderInlineAction` is currently a **module-scope** function taking only `action` — it has no access to `isPremium` (`94`), `setShowUpgradeModal` (`94`/`283`), or `recordAction`. It must be refactored to a HomeScreen-scoped closure (or accept these as params) so the drawers can use them.
- The **Generate premium gate is reimplemented inside the drawer's toggle**, not "inherited": on toggle, if `!isPremium` → fire `UpgradeModal` and do not open; only premium users see the drawer expand.
- Each drawer calls **`recordAction(action.id)` on actual use** — i.e. on submit / chip tap / trending-term tap (Search) or submit / idea-chip tap (Generate) — **not** on mere open. Recording on idle open (user expands then closes without searching) would inflate `usageCounts`, which drives `DiscoveryCarousel` surfacing and the `RecentActionsRow` icon-only threshold. Recording on use is faithful to intent and aligns with when the recent-search store is written. (See dual-entry note below.)

### Dual entry points — keep `navigateAction`, accept dual behavior (default)

These two actions are reachable from **more than one surface**, and those other surfaces still navigate full-screen via `handleActionPress → navigateAction`:

- `generate-recipe` **has a Discovery card** (`discovery-cards-config.ts:76`) — a card tap navigates to `RecipeChat`.
- Either action can appear in **Recent** (`RecentActionsRow`) once recorded; a chip tap navigates full-screen.

Therefore:

1. The `navigateAction` cases for `search-recipes` and `generate-recipe` (`action-config.ts:44-52`) **must stay** — deleting them silently no-ops the carousel/Recent taps. (An `integrity` test already asserts every Discovery card id exists in `HOME_ACTIONS`, so the action entries must remain too.)
2. **Default UX = accept dual behavior:** carousel/Recent = fast full-screen path; the Recipes section row = the rich inline drawer. Both ultimately reach the same feature. See Open decisions to flip this.

### Drawer lifecycle (two transitions)

- **Navigate away + return.** A chip/term/submit navigates to `RecipeBrowser`/`RecipeChat`. **Close the open drawer on blur** (clear `openDrawerId` when Home loses focus, e.g. `navigation` blur) so returning to Home lands on a clean, un-glided screen — otherwise the user comes back to a scrolled, half-open page.
- **Switching drawers.** Search open (glided to top) → tapping Generate (below it) would otherwise run three concurrent animations whose target moves as Search collapses (the worst case of the moving-target risk). **Sequence it:** collapse the open drawer first, then glide + open the newly tapped one — do not run both simultaneously.

### Shared shell: `<HomeInlineDrawer>`

`client/components/home/HomeInlineDrawer.tsx` — a wrapper used by both new drawers (and a candidate for `QuickLogDrawer` to adopt later, out of scope now):

- Header row (icon + label + animated chevron), matching `QuickLogDrawer`'s header.
- Accordion height animation via the existing `useCollapsibleHeight` hook.
- On open, fires `onOpened()` so HomeScreen performs glide-to-top.
- Body rendered via a slot; body is `importantForAccessibility`/`aria-hidden` gated on `isOpen` (matching the Quick Log a11y pattern).

### Components & data flow

```
HomeScreen (owns scrollRef, openDrawerId, glide-to-top, close-on-drag)
 └─ CollapsibleSection "Recipes"
     ├─ HomeInlineDrawer (search)   → RecipeSearchDrawerBody
     │     ├─ search box      → navigate RecipeBrowser { searchQuery }
     │     ├─ recent chips    → navigate RecipeBrowser { searchQuery } (+ record)
     │     └─ trending row    → navigate RecipeBrowser { searchQuery: term }
     ├─ HomeInlineDrawer (generate) → GenerateRecipeDrawerBody  (premium only)
     │     ├─ prompt box      → navigate RecipeChat { initialMessage }
     │     └─ idea chips      → navigate RecipeChat { initialMessage: idea }
     ├─ ActionRow Import      → navigate RecipeImport     (unchanged)
     └─ ActionRow Cookbook    → navigate CookbookCreate   (unchanged)
```

### New units

- `client/components/home/HomeInlineDrawer.tsx` — shared shell.
- `client/components/home/RecipeSearchDrawer.tsx` — search body.
- `client/components/home/GenerateRecipeDrawer.tsx` — generate body.
- `client/lib/recent-recipe-searches-storage.ts` — per-user recent-search store.
- `client/hooks/useTrendingSearches.ts` — TanStack Query hook for trending terms.
- `client/components/home/trending-fallback.ts` — the curated fallback term list (config; used only when live trending is empty/errored).
- A pure helper module for the testable seams (offset math, single-open reducer, storage dedupe/cap, trending source resolution).

### Reused / existing

- `RecipeBrowser` screen — already accepts `searchQuery` (`MealPlanStackNavigator.tsx:25`).
- `RecipeChat` screen — already accepts `initialMessage` (`RootStackNavigator.tsx:144`).
- `useCollapsibleHeight`, `useHaptics`, `useAccessibility`, `useTheme`, `UpgradeModal`.
- `home-actions-storage.ts` — the **template** for per-user durable storage (owner-marker discipline).

### Keyboard & focus (constraint)

Focusing the search box raises the keyboard, which would otherwise cover the recent chips + trending carousel and fight the glide-to-top (the row glides up, then the keyboard hides what was exposed). Decisions:

- **No auto-focus on open.** The drawer expands with the search box, chips, and trending all visible; the keyboard only appears when the user explicitly taps the input. Chips/trending are _alternatives_ to typing, so they are seen first.
- Layout order: search box, then recent chips, then trending — so once the user commits to typing, the keyboard covering the lower content is acceptable (mutually-exclusive input paths).
- The Home `ScrollView` already sets `keyboardShouldPersistTaps="handled"` (`HomeScreen.tsx:196`) so a chip/carousel tap still registers while the keyboard is up.

## Data sources

### Recent searches (new, local)

- Per-user AsyncStorage, mirroring `home-actions-storage.ts` exactly: an in-memory cache initialized with the active user id and a **read-time owner marker** so a user switch never surfaces the previous user's history.
- Store last ~8 queries, deduped (case-insensitive), most-recent-first.
- Written on every successful submit / chip tap from the search drawer.
- **Empty state:** when there are no recent searches (new user / never searched), hide the recent section (label + chips) entirely — the drawer shows the search box + trending. No "no recent searches" placeholder.

### Trending terms (popularity-derived — NEW aggregation)

- Default: aggregate **topic terms** (cuisines / diet tags) over the recipe set ranked by existing popularity (`communityRecipes.popularityScore`, the same signal `taste-picks` uses). Return top-N terms.
- **This is new server work, not pure reuse.** No existing query returns top cuisines/diet tags; `dietTags` is an array column that needs `unnest`. Estimate it as net-new (a query + a small read endpoint or an extension of `/api/recipes/browse`). Prefer extending an existing surface; add a minimal `/api/recipes/trending` only if none fits.
- **Lazy fetch:** the `useTrendingSearches` query is `enabled: isOpen` — it must not fire on every Home mount. It rides the `instructionsRateLimit` limiter shared by `/search` and `/browse` (`recipe-search.ts:17`), so eager fetching would compete with real searches.
- Carousel item tap → nested **`MealPlanTab → RecipeBrowser { searchQuery: term }`** (the only target that accepts a query) — **not** `RecipeBrowserModal` (RootStack, no `searchQuery` param). → many results (genuine "trending search" behavior).

### Trending states — the carousel is never empty or broken

Empty trending is expected to be the **default early state** (popularity accrues with traffic; the community catalog is thin pre-launch). States:

- **Loading:** a fixed-height skeleton row so the drawer height doesn't jump when data arrives.
- **Empty (no terms) OR error (fetch failed):** fall back to a **curated list** — a small hand-picked seasonal set (e.g. "High protein", "Air fryer", "30-min dinners") labeled "Trending". Automatically replaced by live data once the aggregation returns terms.
- **Live data present:** show the aggregated topic terms.

The curated list is **fallback-only**, never the primary source — this preserves the "reuse the real signal" choice while guaranteeing early users always see useful, tappable chips. A curated fallback term taps through the same way (search that term).

## Decomposition (phases)

1. **Phase 1 — Shell + coordination.** `HomeInlineDrawer`, HomeScreen `openDrawerId` state, glide-to-top, close-on-drag, 75% clamp. Verifiable with a placeholder body.
2. **Phase 2 — Search drawer.** Search box → results; recent-search storage; trending carousel. Wire `search-recipes` to `renderInline`.
3. **Phase 3 — Generate drawer.** Premium gate + prompt box + idea chips → RecipeChat. Wire `generate-recipe` to `renderInline`. **No tour.**
4. **Phase 4 — First-use tour (separate spec).** From-scratch, drawer-scoped lean spotlight (highlights prompt box → idea chips → submit) + per-user "seen" flag. Does not gate Phases 1–3.

## Risks & watch-items

- **Glide-to-top is a moving target, and must clear the collapsed bar.** `expandableHeader` collapses 100→44px as a function of `scrollY` (`HomeScreen.tsx:39-41`), so the Recipes row's content offset shifts mid-scroll — measure `rowY` at scroll-time, do not precompute. Crucially, the collapsed summary bar is an **absolute overlay** (`position:absolute, top:0, zIndex:10`, height `HOME_HEADER_COLLAPSED + insets.top` — `HomeScreen.tsx:149-189, 292-299`) that appears exactly when scrolled. Scrolling to `contentOffset = rowY` lands the row at viewport 0 — _under_ that bar. The target must be **`rowY - (HOME_HEADER_COLLAPSED + insets.top)`**. Secondary: confirm there's enough content below the row to physically reach that offset (Planning sits below Recipes and the opening drawer adds height, so likely fine; if not, add dynamic bottom padding while a drawer is open).
- **Close signal must be `onScrollBeginDrag`, not `onScroll`.** Programmatic `scrollTo` (glide-to-top) does not fire begin-drag, so the open animation won't self-close. Confirm it composes with the existing Reanimated `useScrollLinkedHeader` worklet (separate JS prop, or fold begin-drag into that handler).
- **No internal vertical scroll.** Bounding content to fit (chips ≤ ~2 wrapped rows, horizontal trending, fixed-height inputs) is what keeps the 75% clamp from ever needing a nested ScrollView (which would fight the page scroll and feel janky).
- **Per-user durable-state discipline.** Recent-search and (Phase 4) tour-seen storage MUST follow the existing owner-marker pattern from `home-actions-storage` — the codebase has repeated cross-user leak scars. Mirror, don't hand-roll.
- **No coachmark/tour infra exists** anywhere in the client — Phase 4 is genuinely from-scratch and the highest-cost/least-certain piece; isolating it protects the core delivery.
- **Screen-reader experience (two coupled issues for the accessibility-specialist).** (a) A VoiceOver/TalkBack three-finger scroll fires drag events and would close the drawer — confirm SR users get a sane close affordance. (b) "No auto-focus on open" is right for sighted/keyboard users (keeps the keyboard from burying chips/trending) but leaves SR users with **no signal the drawer content appeared** (focus stays on the header). Resolve both together — likely move SR focus to the search field while suppressing the soft keyboard, or fire an `accessibilityLiveRegion`/announce on expand. Treat "no auto-focus" as the _visual_ default, not the SR default.
- **Cross-platform.** Verify the interaction (glide, accordion, carousel) on both iOS and Android.

## Testing strategy

Extract pure, CI-testable seams (Vitest, co-located `__tests__`):

- Glide-to-top **offset math** (given row layout + header collapse state → target scroll Y).
- **Single-open reducer** (toggle/exclusivity transitions for `openDrawerId`).
- Recent-search storage **dedupe + cap + ordering**, and per-user owner-marker isolation (mirror `home-actions-storage.test.ts`).
- Trending term **aggregation** (server, if a new query is added).
- **Trending source resolution** — given (loading | live terms | empty | error), returns skeleton vs. live terms vs. curated fallback. Pure, fully unit-testable.

Component behavior covered per existing RN render-test harness conventions, specifically:

- **Premium gate on the inline path** — non-premium toggle of the Generate drawer fires `UpgradeModal` and does not open (the gate is reimplemented in the drawer, not inherited from `handleActionPress`).
- **`recordAction` fires on actual use** (submit / chip / term tap), not on idle open — asserts an open-then-close-without-searching does not bump `usageCounts`.
- **`navigateAction` cases still present** for `search-recipes`/`generate-recipe` — an integrity assertion so the carousel/Recent full-screen paths are not silently removed.
- Navigation params on submit/chip/carousel tap (`RecipeBrowser { searchQuery }`, `RecipeChat { initialMessage }`).

## Open decisions (confirm at spec-review)

1. **Trending carousel semantics.** Default = **topic terms** (cuisines / diet tags) → search. Alternative = **popular recipes** (relabel "Popular recipes", tap opens the recipe). Default chosen because it behaves like a real "trending search"; switchable here.
2. **Dual entry points.** Default = **accept dual behavior** — the Discovery card / Recent chip for these actions still navigate full-screen (fast path), while the Recipes section row opens the rich drawer. Alternative = make it single-entry by removing the `generate-recipe` Discovery card and excluding these from Recent (loses a promo surface for a premium feature — not recommended).
