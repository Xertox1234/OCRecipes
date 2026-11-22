# Discover + Search Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recipe browser's endless blank-query list with a curated, local-only Discover feed; add a Home front door; and restructure search into a local-first results view with an inline "Search online" CTA that carries the existing Spoonacular premium gate.

**Architecture:** Frontend-only. No backend, schema, or premium-gate changes — Spoonacular search/detail/save stay premium-gated exactly as today. New work composes the existing `/api/recipes/search` (local MiniSearch) into preset-filtered carousels, reuses the Home tab's `CarouselRecipeCard`/`CarouselSkeleton`/`CarouselError` via a `SearchableRecipe → CarouselRecipeCard` adapter, and relocates the premium gate from the filter-sheet "Online" source toggle into an inline CTA.

**Tech Stack:** Expo/React Native 0.81, React 19 (React Compiler active), TanStack Query v5, TypeScript strict, Vitest. Theme via `useTheme()` + `withOpacity` (0–1 scale). Source spec: `docs/superpowers/specs/2026-06-25-discover-search-redesign-design.md`.

## Global Constraints

- **Frontend-only.** No changes to `server/`, `shared/schema.ts`, or `shared/types/premium.ts`. Spoonacular endpoints stay premium-gated (`catalogSave`).
- **Cross-platform.** Every change must work on iOS **and** Android (no platform-only APIs without a `.ios`/`.android` split).
- **Theme system.** Colors come from `useTheme().theme`; opacities via `withOpacity(color, 0–1)`. Never hardcode hex except the existing white-on-overlay cases.
- **Accessibility.** Interactive elements need `accessibilityRole` + `accessibilityLabel`; constrain font scaling with `MAX_FONT_SCALE_CONSTRAINED` where the card pattern already does.
- **React Compiler is active.** Do not add manual `React.memo`/`useCallback` purely for function identity; `useMemo` for FlatList `data`/`extraData` is still warranted.
- **Test pattern.** Extract logic into pure functions in `*-utils.ts` and test via Vitest. Co-locate tests under `__tests__/` with a **distinct basename** from any sibling `.ts` (avoids the type-aware-lint `.ts/.tsx` collision).
- **LSP-first for shared symbols.** Before editing `CarouselRecipeCard` or `useRecipeSearch`, run `findReferences` (warm up tsserver with a `hover` first) to confirm the blast radius. Both edits below are additive/backward-compatible.
- **Minimal changes.** Touch only what each task needs. Do not refactor neighboring code.
- **Verification.** Run `npm run preflight` before opening a PR. Use the `verify-ui` skill for visual confirmation of UI tasks (iOS Simulator).
- **Commits** end with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**New files:**

- `client/components/meal-plan/recipe-discovery-utils.ts` — pure helpers: `parseSearchableRecipeNumericId`, `toCarouselCard`, `DISCOVERY_PRESETS`, `isBlankBrowseState`, `resolveOnlineCtaState`. (All pure → full Vitest coverage.)
- `client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts` — tests for the above.
- `client/components/meal-plan/PresetRecipeRow.tsx` — presentational horizontal carousel (title + optional "See all", reuses `CarouselRecipeCard`/skeleton/error).
- `client/components/meal-plan/DiscoveryRow.tsx` — thin data wrapper: calls `useRecipeSearch(preset, { staleTime })`, renders `PresetRecipeRow`.
- `client/components/meal-plan/RecipeDiscoveryFeed.tsx` — composes the rows + the "Browse by cuisine" chips.
- `client/components/home/RecipeSearchEntry.tsx` — the Home tab front-door pressable.

**Modified files:**

- `client/components/home/CarouselRecipeCard.tsx` — make `isFavourited`/`onDismiss`/`onFavourite` optional; add `showActions?: boolean` (default `true`).
- `client/hooks/useRecipeSearch.ts` — accept optional `{ staleTime }`.
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — render the feed as the blank/browse state (Phase 1); local-first results + online CTA (Phase 3).
- `client/screens/HomeScreen.tsx` — render `RecipeSearchEntry` (Phase 2).
- `client/components/meal-plan/SearchFilterSheet.tsx` — remove the "Online" source option (Phase 3; the CTA now carries that gate).

**Phasing (each phase is independently mergeable and ships working software):**

- **Phase 1 — Discovery feed** (Tasks 1–6): the core polish; kills the endless blank-query list.
- **Phase 2 — Home front door** (Task 7): small, independent.
- **Phase 3 — Local-first search + online CTA** (Tasks 8–10): the larger render/query restructure; deferrable without blocking Phases 1–2.

---

## Phase 1 — Discovery Feed

### Task 1: Pure discovery utils — id parse + card adapter

**Files:**

- Create: `client/components/meal-plan/recipe-discovery-utils.ts`
- Test: `client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`

**Interfaces:**

- Consumes: `SearchableRecipe` (`@shared/types/recipe-search`), `CarouselRecipeCard` (`@shared/types/carousel`).
- Produces: `parseSearchableRecipeNumericId(id: string): number`; `toCarouselCard(recipe: SearchableRecipe): CarouselRecipeCard`.

- [ ] **Step 1: Write the failing test**

