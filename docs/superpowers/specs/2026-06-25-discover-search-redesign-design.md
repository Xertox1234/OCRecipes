# Discover + Search Redesign — Design Spec

**Date:** 2026-06-25
**Status:** Draft (revised after spec-review — 3/day rate-limit deferred; Spoonacular stays premium-gated)
**Scope:** Recipe search/browse **frontend** redesign. No backend changes.

> **Scope decision (2026-06-25):** The original draft proposed opening Spoonacular search to free users at 3/day. Spec-review found that ungating the _detail_ endpoint reverts audit finding **H7** (free users can drain Spoonacular quota via fresh IDs — `recipe-catalog.ts:102–105`). Rather than build the counter + cost-bounding now, the rate-limit is **deferred** (§9). Spoonacular search/detail/save **remain premium-gated, unchanged**. This spec is therefore frontend-only.

---

## 1. Problem

The current recipe search is `RecipeBrowserScreen.tsx` (1,133 lines), reached only indirectly (meal-plan "add", cookbook, recipe hub, Coach AI flow). Three problems:

1. **Boring, flat empty state.** With no query, the _local_ MiniSearch source fires with a blank query and renders an endless paginated feed — "the list seems endless when a recipe should not be visible until a search has been made."
2. **The online (Spoonacular) gate is a clunky source toggle.** Free users discover the premium boundary by flipping a "Local/Online" segmented control, which then bounces them to an upgrade modal. The gate is fine; its _presentation_ is poor.
3. **No front door.** There's no "I just want to discover recipes" entry point anywhere in the app.

## 2. Goals

- Replace the endless blank-query list with a **curated Discover feed** as the empty state (local recipes only — instant, free).
- **Local-first search**: instant local results, with an explicit **"Search online"** call-to-action that, for free users, is the (existing) premium upgrade hook and, for premium users, runs the online search.
- Give discovery a **front door** from the Home tab — without adding a 5th bottom tab (preserves the camera-first 4-tab + Scan-FAB identity).

## 3. Non-goals (YAGNI)

- **No backend changes.** Spoonacular search/detail/save stay premium-gated via the existing `catalogSave` flag. No new table, no counter, no `premium.ts` change.
- **The 3/day free-search rate-limit is deferred** (§9) — not in this slice.
- **No new bottom tab.** Reuse the existing screen + add a Home entry point.
- **No auto-blended/ranked result list.** Local and online stay in separate labeled groups.
- **No new Spoonacular endpoints.** Reuse `/api/meal-plan/catalog/*` as-is.
- **No trending/engagement-ranked row in v1.** Editorial "Featured" (`isCanonical`) covers the editorial slot.
- **No new navigation route.** The Home entry reuses the existing `RecipeBrowserModal` root-modal in browse mode.

---

## 4. Premium model — UNCHANGED

No change to gating. For reference, all three Spoonacular endpoints remain premium-only via `checkPremiumFeature(req, res, "catalogSave", …)`:

| Endpoint                                  | Gate (unchanged) |
| ----------------------------------------- | ---------------- |
| `GET /api/meal-plan/catalog/search`       | Premium only     |
| `GET /api/meal-plan/catalog/:id` (detail) | Premium only     |
| `POST /api/meal-plan/catalog/:id/save`    | Premium only     |

The frontend's only job is to present that boundary better (local-first + a clear CTA) instead of a source toggle. `getEffectiveTierForUser` continues to resolve expired-premium → free (no change).

---

## 5. Frontend design

### 5.1 Discover feed (new blank/browse state)

New component **`client/components/meal-plan/RecipeDiscoveryFeed.tsx`** (name avoids the existing `DiscoveryCarousel`, which renders feature-promo tiles, not recipes). Rendered by `RecipeBrowserScreen` when the query is empty and no filter is active — **replacing** the endless blank-query list.

Rows (top to bottom):

