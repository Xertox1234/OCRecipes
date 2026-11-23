# Discover + Search Redesign — Phase 3 Implementation Plan (local-first + online CTA)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> This plan supersedes Tasks 8–10 of `2026-06-25-discover-search-redesign.md`. Phases 1–2 are MERGED (PR #457, main @ `ec394747`); base this branch on that.

**Goal:** Replace the either/or local-vs-online source toggle with a **local-first results view** plus an inline **"Search online" CTA** that carries the existing Spoonacular premium gate, and hide that CTA when the deployment has no catalog (`SPOONACULAR_API_KEY` unset) via a small read-only server capability flag.

**Architecture:** Mostly frontend. ONE scoped, user-approved server addition: a read-only `GET /api/meal-plan/catalog/config` capability probe (`{ enabled }`) so the client can satisfy spec §6 (CTA hidden when the catalog is unconfigured) — which is otherwise undetectable client-side. The premium gate on catalog `/search`, `/:id`, `/save` is **unchanged**.

**Tech Stack:** Expo/React Native 0.81, React 19 (React Compiler active), TanStack Query v5, Express 5, Drizzle, Zod, TypeScript strict, Vitest. Theme via `useTheme().theme` + `withOpacity(color, 0–1)`.

## Global Constraints

- **Scope exception (user-approved 2026-06-26):** Phases 1–2 were frontend-only; Phase 3 adds exactly ONE server surface — the `/catalog/config` capability probe (Task 1). NO other `server/` change, NO `shared/schema.ts` change, NO `premium.ts` change. Spoonacular `/search`, `/:id`, `/save` stay premium-gated via `checkPremiumFeature(…, "catalogSave")` exactly as today.
- **Capability ≠ authorization.** `/catalog/config` reports only whether the catalog is _configured_; it does NOT gate access and is NOT premium-gated. It must not change who can call the gated endpoints.
- **Cross-platform.** iOS **and** Android.
- **Theme system.** Colors via `useTheme().theme`; opacities via `withOpacity(color, 0–1)`. No hardcoded hex except existing white-on-overlay cases.
- **Accessibility.** Interactive elements need `accessibilityRole` + `accessibilityLabel`.
- **React Compiler active.** No manual `React.memo`/`useCallback` purely for identity; `useMemo` for FlatList/SectionList `data` is fine.
- **Hooks stay unconditional.** `useRecipeSearch`/`useCatalogSearch`/`useCatalogConfig` are all called on every render; only their _arguments_/`enabled` flags change. Never call a hook conditionally.
- **Test pattern.** Pure logic in `*-utils.ts`, tested via Vitest under `__tests__/` with a distinct basename from siblings.
- **LSP-first for shared symbols.** Warm tsserver with a `hover`, then `findReferences` before editing `useCatalogSearch`, `recipe-browser-utils.ts`, or `SearchFilterSheet`.
- **Minimal changes.** Touch only what each task needs.
- **Verification.** `npm run preflight` before opening the PR.
- **Commits** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Merged-code reality (trust this over the Phase-1 plan's stale line numbers):**

- `RecipeBrowserScreen.tsx` already has (from Phase 1): `showDiscovery` blank-state gating, `isOnlineSource = advancedFilters.source === "spoonacular"` (~L370), `catalogEnabled = isOnlineSource && isPremium && debouncedQuery.length > 0` (~L415), `const catalogSearch = useCatalogSearch(searchParams, catalogEnabled)` (~L423), and a render that swaps `isOnlineSource ? catalogSearch : localSearch` (~L432). The results list is `AnimatedFlatList` (~L264, L944). `UpgradeModal`+`showUpgradeModal`/`setShowUpgradeModal` (L305/L1000), `handleRecipePress` (L465), `handleToggleCuisine` (L535, used by the filter-bar cuisine chips ~L719 — keep it), `renderItem` (L570), `ItemSeparator` (L83), `insets` (L272), `usePremiumContext`/`isPremium` (L308) all exist.
- `recipe-browser-utils.ts` exports `shouldGatePremiumSource(nextSource, isPremium)` and `isQuotaExceededError(error)`, with `__tests__/recipe-browser-utils.test.ts` present.
- `SearchFilterSheet.tsx`: `type SourceOption = "all" | "personal" | "community" | "spoonacular"` (L22); `SOURCE_OPTIONS` (L47) includes `{ value: "spoonacular", label: "Online" }` (L51).

---

## Task 1: Server — catalog-config capability endpoint + shared schema

**Files:**

- Modify: `shared/types/recipe-catalog.ts` (append schema)
- Modify: `server/routes/recipe-catalog.ts` (add route inside `register()`, BEFORE the `/:id` route)
- Test: `server/routes/__tests__/recipe-catalog.test.ts` (extend)

**Interfaces:**

- Produces: `catalogConfigResponseSchema` (`z.object({ enabled: z.boolean() })`), `type CatalogConfigResponse`; `GET /api/meal-plan/catalog/config` → `{ enabled: boolean }`.

> **CRITICAL ordering:** `GET /api/meal-plan/catalog/:id` already exists. Express matches in registration order, so `/catalog/config` would be captured by `/:id` (`:id="config"` → `parsePositiveIntParam` returns null → 400) unless `/config` is registered **before** `/:id`. Register the new route immediately after the `/search` route and before `/:id`.

- [ ] **Step 1: Add the shared schema**

Append to `shared/types/recipe-catalog.ts`:

```typescript
/** Response of GET /api/meal-plan/catalog/config — reports whether this
 *  deployment has the online catalog configured (SPOONACULAR_API_KEY present).
 *  Capability probe only; does not affect the premium gate. */
export const catalogConfigResponseSchema = z.object({ enabled: z.boolean() });
export type CatalogConfigResponse = z.infer<typeof catalogConfigResponseSchema>;
```

- [ ] **Step 2: Add the route (before `/:id`)**

In `server/routes/recipe-catalog.ts`, inside `register(app)`, immediately AFTER the `/api/meal-plan/catalog/search` route block and BEFORE the `/api/meal-plan/catalog/:id` route block:

```typescript
// GET /api/meal-plan/catalog/config — capability probe: is the online catalog
// configured for this deployment? NOT premium-gated and NOT a quota cost — the
// premium gate on /search, /:id, /save is unchanged. Read process.env at
// REQUEST time (not a module-load const) so tests can toggle it.
// MUST be registered before /catalog/:id (else the param route swallows
// "config" → 400 invalid id).
app.get(
  "/api/meal-plan/catalog/config",
  requireAuth,
  (_req: AuthenticatedRequest, res: Response): void => {
    res.json({ enabled: Boolean(process.env.SPOONACULAR_API_KEY) });
  },
);
```

- [ ] **Step 3: Write tests**

Read `server/routes/__tests__/recipe-catalog.test.ts` first and mirror its existing supertest + auth-mock setup. Add a `describe("GET /api/meal-plan/catalog/config")` with:

- key set → `200 { enabled: true }` (save/restore `process.env.SPOONACULAR_API_KEY` around the test; set it before the request).
- key unset → `200 { enabled: false }` (delete the env var for the test, restore after).
- **route-ordering guard:** the `/config` request returns the `{ enabled }` body and is NOT a `400` "Invalid catalog ID" (proves `/:id` didn't swallow it).

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/routes/__tests__/recipe-catalog.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add shared/types/recipe-catalog.ts server/routes/recipe-catalog.ts server/routes/__tests__/recipe-catalog.test.ts
git commit -m "feat(search): add /catalog/config capability probe (online-catalog availability)

Read-only, not premium-gated; registered before /catalog/:id to avoid the
param route swallowing it. Lets the client hide the Search-online CTA when
SPOONACULAR_API_KEY is unset (spec §6).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `resolveOnlineCtaState` pure helper

**Files:**

- Modify: `client/screens/meal-plan/recipe-browser-utils.ts` (append)
- Test: `client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts` (extend)

**Interfaces:**

- Produces: `type OnlineCtaState = "hidden" | "premium-locked" | "actionable" | "loading" | "quota-exhausted"`; `resolveOnlineCtaState(args): OnlineCtaState`.

> Lives in `recipe-browser-utils.ts` (next to `shouldGatePremiumSource`/`isQuotaExceededError`), per spec §5.5 — NOT in `recipe-discovery-utils.ts`.

- [ ] **Step 1: Write the failing test (extend `recipe-browser-utils.test.ts`)**

```typescript
import { resolveOnlineCtaState } from "../recipe-browser-utils";

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

Run: `npx vitest run client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts`
Expected: FAIL — `resolveOnlineCtaState` undefined.

- [ ] **Step 3: Implement (append to `recipe-browser-utils.ts`)**

```typescript
export type OnlineCtaState =
  | "hidden"
  | "premium-locked"
  | "actionable"
  | "loading"
  | "quota-exhausted";

/** Selects how the inline "Search online" CTA presents, given catalog
 *  availability, the user's tier, and the online request's progress. Pure —
 *  unit-tested without rendering. quota-exhausted/loading apply only after the
 *  premium user has actually requested the online search. */
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

Run: `npx vitest run client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/screens/meal-plan/recipe-browser-utils.ts client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts
git commit -m "feat(search): add resolveOnlineCtaState helper for the inline online CTA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `useCatalogConfig` client hook

**Files:**

- Create: `client/hooks/useCatalogConfig.ts`
- Test: `client/hooks/__tests__/useCatalogConfig.test.ts`

**Interfaces:**

- Consumes: `catalogConfigResponseSchema` (Task 1).
- Produces: `useCatalogConfig()` → TanStack `UseQueryResult` whose `data` is `{ enabled: boolean }`.

- [ ] **Step 1: Implement the hook**

```typescript
// client/hooks/useCatalogConfig.ts
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { catalogConfigResponseSchema } from "@shared/types/recipe-catalog";

/**
 * Reports whether this deployment has the online recipe catalog configured
 * (server has SPOONACULAR_API_KEY). Used to hide the "Search online" CTA when
 * the catalog is unavailable. Deployment config is stable at runtime → cached
 * indefinitely (one fetch per app session).
 */
export function useCatalogConfig() {
  return useQuery({
    queryKey: ["/api/meal-plan/catalog/config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/meal-plan/catalog/config");
      const json = await res.json();
      return catalogConfigResponseSchema.parse(json);
    },
    staleTime: Infinity,
  });
}
```

- [ ] **Step 2: Write the test**

Read `client/hooks/__tests__/useCatalogSearch.test.ts` first and mirror its harness (QueryClientProvider wrapper, `apiRequest` mock, `renderHook`/`waitFor`). Cases:

- mocked `apiRequest` resolves `{ enabled: true }` → `result.current.data` becomes `{ enabled: true }`.
- mocked resolves `{ enabled: false }` → `{ enabled: false }`.
- mocked resolves an invalid shape (e.g. `{}`) → the query errors (schema `.parse` throws).

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i catalogconfig || echo "ok"`
Run: `npx vitest run client/hooks/__tests__/useCatalogConfig.test.ts`
Expected: `ok` and PASS.

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useCatalogConfig.ts client/hooks/__tests__/useCatalogConfig.test.ts
git commit -m "feat(search): add useCatalogConfig hook (online-catalog availability probe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Local-first results + inline online CTA (the restructure)

**Files:**

- Create: `client/components/meal-plan/OnlineSearchCta.tsx`
- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx` (query wiring ~L365–437; results render ~L840–1005)
- Modify: `client/components/meal-plan/SearchFilterSheet.tsx:47–52` (remove the "Online" source option)

**Interfaces:**

- Consumes: `resolveOnlineCtaState`, `OnlineCtaState`, `shouldGatePremiumSource`, `isQuotaExceededError` (recipe-browser-utils); `useCatalogConfig`; `useCatalogSearch`; `UpgradeModal`; existing `handleRecipePress`/`renderItem`/`ItemSeparator`/`insets`.

> **Read the current `RecipeBrowserScreen.tsx` query-wiring (~L360–440) and results-render (~L840–1005) before editing — line numbers above are approximate.** This is a query-coordination refactor: today the screen _swaps_ `isOnlineSource ? catalogSearch : localSearch`. After this task, **local search is always primary**; the online query fires **imperatively** on CTA tap (premium only) and renders as a second labelled section. Hooks stay unconditional.

- [ ] **Step 1: Build `OnlineSearchCta` (presentational, keyed off `OnlineCtaState`)**

```tsx
// client/components/meal-plan/OnlineSearchCta.tsx
import React from "react";
import { Pressable, StyleSheet, View, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { OnlineCtaState } from "@/screens/meal-plan/recipe-browser-utils";

interface OnlineSearchCtaProps {
  state: OnlineCtaState; // caller guarantees !== "hidden"
  onPress: () => void;
  onRetry: () => void;
}

export function OnlineSearchCta({
  state,
  onPress,
  onRetry,
}: OnlineSearchCtaProps) {
  const { theme } = useTheme();
  // Brand accent for text/icons/tints is `theme.link` (terracotta; see
  // client/constants/theme.ts:19 — "Use `link` for text/icons/tints,
  // accentSolid for fills"). There is NO `theme.primary` key — do not use one.
  const accent = theme.link;

  if (state === "hidden") return null;

  if (state === "loading") {
    return (
      <View
        style={[styles.card, { borderColor: withOpacity(accent, 0.4) }]}
        accessibilityRole="text"
      >
        <ActivityIndicator color={accent} />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Searching online…
        </ThemedText>
      </View>
    );
  }

  if (state === "quota-exhausted") {
    return (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry online search"
        style={({ pressed }) => [
          styles.card,
          {
            borderColor: withOpacity(accent, 0.4),
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather
          name="alert-circle"
          size={16}
          color={theme.textSecondary}
          accessible={false}
        />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Online search is temporarily unavailable. Tap to retry.
        </ThemedText>
      </Pressable>
    );
  }

  const locked = state === "premium-locked";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        locked
          ? "Search online for more recipes, Premium"
          : "Search online for more recipes"
      }
      style={({ pressed }) => [
        styles.card,
        { borderColor: withOpacity(accent, 0.4), opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Feather
        name={locked ? "lock" : "globe"}
        size={16}
        color={accent}
        accessible={false}
      />
      <ThemedText
        type="body"
        style={{ color: accent, fontFamily: FontFamily.semiBold }}
      >
        {locked ? "Search online · Premium" : "Search online for more"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginVertical: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.card,
  },
});
```

- [ ] **Step 2: Remove the "Online" source option from `SearchFilterSheet.tsx`**

Drop the spoonacular entry from `SOURCE_OPTIONS` (the inline CTA now carries online search). Leave the `SourceOption` type (`:22`) including `"spoonacular"` — still used internally by the CTA gate call.

```typescript
const SOURCE_OPTIONS: { value: SourceOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "personal", label: "My Recipes" },
  { value: "community", label: "Community" },
];
```

- [ ] **Step 3: Rewire the query coordination in `RecipeBrowserScreen.tsx`**

Add imports (top, near the other `@/components/meal-plan` / `@/hooks` imports):

```typescript
import { SectionList } from "react-native"; // add to the existing react-native import group
import { useCatalogConfig } from "@/hooks/useCatalogConfig";
import { OnlineSearchCta } from "@/components/meal-plan/OnlineSearchCta";
import { resolveOnlineCtaState } from "@/screens/meal-plan/recipe-browser-utils";
```

> **The results list MUST stay animated.** The screen has a scroll-linked collapsing header (`useScrollLinkedHeader` ~L281; `Animated.View` header ~L649–815) driven by `onScroll={scrollHandler}` + `scrollEventThrottle={16}` on the current `AnimatedFlatList` (~L264, L954–955). Define an animated SectionList beside the existing `AnimatedFlatList` (mirror its `as unknown as typeof …` cast exactly):
>
> ```typescript
> const AnimatedSectionList = Animated.createAnimatedComponent(
>   SectionList,
> ) as unknown as typeof SectionList;
> ```
>
> and forward `onScroll={scrollHandler}` + `scrollEventThrottle={16}` to it (Step 4) so the collapsing header keeps working. A plain `SectionList` would silently break the header — do NOT use one.

Replace the Phase-1 `isOnlineSource`-swap wiring (the `isOnlineSource`/`catalogEnabled`/`{ data, isLoading, … } = isOnlineSource ? catalogSearch : localSearch`/`isQuotaExceeded`/`isOnlineError` block, ~L370–437) with local-first + imperative online:

```typescript
const catalogConfig = useCatalogConfig();
// Only treat the catalog as disabled once the probe has confirmed it (avoid
// hiding the CTA during the initial load); undefined while loading → shown.
const catalogDisabled = catalogConfig.data?.enabled === false;

const [onlineRequested, setOnlineRequested] = useState(false);
// A new query starts local-first — reset any prior online request.
useEffect(() => {
  setOnlineRequested(false);
}, [debouncedQuery]);

// Local search is always primary (still suppressed by the Phase-1 discovery feed).
const localSearch = useRecipeSearch(showDiscovery ? null : searchParams);
const catalogEnabled =
  onlineRequested && isPremium && !catalogDisabled && debouncedQuery.length > 0;
const catalogSearch = useCatalogSearch(searchParams, catalogEnabled);

const {
  data: searchData,
  isLoading,
  loadMore,
  isFetchingNextPage,
  error: searchError,
  refetch: refetchSearch,
} = localSearch;

const localResults = searchData?.results ?? [];
const onlineResults = catalogSearch.data?.results ?? [];
const quotaExhausted = isQuotaExceededError(catalogSearch.error);

const ctaState = resolveOnlineCtaState({
  catalogDisabled,
  isPremium,
  hasQuery: debouncedQuery.length > 0,
  onlineRequested,
  onlineLoading: catalogSearch.isLoading,
  quotaExhausted,
});

const onPressOnlineCta = useCallback(() => {
  haptics.selection();
  // Reuse the shared premium gate (spec §5.4) — free users get the upgrade hook.
  if (shouldGatePremiumSource("spoonacular", isPremium)) {
    setShowUpgradeModal(true);
    return;
  }
  setOnlineRequested(true);
}, [haptics, isPremium]);
```

> Ensure `useEffect`, `useCallback`, `useState` are imported. Keep `shouldGatePremiumSource` imported (now used by the CTA, not the source toggle). Remove the now-dead `isOnlineSource`/`isQuotaExceeded`/`isOnlineError` locals and any render branch that referenced them (see Step 4). Keep `advancedFilters.source` for the local All/My/Community filter and `handleToggleCuisine` for the filter-bar chips. Keep the Phase-1 `showDiscovery` branch unchanged.

- [ ] **Step 4: Render local-first results + CTA + online section**

Replace the results-list branch (the `AnimatedFlatList` results render and the old online-specific empty/error branches ~L855–1000, but NOT the `showDiscovery` feed branch and NOT the loading/empty states you still want) with a `SectionList`. The CTA is the local section's footer; the web section appears only once online results exist.

```tsx
      ) : (
        <AnimatedSectionList
          sections={[
            { key: "local", title: `From OCRecipes`, data: localResults },
            ...(onlineResults.length > 0
              ? [{ key: "web", title: "From the web · Spoonacular", data: onlineResults }]
              : []),
          ]}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) =>
            // Hide the local header in the blank "no local results yet" case if desired;
            // keep simple — always render the labelled header.
            (
              <ThemedText
                type="caption"
                style={[styles.sectionHeader, { color: theme.textSecondary }]}
              >
                {section.title}
              </ThemedText>
            )
          }
          renderSectionFooter={({ section }) =>
            section.key === "local" && ctaState !== "hidden" ? (
              <OnlineSearchCta
                state={ctaState}
                onPress={onPressOnlineCta}
                onRetry={() => void catalogSearch.refetch()}
              />
            ) : null
          }
          ItemSeparatorComponent={ItemSeparator}
          onEndReached={loadMore ? () => loadMore() : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ paddingVertical: Spacing.lg }} color={theme.link} />
            ) : null
          }
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
```

> Add a `sectionHeader` style (e.g. `{ fontFamily: FontFamily.semiBold, paddingTop: Spacing.md, paddingBottom: Spacing.xs }`). Use the `AnimatedSectionList` defined in Step 3 (NOT a plain `SectionList`) with `onScroll={scrollHandler}` + `scrollEventThrottle={16}` so the existing collapsing header keeps working — the current `AnimatedFlatList` results list wires exactly those props (~L954–955); the SectionList replacement MUST preserve them. Preserve the existing loading and zero-result render branches (a query with no local results but `ctaState !== "hidden"` should STILL show the CTA so the user can escalate to online — verify the empty-results path still renders the local section + CTA footer, or special-case it). Read the current render conditional (~L840–1005) and remove ONLY the dead `isOnlineSource`/`isQuotaExceeded`/`isOnlineError` branches you replaced; if you remove a branch, confirm nothing else references its locals (report any you were unsure about as DONE_WITH_CONCERNS).

- [ ] **Step 5: Typecheck + unit tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "RecipeBrowserScreen|SearchFilterSheet|OnlineSearchCta" || echo "ok"`
Run: `npx vitest run client/screens/meal-plan client/components/meal-plan`
Expected: `ok`; tests pass (some meal-plan assertions about the old toggle move to Task 5).