```typescript
// client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  parseSearchableRecipeNumericId,
  toCarouselCard,
} from "../recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const base: SearchableRecipe = {
  id: "community:17",
  source: "community",
  userId: null,
  title: "Red Thai Curry",
  description: null,
  ingredients: [],
  cuisine: "Thai",
  dietTags: [],
  mealTypes: [],
  difficulty: null,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  totalTimeMinutes: 30,
  caloriesPerServing: 520,
  proteinPerServing: null,
  carbsPerServing: null,
  fatPerServing: null,
  servings: null,
  imageUrl: "img/x.png",
  sourceUrl: null,
  createdAt: null,
  isCanonical: true,
  allergens: [],
};

describe("parseSearchableRecipeNumericId", () => {
  it("extracts the numeric portion after the source prefix", () => {
    expect(parseSearchableRecipeNumericId("community:17")).toBe(17);
    expect(parseSearchableRecipeNumericId("personal:42")).toBe(42);
  });
});

describe("toCarouselCard", () => {
  it("maps fields and prefers calories for the meta line", () => {
    const card = toCarouselCard(base);
    expect(card).toEqual({
      id: 17,
      title: "Red Thai Curry",
      imageUrl: "img/x.png",
      prepTimeMinutes: 30,
      recommendationReason: "520 cal",
      isCanonical: true,
    });
  });

  it("falls back to total time, then cuisine, then empty string", () => {
    expect(
      toCarouselCard({ ...base, caloriesPerServing: null })
        .recommendationReason,
    ).toBe("30 min");
    expect(
      toCarouselCard({
        ...base,
        caloriesPerServing: null,
        totalTimeMinutes: null,
      }).recommendationReason,
    ).toBe("Thai");
    expect(
      toCarouselCard({
        ...base,
        caloriesPerServing: null,
        totalTimeMinutes: null,
        cuisine: null,
      }).recommendationReason,
    ).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: FAIL — "Failed to resolve import ../recipe-discovery-utils".

- [ ] **Step 3: Write minimal implementation**

```typescript
// client/components/meal-plan/recipe-discovery-utils.ts
import type { SearchableRecipe } from "@shared/types/recipe-search";
import type { CarouselRecipeCard } from "@shared/types/carousel";

/** "community:17" -> 17. The source prefix is dropped; callers that need to
 *  navigate must keep the original SearchableRecipe (the numeric id is lossy
 *  — personal:17 and community:17 both yield 17). */
export function parseSearchableRecipeNumericId(id: string): number {
  return Number.parseInt(id.split(":")[1] ?? "", 10);
}

/** Adapt a local SearchableRecipe into the reusable CarouselRecipeCard shape.
 *  recommendationReason carries a compact meta string (calories → time → cuisine). */