1. **From your pantry** — personalized. `useRecipeSearch({ pantry: true, … })`. **Premium-tier-gated in practice:** `pantryTracking` is `false` for free users (`premium.ts:70`), so this row **auto-hides** for them — free users' feed is carried by the editorial rows below. (Stated explicitly so implementers don't expect a free-tier pantry row.)
2. **Quick & Easy** — `useRecipeSearch({ maxPrepTime: 20, sort: "quickest" })`.
3. **Featured** — `useRecipeSearch({ curatedOnly: true })` (the `isCanonical` filter).
4. **Browse by cuisine** — chip set from the existing `CUISINE_PRESETS` (`RecipeBrowserScreen` L85–92); tapping a chip runs a local filtered search.

Each row is a **thin preset hook** wrapping `useRecipeSearch` (`client/hooks/useRecipeSearch.ts`) with fixed params — all hit the existing local `/api/recipes/search`, which **cannot** return Spoonacular results by construction (so discovery never touches the premium API). Cards reuse the exported **`CarouselRecipeCard`** (`client/components/home/CarouselRecipeCard.tsx`) via a `SearchableRecipe → CarouselRecipeCard` adapter (map `totalTimeMinutes → prepTimeMinutes`, parse the `"community:17"` string id, synthesize/omit `recommendationReason`, make `onDismiss` optional). Reuse `CarouselSkeleton` and `CarouselError`. The carousel wrapper is a small parameterized component (extracted from `RecipeCarousel`'s structure or ~50 lines new) adding the **"See all →"** header that no existing carousel has; "See all" runs the row's preset as a full search.

> **Performance — protect the search rate-limit budget.** The blank state mounts ~4 concurrent `useRecipeSearch` calls, and `/api/recipes/search` is capped at **20/min** (`instructionsRateLimit`). With TanStack's default `staleTime: 0`, bouncing in and out of the screen refetches all four rows each mount (~5 mounts/min would exhaust the budget from the feed alone, starving real user searches). The preset hooks MUST set a sensible `staleTime` so mounts hit cache; confirm whether the Home carousels already do and mirror that value.

### 5.2 Search-results state (local-first + online CTA)

When a query is present, `RecipeBrowserScreen` shows:

- **"From OCRecipes · N"** — local results (existing `useRecipeSearch` + `UnifiedRecipeCard` list rows). Instant, free.
- **"Search online for more" CTA** below — replaces today's source toggle:
  - **Free user** → CTA labelled to signal Premium (e.g. a 🔒/"Premium" affordance); tap → `UpgradeModal` (`client/components/UpgradeModal.tsx`). This is the _same_ gate as today's `shouldGatePremiumSource`, just relocated into the local-first flow.
  - **Premium user** → tap runs `useCatalogSearch` (`client/hooks/useCatalogSearch.ts`); results append under **"From the web · Spoonacular"** with a 🌐 tag.
  - Hidden entirely if the server signals catalog is disabled (no `SPOONACULAR_API_KEY`).
- Online card behavior is unchanged from today: no favorite heart; save → still Premium.

> **Implementation note — this is a data-fetching refactor, not a label move.** Today the screen _swaps_ between `useRecipeSearch` and `useCatalogSearch` (only one active per the source toggle). Local-first + append means that for **premium** users **both** queries are live and rendered as two groups, with the online query fired **imperatively on CTA tap** rather than via an `enabled` flag tied to source. `writing-plans` must scope this as a real refactor of the screen's query coordination inside `RecipeBrowserScreen`, not a relabel.

### 5.3 Online exhaustion state (premium users only)

Only the **global** Spoonacular quota case remains (no per-user limit exists in this slice): the existing `402 CATALOG_QUOTA_EXCEEDED` (`isQuotaExceededError` in `recipe-browser-utils.ts`) → "Online search is temporarily unavailable. Try again later." If `SPOONACULAR_API_KEY` is unset → CTA hidden.

### 5.4 Premium-gate utility

`client/screens/meal-plan/recipe-browser-utils.ts`: keep `shouldGatePremiumSource` and `isQuotaExceededError`. The CTA's free-user branch calls the same gate logic — we're **relocating** the gate trigger from the source-toggle (`SearchFilterSheet`) into the inline CTA, not removing it.

### 5.5 Quota/CTA presentation as pure functions

Extract the CTA-state selection (`free → premium-locked` / `premium → actionable` / `global-402` / `catalog-disabled`) into a pure helper in `recipe-browser-utils.ts` so it's unit-testable via Vitest without rendering.

### 5.6 Dual-purpose screen (meal-plan add vs browse)

`RecipeBrowserScreen` stays dual-purpose; the new blank-state feed benefits **both** modes (`isBrowseOnly`, L422). Tap action unchanged: browse → open detail; add → attach to plan + `goBack()`. Adding a Spoonacular recipe to a plan remains Premium (unchanged).

### 5.7 Front door

Home tab gets a "Search recipes…" entry at top → opens the existing `RecipeBrowserModal` root-modal in browse mode (no new route). Existing meal-plan/cookbook/hub/coach entries are unchanged and inherit the same new blank-state feed. (Residual UX note: a modal as a discovery "destination" is slightly unconventional; a pushed HomeStack screen is an alternative if it feels wrong in testing — deferred, not blocking.)

## 6. Error handling & edge cases

- **Spoonacular API key unset** → online CTA hidden (no broken affordance).
- **Network error on online search (premium)** → show retry; no state corruption.
- **Personalized pantry row empty / free tier** → row hidden.
- **Global 402** → "temporarily unavailable" copy (premium only).
- **Free user taps the online CTA** → `UpgradeModal`, never a network call.

## 7. Testing plan (frontend, Vitest)

- CTA-state pure helper: free→premium-locked, premium→actionable, global-402, catalog-disabled branches.
- Blank state renders the Discover feed (not the endless list); pantry row hidden for free tier; editorial rows render.
- `SearchableRecipe → CarouselRecipeCard` adapter: id parse, time-field map, optional `onDismiss`.
- Free user tapping the CTA opens `UpgradeModal` and issues **no** catalog request; premium user's tap calls `useCatalogSearch`.
- Local-first grouping: local results render under "From OCRecipes"; web group only for premium after CTA.

## 8. Rollout

- **Frontend-only — no migration, no schema change, no backend deploy risk.** Lands via normal commit → PR → CI.
- Run `npm run preflight` before opening the PR (full CI parity incl. coverage).
- Restart Metro after the UI change.

## 9. Deferred — free-tier online search (3/day rate-limit)

Explicitly out of this slice; captured so the design isn't lost. When picked up, it MUST also bound the **detail** endpoint, or it re-trips **audit finding H7**:

- H7 (`recipe-catalog.ts:102–105`): the detail cache (60-min/200-entry) does **not** stop a free user draining Spoonacular quota via _distinct fresh_ IDs; the 30/min throttle is insufficient. So "search free 3/day" requires detail to be bounded too — e.g. **bind free detail access to IDs the user surfaced in their own counted search results** (open-what-you-found), or a per-user daily detail cap.
- Backend shape (for the future slice): `dailyOnlineSearches: number` on `PremiumFeatures` (free 3, premium `UNLIMITED_SCANS`); a `online_search_log` table + atomic `logOnlineSearchWithLimitCheck` cloned from `community-generation-log.ts`; count **only on a successful non-empty response**; resolve tier via `getPremiumFeatures`/`getEffectiveTierForUser` (never the cached `resolveSubscriptionTierFeatures`, which breaks route tests); add a `quota` field to the `@shared/types/recipe-catalog` response schema + `useCatalogSearch`; per-user `429` and global `402` get distinct copy.

## 10. File-touch list (anticipated — frontend only)

- `client/components/meal-plan/RecipeDiscoveryFeed.tsx` (new) + a small parameterized carousel + 3–4 preset hooks + `SearchableRecipe→card` adapter.
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — render the feed as the blank state; local-first results + inline online CTA + web group.
- `client/screens/meal-plan/recipe-browser-utils.ts` — add the CTA-state pure helper; keep `shouldGatePremiumSource`/`isQuotaExceededError`.
- `client/components/meal-plan/SearchFilterSheet.tsx` — remove/repoint the online source toggle now that the CTA carries the gate.
- `client/screens/HomeScreen.tsx` — front-door search entry.

## 11. Open questions

None blocking. Confirmed: rich discovery surface; local-first + online CTA; Home front door (no tab); mixed personalized-when-possible feed (pantry row premium-tier-gated); Spoonacular stays premium (rate-limit deferred); CTA relocates the existing gate.