- [ ] **Step 6: Commit**

```bash
git add client/components/meal-plan/OnlineSearchCta.tsx client/screens/meal-plan/RecipeBrowserScreen.tsx client/components/meal-plan/SearchFilterSheet.tsx
git commit -m "feat(search): local-first results with inline Search online CTA

Local results always render first; the CTA carries the existing Spoonacular
premium gate (free → UpgradeModal, premium → appends a From-the-web section)
and hides when the catalog is unconfigured. Removes the filter-sheet Online
source toggle. Online query fires imperatively on CTA tap, not via source swap.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Regression sweep for the removed online-source toggle

**Files:**

- Modify/inspect: `client/screens/meal-plan/__tests__/*`, `client/components/meal-plan/__tests__/*`, `recipe-browser-utils.test.ts`.

- [ ] **Step 1: Find stale references**

Run: `grep -rn "isOnlineSource\|isQuotaExceeded\b\|isOnlineError\|label: \"Online\"\|source.*spoonacular" client/screens/meal-plan client/components/meal-plan --include="*.ts" --include="*.tsx"`
Inspect each hit. Update or remove tests that asserted the filter-sheet "Online" option or the local/online swap behavior to reflect the new CTA flow. `shouldGatePremiumSource` is STILL used (by the CTA) — do NOT delete it or its tests. If the filter-sheet source-change handler still calls `shouldGatePremiumSource` with a source that can no longer be "spoonacular", that guard is harmless; leave it unless trivially simplifiable.

- [ ] **Step 2: Run the meal-plan suites**

Run: `npx vitest run client/screens/meal-plan client/components/meal-plan client/hooks/__tests__/useCatalogConfig.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(search): update meal-plan tests for the local-first online CTA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 3 merge gate:** `npm run preflight` green → PR.

---

## Self-Review

- **Spec §6 (CTA hidden when key unset):** Task 1 server probe + Task 3 hook + Task 4 `catalogDisabled` wiring → satisfied to the letter. ✓
- **Local-first + online CTA, gate relocated, toggle removed:** Tasks 2, 4. ✓
- **Premium gate unchanged:** `/search`/`/:id`/`/save` untouched; `/config` is not gated and not a quota cost. ✓
- **Two-tier CTA (free→Upgrade, premium→append) + global-402 copy:** `resolveOnlineCtaState` + `OnlineSearchCta` + `shouldGatePremiumSource` reuse. ✓
- **Hooks unconditional:** `useCatalogConfig`/`useRecipeSearch`/`useCatalogSearch` all called every render; only args/`enabled` change. ✓
- **Type consistency:** `OnlineCtaState`/`resolveOnlineCtaState`/`catalogConfigResponseSchema`/`useCatalogConfig` names used identically across tasks; `SearchableRecipe.id` stays string.
- **Known follow-up (not a blocker):** deferred free-tier 3/day rate-limit (spec §9, H7 detail-bounding) remains out of scope.