export function toCarouselCard(recipe: SearchableRecipe): CarouselRecipeCard {
  const reason =
    recipe.caloriesPerServing != null
      ? `${recipe.caloriesPerServing} cal`
      : recipe.totalTimeMinutes != null
        ? `${recipe.totalTimeMinutes} min`
        : (recipe.cuisine ?? "");
  return {
    id: parseSearchableRecipeNumericId(recipe.id),
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    prepTimeMinutes: recipe.totalTimeMinutes ?? recipe.prepTimeMinutes,
    recommendationReason: reason,
    isCanonical: recipe.isCanonical,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add client/components/meal-plan/recipe-discovery-utils.ts client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts
git commit -m "feat(search): add SearchableRecipe→CarouselCard adapter for discovery rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Make `CarouselRecipeCard` action-optional (reuse for static rows)

**Files:**

- Modify: `client/components/home/CarouselRecipeCard.tsx:39-45` (props), `:82-85` (favourite handler), `:203-246` (actions render)

**Interfaces:**

- Produces: `CarouselRecipeCardProps` with optional `isFavourited`, `onDismiss`, `onFavourite` and new `showActions?: boolean` (default `true`).

- [ ] **Step 1: LSP blast-radius check**

Warm up tsserver, then `findReferences` on `CarouselRecipeCard`. Expected consumers: `RecipeCarousel.tsx`, `CuratedRecipeCarousel.tsx` (both pass all props → unaffected by making them optional). Confirm no other callers.

- [ ] **Step 2: Update the props interface**

Replace `client/components/home/CarouselRecipeCard.tsx:39-45`:

```typescript
interface CarouselRecipeCardProps {
  card: CarouselCardType;
  isFavourited?: boolean;
  onPress: (card: CarouselCardType) => void;
  onDismiss?: (card: CarouselCardType) => void;
  onFavourite?: (recipeId: number) => void;
  /** When false, hides the favourite/dismiss action row (static preset rows). Default true. */
  showActions?: boolean;
}
```

Update the destructure (`:49-55`) to include defaults:

```typescript
export const CarouselRecipeCard = React.memo(function CarouselRecipeCard({
  card,
  isFavourited = false,
  onPress,
  onDismiss,
  onFavourite,
  showActions = true,
}: CarouselRecipeCardProps) {
```

- [ ] **Step 3: Guard the handlers and gate the actions render**

In `handleDismiss`/`handleFavourite` (`:76-85`) call optionally:

```typescript
const handleDismiss = useCallback(() => {
  haptics.impact();
  AccessibilityInfo.announceForAccessibility("Recipe dismissed");
  onDismiss?.(card);
}, [onDismiss, card, haptics]);

const handleFavourite = useCallback(() => {
  haptics.impact();
  onFavourite?.(card.id);
}, [haptics, onFavourite, card.id]);
```

Wrap the actions `View` (`:204-246`) so it only renders when `showActions`:

```tsx
{
  /* Action buttons */
}
{
  showActions ? (
    <View style={styles.actions}>
      {/* ...existing favourite + dismiss Pressables unchanged... */}
    </View>
  ) : null;
}
```

- [ ] **Step 4: Verify existing Home carousels still typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i carousel || echo "no carousel type errors"`
Expected: `no carousel type errors` (Home callers pass all props, still valid).

- [ ] **Step 5: Commit**

```bash
git add client/components/home/CarouselRecipeCard.tsx
git commit -m "refactor(home): make CarouselRecipeCard actions optional via showActions

Backward-compatible — Home callers pass all props. Lets discovery rows reuse
the card as tap-only tiles.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `useRecipeSearch` — optional `staleTime`

**Files:**

- Modify: `client/hooks/useRecipeSearch.ts:21-51`

**Interfaces:**

- Produces: `useRecipeSearch(params: RecipeSearchParams | null, options?: { staleTime?: number })`.

- [ ] **Step 1: LSP blast-radius check**

`findReferences` on `useRecipeSearch`. Expected: `RecipeBrowserScreen.tsx` (single-arg call → unaffected; new param is optional). Confirm.

- [ ] **Step 2: Add the optional options arg**

Change the signature and pass `staleTime` into `useInfiniteQuery` (`client/hooks/useRecipeSearch.ts:21-22` and the options object):

```typescript
export function useRecipeSearch(
  params: RecipeSearchParams | null,
  options?: { staleTime?: number },
) {
  const query = useInfiniteQuery<RecipeSearchResponse>({
    queryKey: ["/api/recipes/search", params ?? {}],
    initialPageParam: 0,
    staleTime: options?.staleTime,
    // ...rest unchanged...
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i userecipesearch || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useRecipeSearch.ts
git commit -m "feat(search): allow useRecipeSearch to set staleTime (protects 20/min budget)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `DISCOVERY_PRESETS` table

**Files:**

- Modify: `client/components/meal-plan/recipe-discovery-utils.ts`
- Test: `client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`

**Interfaces:**

- Produces: `DISCOVERY_STALE_TIME_MS` (number) and `DISCOVERY_PRESETS: { key: string; title: string; premiumOnly: boolean; params: RecipeSearchParams }[]`.

- [ ] **Step 1: Write the failing test (append)**

```typescript
import {
  DISCOVERY_PRESETS,
  DISCOVERY_STALE_TIME_MS,
} from "../recipe-discovery-utils";

describe("DISCOVERY_PRESETS", () => {
  it("defines pantry (premium), quick, and featured rows with local-only params", () => {
    const keys = DISCOVERY_PRESETS.map((p) => p.key);
    expect(keys).toEqual(["pantry", "quick", "featured"]);
    const pantry = DISCOVERY_PRESETS.find((p) => p.key === "pantry")!;
    expect(pantry.premiumOnly).toBe(true);
    expect(pantry.params.pantry).toBe(true);
    const quick = DISCOVERY_PRESETS.find((p) => p.key === "quick")!;
    expect(quick.params).toMatchObject({ maxPrepTime: 20, sort: "quickest" });
    expect(
      DISCOVERY_PRESETS.find((p) => p.key === "featured")!.params.curatedOnly,
    ).toBe(true);
    // No preset targets the Spoonacular source (discovery is local-only by construction).
    expect(
      DISCOVERY_PRESETS.every((p) => p.params.source !== "spoonacular"),
    ).toBe(true);
  });

  it("uses a 5-minute stale time", () => {
    expect(DISCOVERY_STALE_TIME_MS).toBe(5 * 60_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: FAIL — `DISCOVERY_PRESETS` undefined.

- [ ] **Step 3: Implement (append to recipe-discovery-utils.ts)**

```typescript
import type { RecipeSearchParams } from "@shared/types/recipe-search";

/** Cache discovery rows for 5 min so remounting the screen doesn't refetch and
 *  starve the 20/min `/api/recipes/search` budget. */
export const DISCOVERY_STALE_TIME_MS = 5 * 60_000;

const ROW_LIMIT = 10;

/** Local-only preset rows for the Discover feed. `pantry` is premiumOnly
 *  because `pantryTracking` is a premium feature — the feed hides it for free
 *  users (editorial rows carry their feed). */
export const DISCOVERY_PRESETS: {
  key: "pantry" | "quick" | "featured";
  title: string;
  premiumOnly: boolean;
  params: RecipeSearchParams;
}[] = [
  {
    key: "pantry",
    title: "From your pantry",
    premiumOnly: true,
    params: { pantry: true, limit: ROW_LIMIT },
  },
  {
    key: "quick",
    title: "Quick & Easy",
    premiumOnly: false,
    params: { maxPrepTime: 20, sort: "quickest", limit: ROW_LIMIT },
  },
  {
    key: "featured",
    title: "Featured",
    premiumOnly: false,
    params: { curatedOnly: true, limit: ROW_LIMIT },
  },
];
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/components/meal-plan/recipe-discovery-utils.ts client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts
git commit -m "feat(search): define local-only DISCOVERY_PRESETS table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `PresetRecipeRow` + `DiscoveryRow` components

**Files:**

- Create: `client/components/meal-plan/PresetRecipeRow.tsx`
- Create: `client/components/meal-plan/DiscoveryRow.tsx`

**Interfaces:**

- `PresetRecipeRow` props: `{ title: string; recipes: SearchableRecipe[]; isLoading: boolean; isError: boolean; onRetry: () => void; onOpenRecipe: (r: SearchableRecipe) => void; onSeeAll?: () => void }`. Renders nothing when not loading, not error, and `recipes.length === 0`.
- `DiscoveryRow` props: `{ title: string; params: RecipeSearchParams; onOpenRecipe: (r: SearchableRecipe) => void; onSeeAll?: () => void }`. Self-fetches via `useRecipeSearch(params, { staleTime: DISCOVERY_STALE_TIME_MS })`.

- [ ] **Step 1: Implement `PresetRecipeRow` (presentational)**

```tsx
// client/components/meal-plan/PresetRecipeRow.tsx
import React, { useCallback } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  Pressable,
  type ListRenderItemInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  CarouselRecipeCard,
  CARD_WIDTH,
} from "@/components/home/CarouselRecipeCard";
import { CarouselSkeleton } from "@/components/home/CarouselSkeleton";
import { CarouselError } from "@/components/home/CarouselError";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily } from "@/constants/theme";
import { toCarouselCard } from "./recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const SNAP_INTERVAL = CARD_WIDTH + Spacing.md;

interface PresetRecipeRowProps {
  title: string;
  recipes: SearchableRecipe[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSeeAll?: () => void;
}

export function PresetRecipeRow({
  title,
  recipes,
  isLoading,
  isError,
  onRetry,
  onOpenRecipe,
  onSeeAll,
}: PresetRecipeRowProps) {
  const { theme } = useTheme();

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchableRecipe>) => (
      <CarouselRecipeCard
        card={toCarouselCard(item)}
        showActions={false}
        onPress={() => onOpenRecipe(item)}
      />
    ),
    [onOpenRecipe],
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Header title={title} />
        <CarouselSkeleton />
      </View>
    );
  }
  if (isError && recipes.length === 0) {
    return (
      <View style={styles.container}>
        <Header title={title} />
        <CarouselError label={title.toLowerCase()} onRetry={onRetry} />
      </View>
    );
  }
  if (recipes.length === 0) return null; // row hides gracefully (e.g. empty pantry)

  return (
    <View style={styles.container} accessibilityRole="list">
      <Header title={title} onSeeAll={onSeeAll} theme={theme} />
      <FlatList
        data={recipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
        getItemLayout={(_, index) => ({
          length: SNAP_INTERVAL,
          offset: SNAP_INTERVAL * index,
          index,
        })}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

function Header({
  title,
  onSeeAll,
  theme,
}: {
  title: string;
  onSeeAll?: () => void;
  theme?: ReturnType<typeof useTheme>["theme"];
}) {
  const t = theme ?? useTheme().theme;
  return (
    <View style={styles.headerRow}>
      <ThemedText type="body" style={[styles.header, { color: t.text }]}>
        {title}
      </ThemedText>
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${title}`}
          hitSlop={8}
          style={styles.seeAll}
        >
          <ThemedText
            type="caption"
            style={{ color: t.link, fontFamily: FontFamily.semiBold }}
          >
            See all
          </ThemedText>
          <Feather
            name="chevron-right"
            size={14}
            color={t.link}
            accessible={false}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  header: { fontFamily: FontFamily.semiBold, fontSize: 17 },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
  listContent: { paddingHorizontal: Spacing.lg },
});
```

- [ ] **Step 2: Implement `DiscoveryRow` (data wrapper)**

```tsx
// client/components/meal-plan/DiscoveryRow.tsx
import React from "react";
import { useRecipeSearch } from "@/hooks/useRecipeSearch";
import { PresetRecipeRow } from "./PresetRecipeRow";
import { DISCOVERY_STALE_TIME_MS } from "./recipe-discovery-utils";
import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";

interface DiscoveryRowProps {
  title: string;
  params: RecipeSearchParams;
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSeeAll?: () => void;
}

export function DiscoveryRow({
  title,
  params,
  onOpenRecipe,
  onSeeAll,
}: DiscoveryRowProps) {
  const { data, isLoading, isError, refetch } = useRecipeSearch(params, {
    staleTime: DISCOVERY_STALE_TIME_MS,
  });
  return (
    <PresetRecipeRow
      title={title}
      recipes={data?.results ?? []}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      onOpenRecipe={onOpenRecipe}
      onSeeAll={onSeeAll}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "PresetRecipeRow|DiscoveryRow" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add client/components/meal-plan/PresetRecipeRow.tsx client/components/meal-plan/DiscoveryRow.tsx
git commit -m "feat(search): add reusable PresetRecipeRow + DiscoveryRow carousels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `RecipeDiscoveryFeed` + wire into the browser blank state

**Files:**

- Create: `client/components/meal-plan/RecipeDiscoveryFeed.tsx`
- Modify: `client/components/meal-plan/recipe-discovery-utils.ts` (add `isBlankBrowseState`)
- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx` (`:368-382` source/search wiring; `:853-902` render branch)
- Test: `client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts` (add `isBlankBrowseState` cases)

**Interfaces:**

- Produces: `RecipeDiscoveryFeed` props `{ onOpenRecipe: (r: SearchableRecipe) => void; onSelectCuisine: (cuisine: string) => void; onSeePreset: (key: "pantry" | "quick" | "featured") => void }`; `isBlankBrowseState(args): boolean`.
- Consumes: `DISCOVERY_PRESETS`, `DiscoveryRow`, `usePremiumContext`.

- [ ] **Step 1: Write the failing test for `isBlankBrowseState`**

```typescript
import { isBlankBrowseState } from "../recipe-discovery-utils";

describe("isBlankBrowseState", () => {
  const blank = {
    debouncedQuery: "",
    activeCuisine: undefined,
    activeDiet: undefined,
    activeDifficulty: undefined,
    curatedOnly: false,
    safeForMe: false,
    pantryMode: false,
    activeFilterCount: 0,
  };
  it("is true only when query, all chips, and all advanced filters are empty", () => {
    expect(isBlankBrowseState(blank)).toBe(true);
    expect(isBlankBrowseState({ ...blank, debouncedQuery: "thai" })).toBe(
      false,
    );
    expect(isBlankBrowseState({ ...blank, activeCuisine: "Italian" })).toBe(
      false,
    );
    expect(isBlankBrowseState({ ...blank, activeFilterCount: 1 })).toBe(false);
    expect(isBlankBrowseState({ ...blank, curatedOnly: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: FAIL — `isBlankBrowseState` undefined.

- [ ] **Step 3: Implement `isBlankBrowseState` (append to recipe-discovery-utils.ts)**

```typescript
export interface BlankBrowseArgs {
  debouncedQuery: string;
  activeCuisine: string | undefined;
  activeDiet: string | undefined;
  activeDifficulty: string | undefined;
  curatedOnly: boolean;
  safeForMe: boolean;
  pantryMode: boolean;
  activeFilterCount: number;
}

/** True when no query, chip, or advanced filter is active — the moment we show
 *  the Discover feed instead of a result list. */
export function isBlankBrowseState(a: BlankBrowseArgs): boolean {
  return (
    a.debouncedQuery.length === 0 &&
    !a.activeCuisine &&
    !a.activeDiet &&
    !a.activeDifficulty &&
    !a.curatedOnly &&
    !a.safeForMe &&
    !a.pantryMode &&
    a.activeFilterCount === 0
  );
}
```

> `isBlankBrowseState` lives in the single utils file `client/components/meal-plan/recipe-discovery-utils.ts` alongside the other helpers — the test's `../recipe-discovery-utils` import resolves there.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `RecipeDiscoveryFeed`**

```tsx
// client/components/meal-plan/RecipeDiscoveryFeed.tsx
import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";

import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, FontFamily } from "@/constants/theme";
import { DiscoveryRow } from "./DiscoveryRow";
import { DISCOVERY_PRESETS } from "./recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const CUISINES = [
  "Italian",
  "Mexican",
  "Asian",
  "Mediterranean",
  "American",
  "Indian",
];

interface RecipeDiscoveryFeedProps {
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSelectCuisine: (cuisine: string) => void;
  onSeePreset: (key: "pantry" | "quick" | "featured") => void;
  contentBottomInset?: number;
}

export function RecipeDiscoveryFeed({
  onOpenRecipe,
  onSelectCuisine,
  onSeePreset,
  contentBottomInset = 0,
}: RecipeDiscoveryFeedProps) {
  const { theme } = useTheme();
  const { isPremium } = usePremiumContext();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: Spacing.md,
        paddingBottom: contentBottomInset + Spacing.xl,
      }}
      showsVerticalScrollIndicator={false}
    >
      {DISCOVERY_PRESETS.filter((p) => !p.premiumOnly || isPremium).map((p) => (
        <DiscoveryRow
          key={p.key}
          title={p.title}
          params={p.params}
          onOpenRecipe={onOpenRecipe}
          onSeeAll={() => onSeePreset(p.key)}
        />
      ))}

      <View style={styles.cuisineSection}>
        <ThemedText type="body" style={[styles.header, { color: theme.text }]}>
          Browse by cuisine
        </ThemedText>
        <View style={styles.chipRow}>
          {CUISINES.map((c) => (
            <Chip
              key={c}
              label={c}
              variant="filter"
              selected={false}
              onPress={() => onSelectCuisine(c)}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cuisineSection: { paddingHorizontal: Spacing.lg, marginTop: Spacing.sm },
  header: {
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    marginBottom: Spacing.sm,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
});
```

- [ ] **Step 6: Wire into `RecipeBrowserScreen` — disable local fetch + render the feed when blank**

In `RecipeBrowserScreen.tsx`, after `activeFilterCount` is computed (`:429-439`) and before/around the source wiring (`:368-382`), compute the blank-browse flag and gate the local query. Add the import at the top (near `:51-60`):

```typescript
import { RecipeDiscoveryFeed } from "@/components/meal-plan/RecipeDiscoveryFeed";
import { isBlankBrowseState } from "@/components/meal-plan/recipe-discovery-utils";
```

Replace the local-search line (`:372`) so the full-list query is disabled while the feed is shown. Because `isBlankBrowseState` needs `activeFilterCount` (defined at `:429`), compute the flag right after `activeFilterCount` and pass `null` to `useRecipeSearch` accordingly — move the `localSearch`/`catalogSearch`/destructure block (`:372-382`) to _after_ `activeFilterCount`, then:

```typescript
const showDiscovery =
  !isOnlineSource &&
  isBlankBrowseState({
    debouncedQuery,
    activeCuisine,
    activeDiet,
    activeDifficulty,
    curatedOnly,
    safeForMe,
    pantryMode,
    activeFilterCount,
  });

const localSearch = useRecipeSearch(
  isOnlineSource || showDiscovery ? null : searchParams,
);
const catalogSearch = useCatalogSearch(searchParams, catalogEnabled);
const {
  data: searchData,
  isLoading,
  loadMore,
  isFetchingNextPage,
  error: searchError,
  refetch: refetchSearch,
} = isOnlineSource ? catalogSearch : localSearch;
```

> Hooks must stay unconditional and in stable order — you are only changing the _argument_ passed to `useRecipeSearch`, not whether it is called. Keep both `useRecipeSearch`/`useCatalogSearch` calls on every render.

- [ ] **Step 7: Render the feed in the results conditional**

In the render block, add a `showDiscovery` branch as the first case after the online-specific branches (insert before the `isLoading` branch at `:862`):

```tsx
      ) : showDiscovery ? (
        <RecipeDiscoveryFeed
          onOpenRecipe={handleRecipePress}
          onSelectCuisine={handleToggleCuisine}
          onSeePreset={(key) => {
            haptics.selection();
            if (key === "pantry") setPantryMode(true);
            else if (key === "featured") setCuratedOnly(true);
            else setAdvancedFilters((f) => ({ ...f, maxPrepTime: 20, sort: "quickest" }));
          }}
          contentBottomInset={insets.bottom}
        />
      ) : isLoading ? (
```

> `handleRecipePress`, `handleToggleCuisine`, `setPantryMode`, `setCuratedOnly`, `setAdvancedFilters`, `haptics`, and `insets` all already exist in the component.

- [ ] **Step 8: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "RecipeBrowserScreen|RecipeDiscoveryFeed" || echo "ok"`
Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: `ok` and PASS.

- [ ] **Step 9: Visual verification**

Use the `verify-ui` skill to launch `ocrecipes://recipe-browser` (or open via Meal Plan → Add Recipe) in the iOS Simulator. Assert: blank state shows the Discover feed (Quick & Easy + Featured rows render; pantry row only for a premium account), NOT an endless list; typing a query swaps to the result list.

- [ ] **Step 10: Commit**

```bash
git add client/components/meal-plan/RecipeDiscoveryFeed.tsx client/components/meal-plan/recipe-discovery-utils.ts client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts client/screens/meal-plan/RecipeBrowserScreen.tsx
git commit -m "feat(search): show curated Discover feed as the blank browse state

Replaces the endless blank-query list with local-only preset carousels
(Quick & Easy / Featured / pantry-when-premium) + cuisine chips. Disables the
full-list query while the feed is shown to protect the 20/min search budget.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 1 merge gate:** `npm run preflight` green → PR.

---

## Phase 2 — Home Front Door

### Task 7: `RecipeSearchEntry` + render on Home

**Files:**

- Create: `client/components/home/RecipeSearchEntry.tsx`
- Modify: `client/screens/HomeScreen.tsx` (render it at the top of the scroll content)

**Interfaces:**

- Produces: `RecipeSearchEntry` — a self-contained pressable that navigates to the `RecipeBrowserModal` root modal.

- [ ] **Step 1: Implement the entry component**

```tsx
// client/components/home/RecipeSearchEntry.tsx
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

export function RecipeSearchEntry() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        // RecipeBrowserModal is a root-stack modal (all params optional → no args).
        navigation.navigate("RecipeBrowserModal");
      }}
      accessibilityRole="button"
      accessibilityLabel="Search recipes"
      accessibilityHint="Opens recipe search and discovery"
      style={({ pressed }) => [
        styles.bar,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Feather
        name="search"
        size={18}
        color={theme.textSecondary}
        accessible={false}
      />
      <ThemedText type="body" style={{ color: theme.textSecondary }}>
        Search recipes…
      </ThemedText>
      <View style={{ flex: 1 }} />
      <Feather
        name="chevron-right"
        size={18}
        color={withOpacity(theme.text, 0.4)}
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
});
```

> **Navigation typing:** if `HomeScreenNavigationProp` does not include `RecipeBrowserModal` (it lives on the RootStack), navigate via the parent: `navigation.getParent()?.navigate("RecipeBrowserModal")`, or widen the nav type in `client/types/navigation.ts`. Verify against `RootStackParamList` in `client/navigation/RootStackNavigator.tsx` before finalizing.

- [ ] **Step 2: Render on Home**

Read `client/screens/HomeScreen.tsx`; import `RecipeSearchEntry` and render `<RecipeSearchEntry />` as the **first** element inside the main scroll content (above the existing carousels/sections), so the search front door is the first thing users see.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "RecipeSearchEntry|HomeScreen" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Visual verification**

Use `verify-ui` on `ocrecipes://` (Home). Assert the "Search recipes…" bar renders at the top and tapping it opens the recipe browser modal showing the Discover feed.

- [ ] **Step 5: Commit**

```bash
git add client/components/home/RecipeSearchEntry.tsx client/screens/HomeScreen.tsx
git commit -m "feat(home): add Search recipes front door to the Home tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 2 merge gate:** `npm run preflight` green → PR.

---

## Phase 3 — Local-First Search + Online CTA (larger restructure; deferrable)

> This phase replaces the either/or source swap (`isOnlineSource ? catalogSearch : localSearch`) with a local-first results view + an inline "Search online" CTA. For premium users the CTA appends Spoonacular results as a second section; for free users it opens `UpgradeModal` (the same gate the filter-sheet "Online" source carries today). The "Online" source option is removed from `SearchFilterSheet`. This is a render + query-coordination refactor — scope it as such.

### Task 8: `resolveOnlineCtaState` pure helper

**Files:**

- Modify: `client/components/meal-plan/recipe-discovery-utils.ts`
- Test: `client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`

**Interfaces:**

- Produces: `type OnlineCtaState = "hidden" | "premium-locked" | "actionable" | "loading" | "quota-exhausted"`; `resolveOnlineCtaState(args): OnlineCtaState`.

- [ ] **Step 1: Write the failing test**

```typescript
import { resolveOnlineCtaState } from "../recipe-discovery-utils";

describe("resolveOnlineCtaState", () => {
  const d = {
    catalogDisabled: false,
    isPremium: false,
    hasQuery: true,
    onlineRequested: false,
    onlineLoading: false,
    quotaExhausted: false,
  };
  it("hidden when catalog disabled or query empty", () => {
    expect(resolveOnlineCtaState({ ...d, catalogDisabled: true })).toBe(
      "hidden",
    );
    expect(resolveOnlineCtaState({ ...d, hasQuery: false })).toBe("hidden");
  });
  it("premium-locked for free users with a query", () => {
    expect(resolveOnlineCtaState(d)).toBe("premium-locked");
  });
  it("premium flow: actionable → loading → quota-exhausted", () => {
    expect(resolveOnlineCtaState({ ...d, isPremium: true })).toBe("actionable");
    expect(
      resolveOnlineCtaState({
        ...d,
        isPremium: true,
        onlineRequested: true,
        onlineLoading: true,
      }),
    ).toBe("loading");
    expect(
      resolveOnlineCtaState({
        ...d,
        isPremium: true,
        onlineRequested: true,
        quotaExhausted: true,
      }),
    ).toBe("quota-exhausted");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: FAIL — `resolveOnlineCtaState` undefined.

- [ ] **Step 3: Implement**

```typescript
export type OnlineCtaState =
  | "hidden"
  | "premium-locked"
  | "actionable"
  | "loading"
  | "quota-exhausted";

export function resolveOnlineCtaState(a: {
  catalogDisabled: boolean;
  isPremium: boolean;
  hasQuery: boolean;
  onlineRequested: boolean;
  onlineLoading: boolean;
  quotaExhausted: boolean;
}): OnlineCtaState {
  if (a.catalogDisabled || !a.hasQuery) return "hidden";
  if (!a.isPremium) return "premium-locked";
  if (a.onlineRequested && a.quotaExhausted) return "quota-exhausted";
  if (a.onlineRequested && a.onlineLoading) return "loading";
  return "actionable";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/components/meal-plan/recipe-discovery-utils.ts client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts
git commit -m "feat(search): add resolveOnlineCtaState helper for the online CTA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Restructure results to local-first + online CTA (SectionList)

**Files:**

- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx` (`:365-388` query wiring; `:830-927` results render)
- Modify: `client/components/meal-plan/SearchFilterSheet.tsx:47-52` (remove "Online" source option)

**Interfaces:**

- Consumes: `resolveOnlineCtaState`, `useCatalogSearch`, `UpgradeModal`, existing `handleRecipePress`.

- [ ] **Step 1: Remove the "Online" source option from the filter sheet**

`client/components/meal-plan/SearchFilterSheet.tsx:47-52` → drop the spoonacular entry (the inline CTA now carries online search):

```typescript
const SOURCE_OPTIONS: { value: SourceOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "personal", label: "My Recipes" },
  { value: "community", label: "Community" },
];
```

Leave the `SourceOption` type (`:22`) as-is — `"spoonacular"` is still a valid value the CTA uses internally.

- [ ] **Step 2: Replace source-swap wiring with an explicit online-request flag**

In `RecipeBrowserScreen.tsx`, replace the `isOnlineSource`-based swap (`:368-382`). Local search is now always the primary; online is requested imperatively:

```typescript
const [onlineRequested, setOnlineRequested] = useState(false);

// Reset the online request whenever the query changes (a new search starts local-first).
React.useEffect(() => {
  setOnlineRequested(false);
}, [debouncedQuery]);

const localSearch = useRecipeSearch(showDiscovery ? null : searchParams);
const catalogEnabled =
  onlineRequested && isPremium && debouncedQuery.length > 0;
const catalogSearch = useCatalogSearch(searchParams, catalogEnabled);

const {
  data: localData,
  isLoading,
  loadMore,
  isFetchingNextPage,
} = localSearch;
const localResults = localData?.results ?? [];
const onlineResults = catalogSearch.data?.results ?? [];
const quotaExhausted = isQuotaExceededError(catalogSearch.error);

const ctaState = resolveOnlineCtaState({
  catalogDisabled: false, // server hides via empty results; treat key-present as enabled
  isPremium,
  hasQuery: debouncedQuery.length > 0,
  onlineRequested,
  onlineLoading: catalogSearch.isLoading,
  quotaExhausted,
});

const onPressOnlineCta = useCallback(() => {
  haptics.selection();
  if (!isPremium) {
    setShowUpgradeModal(true);
    return;
  }
  setOnlineRequested(true);
}, [haptics, isPremium]);
```

> Remove the now-unused `isOnlineSource`, `catalogEnabled` (old), `isQuotaExceeded`/`isOnlineError` branches and the screen-reader effect tied to them (`:384-408`) — or repoint that effect at `quotaExhausted`. Keep `advancedFilters.source` for the local All/My/Community filter.

- [ ] **Step 3: Render local-first results + CTA + online section via `SectionList`**

Replace the results render (`:903-927` list branch) with a `SectionList` carrying a local section and (when online results exist) a web section, with the CTA as the local section's footer. Import `SectionList` from `react-native`. Sketch:

```tsx
      ) : (
        <SectionList
          sections={[
            { key: "local", title: `From OCRecipes`, data: localResults },
            ...(onlineResults.length > 0 ? [{ key: "web", title: "From the web", data: onlineResults }] : []),
          ]}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <ThemedText type="caption" style={[styles.sectionHeader, { color: theme.textSecondary }]}>
              {section.title}
            </ThemedText>
          )}
          renderSectionFooter={({ section }) =>
            section.key === "local" && ctaState !== "hidden" ? (
              <OnlineSearchCta state={ctaState} onPress={onPressOnlineCta} onRetry={() => void catalogSearch.refetch()} />
            ) : null
          }
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
          ItemSeparatorComponent={ItemSeparator}
          onEndReached={loadMore ? () => loadMore() : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={{ paddingVertical: Spacing.lg }} color={theme.link} /> : null}
        />
      )}
```

> `OnlineSearchCta` is a small new presentational component (a dashed terracotta card) keyed off `ctaState`: `premium-locked` → "🔒 Search online · Premium"; `actionable` → "🌐 Search online for more"; `loading` → spinner; `quota-exhausted` → "Online search is temporarily unavailable" + Retry. Build it in `client/components/meal-plan/OnlineSearchCta.tsx` mirroring `CarouselError`'s styling conventions. The free-user `premium-locked` press calls `onPress` (which opens `UpgradeModal`).

- [ ] **Step 4: Typecheck + unit tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "RecipeBrowserScreen|SearchFilterSheet|OnlineSearchCta" || echo "ok"`
Run: `npx vitest run client/components/meal-plan/__tests__/recipe-discovery-utils.test.ts`
Expected: `ok` and PASS.

- [ ] **Step 5: Visual verification (both tiers)**

Use `verify-ui`. Free account: search → local results + "Search online · Premium" CTA → tap → UpgradeModal, **no** network call. Premium account: tap CTA → "From the web" section appends with online results; exhaust-quota path shows the "temporarily unavailable" copy.

- [ ] **Step 6: Commit**

```bash
git add client/screens/meal-plan/RecipeBrowserScreen.tsx client/components/meal-plan/SearchFilterSheet.tsx client/components/meal-plan/OnlineSearchCta.tsx
git commit -m "feat(search): local-first results with inline Search online CTA

Replaces the either/or source swap. Local results always show first; the CTA
carries the existing Spoonacular premium gate (free → upgrade, premium →
appends a From-the-web section). Removes the filter-sheet Online toggle.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Regression sweep for removed online-source assumptions

**Files:**

- Modify/inspect: any test asserting the old source-toggle behavior; `client/screens/meal-plan/__tests__/*`, `recipe-browser-utils` tests.

- [ ] **Step 1: Find stale references**

Run: `grep -rn "spoonacular\|isOnlineSource\|shouldGatePremiumSource\|Online" client/screens/meal-plan client/components/meal-plan --include=*.ts --include=*.tsx`
Inspect each hit: update tests that asserted the filter-sheet "Online" option or the swap behavior to the new CTA flow. `shouldGatePremiumSource` may now be unused — if so, remove it and its tests (per the wide-deletion-sweep rule, check `recipe-browser-utils` tests too).

- [ ] **Step 2: Run the meal-plan test suite**

Run: `npx vitest run client/screens/meal-plan client/components/meal-plan`
Expected: PASS (update assertions as needed).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(search): update meal-plan tests for the local-first online CTA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 3 merge gate:** `npm run preflight` green → PR.

---

## Self-Review

**Spec coverage:**

- Discover feed replacing endless blank list → Tasks 4–6. ✓
- Local recipes only / pantry premium-gated / auto-hide → DISCOVERY_PRESETS (premiumOnly) + `PresetRecipeRow` empty→null. ✓
- Reuse `CarouselRecipeCard`/skeleton/error + adapter → Tasks 1, 2, 5. ✓
- staleTime to protect the 20/min budget → Task 3 + DISCOVERY_STALE_TIME_MS. ✓
- Home front door (no new tab/route) → Task 7 (reuses `RecipeBrowserModal`). ✓
- Local-first + online CTA, gate relocated, "Online" toggle removed → Tasks 8, 9. ✓
- Two-tier CTA behavior (free→Upgrade, premium→append) + global-402 copy → `resolveOnlineCtaState` + `OnlineSearchCta`. ✓
- No backend changes; Spoonacular stays premium → no server/`premium.ts` task exists. ✓

**Placeholder scan:** No "TBD"/"add error handling"-style steps; each code step shows full code. `OnlineSearchCta` (Task 9 Step 3) is described with its four concrete states rather than full code — acceptable as the last task of the deferrable phase, but the implementer should write it out before merging Phase 3.

**Type consistency:** `toCarouselCard`/`parseSearchableRecipeNumericId`/`DISCOVERY_PRESETS`/`isBlankBrowseState`/`resolveOnlineCtaState` names are used identically across tasks. `SearchableRecipe.id` is string throughout; the numeric-id conversion is isolated to the adapter and `handleRecipePress` (existing). `CarouselRecipeCard` optional props are backward-compatible with the Home callers.

**Known follow-ups (not blockers):** the deferred free-tier 3/day rate-limit (spec §9, with the H7 detail-bounding constraint) is intentionally out of scope.
