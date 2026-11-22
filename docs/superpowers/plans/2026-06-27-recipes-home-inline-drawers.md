# Recipes Home Inline Drawers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Home screen's Recipes section, make "Search Recipes" and "Generate Recipe" open an inline accordion drawer (glides the row to the top, reveals a mini-interface) instead of navigating to a separate screen.

**Architecture:** Reuse the existing `renderInline` slot in `action-config.ts` / `HomeScreen.renderInlineAction`. HomeScreen owns coordination (the `ScrollView` ref, a single `openDrawerId`, glide-to-top, close-on-drag, close-on-blur). A shared `<HomeInlineDrawer>` shell wraps both bodies and animates the accordion via `useCollapsibleHeight` (extended with a 75%-height clamp). All non-trivial logic is extracted to a pure `inline-drawer-utils.ts` for unit testing.

**Tech Stack:** React Native (Expo SDK 54, RN 0.81, React 19), Reanimated 4 (`useAnimatedRef`/`measure`/`scrollTo` worklets), TanStack Query v5, Drizzle ORM (node-postgres), Vitest. Source spec: `docs/superpowers/specs/2026-06-27-recipes-home-inline-drawers-design.md`.

## Global Constraints

- **React Compiler is ACTIVE** — do NOT add manual `React.memo`/`useCallback` for function-component identity; `useMemo` only where genuinely needed (PureComponent props, ref-read bailouts). Match the surrounding file's existing usage.
- **Theme:** colors via `useTheme()` → `theme.*`; opacity via `withOpacity(color, 0..1)` (decimal scale). Spacing/radii/fonts from `@/constants/theme` (`Spacing`, `BorderRadius`, `FontFamily`).
- **Reduced motion:** every animation must check `useAccessibility().reducedMotion` and skip/snap when true.
- **Cross-platform:** must work on iOS and Android.
- **Per-user durable storage discipline:** any new on-device per-user store MUST mirror `client/lib/home-actions-storage.ts` exactly — `getDurableOwner()` read-time owner marker + `sweepEpoch`/`sweepInFlight` guards — and be wired into `clearDurableLocalState()` in `client/hooks/useAuth.ts`. Cross-user bleed is a known repeated defect class here.
- **`renderInline` bypasses `handleActionPress`** (`HomeScreen.tsx:112-124`) — so the premium gate and `recordAction` do NOT run automatically for inline actions. The Generate gate is reimplemented in the toggle; `recordAction` is called by the bodies on actual use.
- **Keep `navigateAction` cases** for `search-recipes`/`generate-recipe` — the Discovery card (`discovery-cards-config.ts:76`) and Recent row still navigate full-screen (accepted dual behavior).
- **Pre-push gate runs lint/types/tests** — do NOT run `test:run`/`check:types`/`lint` ad-hoc to self-verify; run the specific test file for the task you are on.

---

## File Structure

**New files**

- `client/components/home/inline-drawer-utils.ts` — pure helpers: `glideToTopOffset`, `nextOpenDrawer`, `clampDrawerHeight`, `resolveTrendingSource`, `formatTermLabel`.
- `client/components/home/__tests__/inline-drawer-utils.test.ts` — unit tests for the above.
- `client/components/home/HomeInlineDrawer.tsx` — shared accordion shell (header + animated body slot).
- `client/components/home/RecipeSearchDrawer.tsx` — search body (input + recent chips + trending carousel).
- `client/components/home/GenerateRecipeDrawer.tsx` — generate body (prompt input + idea chips).
- `client/components/home/trending-fallback.ts` — curated fallback term list + idea-chip list.
- `client/lib/recent-recipe-searches-storage.ts` — per-user recent-search store (mirrors home-actions-storage).
- `client/lib/__tests__/recent-recipe-searches-storage.test.ts` — storage tests.
- `client/hooks/useTrendingSearches.ts` — TanStack Query hook (lazy, `enabled`).
- `server/storage/__tests__/community-recipes-trending.test.ts` — aggregation test.

**Modified files**

- `client/components/home/action-config.ts` — add `renderInline: true` to `search-recipes` and `generate-recipe` (KEEP their `navigateAction` cases).
- `client/hooks/useCollapsibleHeight.ts` — add optional `maxHeight` param (clamp).
- `client/screens/HomeScreen.tsx` — coordination (state, refs, glide, close-on-drag, close-on-blur, toggle+gate, render bodies).
- `client/hooks/useAuth.ts` — wire `clearRecentRecipeSearches()` into `clearDurableLocalState()`.
- `server/storage/community-recipes.ts` — add `getTrendingSearchTerms()`.
- `server/storage/index.ts` — expose `getTrendingSearchTerms`.
- `server/routes/recipe-search.ts` — add `GET /api/recipes/trending`.

---

# PHASE 1 — Shell + coordination

## Task 1: Pure inline-drawer utilities

**Files:**

- Create: `client/components/home/inline-drawer-utils.ts`
- Test: `client/components/home/__tests__/inline-drawer-utils.test.ts`

**Interfaces:**

- Produces:
  - `glideToTopOffset(currentScrollY: number, rowPageY: number, collapsedBarHeight: number): number`
  - `nextOpenDrawer(current: string | null, tapped: string): { next: string | null; isSwitch: boolean }`
  - `clampDrawerHeight(measured: number, maxHeight?: number): number`
  - `formatTermLabel(term: string): string`
  - `type TrendingState = { isLoading: boolean; isError: boolean; terms: string[] | undefined }`
  - `type TrendingResolved = { kind: "loading" } | { kind: "terms"; terms: string[] } | { kind: "fallback"; terms: string[] }`
  - `resolveTrendingSource(state: TrendingState, fallback: string[]): TrendingResolved`

- [ ] **Step 1: Write the failing test**

```ts
// client/components/home/__tests__/inline-drawer-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  glideToTopOffset,
  nextOpenDrawer,
  clampDrawerHeight,
  formatTermLabel,
  resolveTrendingSource,
} from "../inline-drawer-utils";

describe("glideToTopOffset", () => {
  it("scrolls the row's on-screen top to just below the collapsed bar", () => {
    // row currently 400px down the screen, page already scrolled 100, bar is 90 tall
    expect(glideToTopOffset(100, 400, 90)).toBe(410);
  });
  it("never returns a negative offset", () => {
    expect(glideToTopOffset(0, 10, 90)).toBe(0);
  });
});

describe("nextOpenDrawer", () => {
  it("opens when nothing is open", () => {
    expect(nextOpenDrawer(null, "search-recipes")).toEqual({
      next: "search-recipes",
      isSwitch: false,
    });
  });
  it("toggles closed when tapping the open one", () => {
    expect(nextOpenDrawer("search-recipes", "search-recipes")).toEqual({
      next: null,
      isSwitch: false,
    });
  });
  it("flags a switch when another is open", () => {
    expect(nextOpenDrawer("search-recipes", "generate-recipe")).toEqual({
      next: "generate-recipe",
      isSwitch: true,
    });
  });
});

describe("clampDrawerHeight", () => {
  it("returns measured when under the cap", () => {
    expect(clampDrawerHeight(300, 600)).toBe(300);
  });
  it("clamps to the cap when over", () => {
    expect(clampDrawerHeight(900, 600)).toBe(600);
  });
  it("returns measured when no cap is given", () => {
    expect(clampDrawerHeight(900, undefined)).toBe(900);
  });
});

describe("formatTermLabel", () => {
  it("title-cases and de-dashes", () => {
    expect(formatTermLabel("high-protein")).toBe("High Protein");
    expect(formatTermLabel("italian")).toBe("Italian");
  });
});

describe("resolveTrendingSource", () => {
  const fallback = ["High Protein", "Air Fryer"];
  it("shows loading only when loading and no terms yet", () => {
    expect(
      resolveTrendingSource(
        { isLoading: true, isError: false, terms: undefined },
        fallback,
      ),
    ).toEqual({ kind: "loading" });
  });
  it("shows live terms when present", () => {
    expect(
      resolveTrendingSource(
        { isLoading: false, isError: false, terms: ["Vegan"] },
        fallback,
      ),
    ).toEqual({ kind: "terms", terms: ["Vegan"] });
  });
  it("falls back when empty", () => {
    expect(
      resolveTrendingSource(
        { isLoading: false, isError: false, terms: [] },
        fallback,
      ),
    ).toEqual({ kind: "fallback", terms: fallback });
  });
  it("falls back on error", () => {
    expect(
      resolveTrendingSource(
        { isLoading: false, isError: true, terms: undefined },
        fallback,
      ),
    ).toEqual({ kind: "fallback", terms: fallback });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/components/home/__tests__/inline-drawer-utils.test.ts`
Expected: FAIL — `Cannot find module "../inline-drawer-utils"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/components/home/inline-drawer-utils.ts

/** Target scroll offset so the row's current on-screen top lands just below the
 *  collapsed summary bar. `rowPageY` comes from a Reanimated measure() (already
 *  reflects the collapsing-header delta); `collapsedBarHeight` = insets.top +
 *  HOME_HEADER_COLLAPSED. Clamped to >= 0. */
export function glideToTopOffset(
  currentScrollY: number,
  rowPageY: number,
  collapsedBarHeight: number,
): number {
  return Math.max(0, currentScrollY + (rowPageY - collapsedBarHeight));
}

/** Single-open accordion transition. Tapping the open drawer closes it; tapping
 *  a different one switches (isSwitch=true so the caller can sequence the
 *  collapse before the new open). */
export function nextOpenDrawer(
  current: string | null,
  tapped: string,
): { next: string | null; isSwitch: boolean } {
  if (current === tapped) return { next: null, isSwitch: false };
  return { next: tapped, isSwitch: current !== null };
}

/** Safety clamp for the 75%-of-screen drawer cap. */
export function clampDrawerHeight(
  measured: number,
  maxHeight?: number,
): number {
  if (maxHeight != null && measured > maxHeight) return maxHeight;
  return measured;
}

/** "high-protein" -> "High Protein" for carousel display. */
export function formatTermLabel(term: string): string {
  return term
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export type TrendingState = {
  isLoading: boolean;
  isError: boolean;
  terms: string[] | undefined;
};

export type TrendingResolved =
  | { kind: "loading" }
  | { kind: "terms"; terms: string[] }
  | { kind: "fallback"; terms: string[] };

/** Collapses the four query states into render branches: skeleton while the
 *  first load is in flight, else live terms when present, else curated
 *  fallback (covers both empty and error). */
export function resolveTrendingSource(
  state: TrendingState,
  fallback: string[],
): TrendingResolved {
  if (state.isLoading && (!state.terms || state.terms.length === 0)) {
    return { kind: "loading" };
  }
  if (!state.isError && state.terms && state.terms.length > 0) {
    return { kind: "terms", terms: state.terms };
  }
  return { kind: "fallback", terms: fallback };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/components/home/__tests__/inline-drawer-utils.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add client/components/home/inline-drawer-utils.ts client/components/home/__tests__/inline-drawer-utils.test.ts
git commit -m "feat(home): pure utils for inline recipe drawers"
```

---

## Task 2: Extend `useCollapsibleHeight` with a max-height clamp

**Files:**

- Modify: `client/hooks/useCollapsibleHeight.ts`

**Interfaces:**

- Consumes: `clampDrawerHeight` (Task 1).
- Produces: `useCollapsibleHeight(isExpanded: boolean, reducedMotion: boolean, maxHeight?: number)` — same return `{ animatedStyle, onContentLayout }`. Backward compatible (existing 2-arg `QuickLogDrawer` call unaffected).

- [ ] **Step 1: Add the optional param and clamp the measured height**

Replace the signature and `onContentLayout` body:

```ts
import { clampDrawerHeight } from "@/components/home/inline-drawer-utils";

export function useCollapsibleHeight(
  isExpanded: boolean,
  reducedMotion: boolean,
  maxHeight?: number,
) {
  const contentHeight = useSharedValue(0);
  const animatedHeight = useSharedValue(0);
  const hasMeasured = useRef(false);

  const onContentLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const raw = e.nativeEvent.layout.height;
      if (raw === 0) return; // Ignore zero-height measurements
      const measured = clampDrawerHeight(raw, maxHeight);
      contentHeight.value = measured;
      if (!hasMeasured.current) {
        hasMeasured.current = true;
        animatedHeight.value = isExpanded ? measured : 0;
      } else if (isExpanded) {
        animatedHeight.value = measured;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [isExpanded, maxHeight],
  );
```

(Leave the `useEffect`, `animatedStyle`, and `return` unchanged.)

- [ ] **Step 2: Verify the existing collapsible test still passes (regression)**

Run: `npx vitest run client/ -t "Collapsible"`
Expected: PASS, or "No test files found" if none — either is acceptable (no behavior change for 2-arg callers).

- [ ] **Step 3: Commit**

```bash
git add client/hooks/useCollapsibleHeight.ts
git commit -m "feat(home): optional maxHeight clamp in useCollapsibleHeight"
```

---

## Task 3: `HomeInlineDrawer` shared shell

**Files:**

- Create: `client/components/home/HomeInlineDrawer.tsx`

**Interfaces:**

- Consumes: `useCollapsibleHeight` (Task 2), `useAccessibility`, `useTheme`, animation configs.
- Produces: default-exported `HomeInlineDrawer` with props:

  ```ts
  interface HomeInlineDrawerProps {
    icon: string;
    label: string;
    isOpen: boolean;
    onToggle: () => void;
    maxHeight: number; // 75%-of-screen cap (computed by HomeScreen)
    isLocked?: boolean; // premium lock — shows a lock icon
    children: React.ReactNode; // the body
  }
  ```

  Renders a pressable header row (icon circle + label + animated chevron, mirroring `QuickLogDrawer`) and an always-mounted animated body. The OUTER `Animated.View` is forwarded a ref via `React.forwardRef` so HomeScreen can `measure()` it for glide-to-top.

- [ ] **Step 1: Write the component**

```tsx
// client/components/home/HomeInlineDrawer.tsx
import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { Spacing, withOpacity } from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";

interface HomeInlineDrawerProps {
  icon: string;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  maxHeight: number;
  isLocked?: boolean;
  children: React.ReactNode;
}

export const HomeInlineDrawer = React.forwardRef<
  React.ComponentRef<typeof Animated.View>,
  HomeInlineDrawerProps
>(function HomeInlineDrawer(
  { icon, label, isOpen, onToggle, maxHeight, isLocked, children },
  ref,
) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isOpen,
    reducedMotion,
    maxHeight,
  );

  const chevronRotation = useSharedValue(0);
  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = isOpen;
    if (reducedMotion) {
      chevronRotation.value = isOpen ? 90 : 0;
    } else {
      chevronRotation.value = withTiming(
        isOpen ? 90 : 0,
        isOpen ? expandTimingConfig : collapseTimingConfig,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is a stable ref
  }, [isOpen, reducedMotion]);

  useEffect(
    () => () => cancelAnimation(chevronRotation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  return (
    <Animated.View ref={ref}>
      <Pressable
        onPress={() => {
          haptics.impact(Haptics.ImpactFeedbackStyle.Light);
          onToggle();
        }}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={`Double tap to ${isOpen ? "collapse" : "expand"} ${label}`}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: withOpacity(theme.link, 0.1) },
          ]}
        >
          <Feather
            name={icon as keyof typeof Feather.glyphMap}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </View>
        <ThemedText type="body" style={styles.label}>
          {label}
        </ThemedText>
        {isLocked ? (
          <Feather
            name="lock"
            size={14}
            color={theme.textSecondary}
            accessible={false}
          />
        ) : (
          <Animated.View style={chevronStyle}>
            <Feather
              name="chevron-right"
              size={16}
              color={theme.textSecondary}
              accessible={false}
            />
          </Animated.View>
        )}
      </Pressable>

      <Animated.View style={[animatedStyle, styles.clip]}>
        <View
          style={styles.body}
          onLayout={onContentLayout}
          importantForAccessibility={isOpen ? "yes" : "no-hide-descendants"}
          aria-hidden={!isOpen}
        >
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 48,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  label: { flex: 1 },
  clip: { overflow: "hidden" },
  body: {
    position: "absolute",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
});
```

- [ ] **Step 2: Typecheck the new file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i HomeInlineDrawer || echo "no errors for HomeInlineDrawer"`
Expected: `no errors for HomeInlineDrawer`.

- [ ] **Step 3: Commit**

```bash
git add client/components/home/HomeInlineDrawer.tsx
git commit -m "feat(home): HomeInlineDrawer shared accordion shell"
```

---

## Task 4: Wire HomeScreen coordination (placeholder bodies)

**Files:**

- Modify: `client/components/home/action-config.ts`
- Modify: `client/screens/HomeScreen.tsx`

**Interfaces:**

- Consumes: `HomeInlineDrawer` (Task 3); `glideToTopOffset`, `nextOpenDrawer` (Task 1); `scrollY` from `useScrollLinkedHeader`.
- Produces: HomeScreen renders both inline drawers with a temporary `<ThemedText>Coming soon</ThemedText>` body, with working open/close, single-open exclusivity, glide-to-top, close-on-drag, close-on-blur, and the Generate premium gate. Phase 2/3 replace the placeholder bodies.

- [ ] **Step 1: Mark the two actions `renderInline` (keep navigateAction)**

In `client/components/home/action-config.ts`, add `renderInline: true` to the two action objects. Do NOT touch `navigateAction`.

```ts
  {
    id: "search-recipes",
    group: "recipes",
    icon: "search",
    label: "Search Recipes",
    subtitle: "Browse the recipe catalog",
    renderInline: true,
  },
  {
    id: "generate-recipe",
    group: "recipes",
    icon: "zap",
    label: "Generate Recipe",
    subtitle: "AI-powered recipe creation",
    premium: true,
    renderInline: true,
  },
```

- [ ] **Step 2: Add coordination state, refs, and constants to HomeScreen**

In `client/screens/HomeScreen.tsx`, add imports near the existing ones:

```tsx
import { useWindowDimensions } from "react-native";
import {
  useAnimatedRef,
  measure,
  runOnUI,
  scrollTo,
} from "react-native-reanimated";
import {
  glideToTopOffset,
  nextOpenDrawer,
} from "@/components/home/inline-drawer-utils";
```

Inside the component, after the existing hooks, add:

```tsx
const { height: screenHeight } = useWindowDimensions();
const DRAWER_MAX_HEIGHT = Math.round(screenHeight * 0.75);
const collapsedBarHeight = insets.top + HOME_HEADER_COLLAPSED;

const scrollRef = useAnimatedRef<Animated.ScrollView>();
const searchRowRef = useAnimatedRef<Animated.View>();
const generateRowRef = useAnimatedRef<Animated.View>();
const drawerRowRefs: Record<string, typeof searchRowRef> = {
  "search-recipes": searchRowRef,
  "generate-recipe": generateRowRef,
};

const [openDrawerId, setOpenDrawerId] = useState<string | null>(null);
```

Change the existing `scrollHandler` destructure to also pull `scrollY`:

```tsx
const {
  scrollHandler,
  scrollY,
  headerAnimatedStyle,
  collapsedBarAnimatedStyle,
  isBarVisible,
} = useScrollLinkedHeader({
  /* unchanged args */
});
```

- [ ] **Step 3: Add the glide, toggle, close-on-drag, and close-on-blur handlers**

Add these inside the component (after `handleActionPress`):

```tsx
const glideRowToTop = useCallback(
  (actionId: string) => {
    const rowRef = drawerRowRefs[actionId];
    if (!rowRef) return;
    const currentY = scrollY.value;
    runOnUI(() => {
      "worklet";
      const m = measure(rowRef);
      if (m === null) return;
      scrollTo(
        scrollRef,
        0,
        glideToTopOffset(currentY, m.pageY, collapsedBarHeight),
        true,
      );
    })();
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- animated refs + shared value are stable
  [collapsedBarHeight],
);

const handleDrawerToggle = useCallback(
  (action: HomeAction) => {
    // Premium gate reimplemented here (inline path bypasses handleActionPress)
    const opening = openDrawerId !== action.id;
    if (opening && action.premium && !isPremium) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    const { next, isSwitch } = nextOpenDrawer(openDrawerId, action.id);
    if (isSwitch) {
      // Collapse the open one first, then open + glide the new one (avoids
      // three concurrent animations racing a moving target).
      setOpenDrawerId(null);
      setTimeout(() => {
        setOpenDrawerId(next);
        if (next) glideRowToTop(next);
      }, collapseTimingConfig.duration ?? 250);
    } else {
      setOpenDrawerId(next);
      if (next) glideRowToTop(next);
    }
  },
  [openDrawerId, isPremium, haptics, glideRowToTop],
);
```

Add the import for `collapseTimingConfig`:

```tsx
import { collapseTimingConfig } from "@/constants/animations";
```

Add close-on-blur via a navigation focus effect (import `useFocusEffect` from `@react-navigation/native`):

```tsx
useFocusEffect(
  useCallback(() => {
    return () => setOpenDrawerId(null); // close when Home loses focus
  }, []),
);
```

- [ ] **Step 4: Attach the scroll ref + close-on-drag to the ScrollView**

On the existing `<Animated.ScrollView>`, add `ref={scrollRef}` and an `onScrollBeginDrag` that closes any open drawer (a USER drag — programmatic `scrollTo` does not fire this):

```tsx
      <Animated.ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={scrollContentContainerStyle}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        onScrollBeginDrag={() => {
          if (openDrawerId !== null) setOpenDrawerId(null);
        }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
      >
```

- [ ] **Step 5: Refactor `renderInlineAction` to render the drawers (placeholder body)**

Replace the module-scope `renderInlineAction` function (`HomeScreen.tsx:49-56`) with an inline renderer INSIDE the component (so it can close over state/handlers). Delete the old top-level function and its `<QuickLogDrawer>`-only switch, and instead render per action id. Keep Quick Log working by special-casing it.

Inside the component body, add:

```tsx
const renderInlineAction = (action: HomeAction) => {
  if (action.id === "quick-log") {
    return <QuickLogDrawer key={action.id} action={action} />;
  }
  const rowRef = drawerRowRefs[action.id];
  const isLocked = !!action.premium && !isPremium;
  return (
    <HomeInlineDrawer
      key={action.id}
      ref={rowRef}
      icon={action.icon}
      label={action.label}
      isOpen={openDrawerId === action.id}
      onToggle={() => handleDrawerToggle(action)}
      maxHeight={DRAWER_MAX_HEIGHT}
      isLocked={isLocked}
    >
      <ThemedText type="small">Coming soon</ThemedText>
    </HomeInlineDrawer>
  );
};
```

Add imports:

```tsx
import { HomeInlineDrawer } from "@/components/home/HomeInlineDrawer";
import { useFocusEffect } from "@react-navigation/native";
```

The existing render loop already calls `renderInlineAction(action)` when `action.renderInline` (`HomeScreen.tsx:262-275`) — leave that JSX as-is; it now resolves to the in-component function.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "HomeScreen|action-config" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Verify the interaction in the simulator**

Use the `verify-ui` skill (or `npx expo run:ios`) to open Home. Manually confirm:

- Tapping "Search Recipes" glides the row toward the top and expands a "Coming soon" body.
- Tapping it again collapses it.
- Tapping "Generate Recipe" while non-premium shows the Upgrade modal and does NOT open; as premium it opens and the search one closes first (sequenced).
- Dragging/scrolling the page closes the open drawer.
- Navigating away (e.g. into a recipe) and back leaves Home un-glided with the drawer closed.

- [ ] **Step 8: Commit**

```bash
git add client/components/home/action-config.ts client/screens/HomeScreen.tsx
git commit -m "feat(home): inline-drawer coordination (glide, single-open, gate, close-on-drag/blur)"
```

---

# PHASE 2 — Search drawer

## Task 5: Curated fallback config + (resolveTrendingSource already built)

**Files:**

- Create: `client/components/home/trending-fallback.ts`

**Interfaces:**

- Produces: `TRENDING_FALLBACK_TERMS: string[]` (curated, display-cased) and `GENERATE_IDEA_CHIPS: string[]` (used by Phase 3).

- [ ] **Step 1: Write the config**

```ts
// client/components/home/trending-fallback.ts

/** Shown in the Search drawer's trending carousel ONLY when the live
 *  popularity-derived terms are empty or errored. Display-cased; tapping
 *  searches the term. Keep it short and seasonal. */
export const TRENDING_FALLBACK_TERMS: string[] = [
  "High Protein",
  "30-Minute Dinners",
  "Air Fryer",
  "Vegetarian",
  "Meal Prep",
  "One Pot",
  "Low Carb",
  "Budget Friendly",
];

/** Idea chips for the Generate drawer (Phase 3). */
export const GENERATE_IDEA_CHIPS: string[] = [
  "Use up leftovers",
  "Quick weeknight dinner",
  "High-protein lunch",
  "Cozy comfort food",
];
```

- [ ] **Step 2: Commit**

```bash
git add client/components/home/trending-fallback.ts
git commit -m "feat(home): curated trending fallback + generate idea chips"
```

---

## Task 6: Per-user recent-search storage (+ teardown wiring)

**Files:**

- Create: `client/lib/recent-recipe-searches-storage.ts`
- Create: `client/lib/__tests__/recent-recipe-searches-storage.test.ts`
- Modify: `client/hooks/useAuth.ts`

**Interfaces:**

- Consumes: `AsyncStorage`, `getDurableOwner` (`@/lib/durable-owner`).
- Produces:
  - `initRecentSearchesCache(userId: string | null): Promise<void>`
  - `getRecentSearches(): string[]`
  - `pushRecentSearch(query: string): Promise<void>`
  - `clearRecentSearches(): Promise<boolean>` (non-throwing; wired into auth teardown)

- [ ] **Step 1: Write the failing test**

```ts
// client/lib/__tests__/recent-recipe-searches-storage.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

let ownerValue: string | null = "user-1";
vi.mock("@/lib/durable-owner", () => ({
  getDurableOwner: vi.fn(async () => ownerValue),
}));

import {
  initRecentSearchesCache,
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
} from "../recent-recipe-searches-storage";

beforeEach(() => {
  store.clear();
  ownerValue = "user-1";
});

describe("recent-recipe-searches-storage", () => {
  it("dedupes case-insensitively, newest first, capped at 8", async () => {
    await initRecentSearchesCache("user-1");
    for (const q of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
      await pushRecentSearch(q);
    }
    await pushRecentSearch("A"); // dedupe vs "a"
    const recent = getRecentSearches();
    expect(recent[0]).toBe("A");
    expect(recent.length).toBe(8);
    expect(recent.filter((r) => r.toLowerCase() === "a").length).toBe(1);
  });

  it("does NOT surface another user's history (owner marker mismatch)", async () => {
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    ownerValue = "user-2"; // disk owned by user-1, active user is user-2
    await initRecentSearchesCache("user-2");
    expect(getRecentSearches()).toEqual([]);
  });

  it("clear wipes cache and disk, returns true", async () => {
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    const ok = await clearRecentSearches();
    expect(ok).toBe(true);
    expect(getRecentSearches()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/lib/__tests__/recent-recipe-searches-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation (mirror home-actions-storage)**

```ts
// client/lib/recent-recipe-searches-storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDurableOwner } from "@/lib/durable-owner";

const RECENT_SEARCHES_KEY = "@ocrecipes_recent_recipe_searches";
const MAX_RECENT_SEARCHES = 8;

let cache: string[] | null = null;
// Same sweep-race guards as home-actions-storage: epoch invalidates an init
// whose disk read is straddled by a teardown; in-flight awaits a sweep's
// removeItem before reading disk. See home-actions-storage.ts for the proof.
let sweepEpoch = 0;
let sweepInFlight: Promise<void> | null = null;

export function initRecentSearchesCache(userId: string | null): Promise<void> {
  return (async () => {
    while (sweepInFlight) {
      try {
        await sweepInFlight;
      } catch {}
    }
    const startEpoch = sweepEpoch;
    const [raw, owner] = await Promise.all([
      AsyncStorage.getItem(RECENT_SEARCHES_KEY).catch(() => null),
      getDurableOwner(),
    ]);
    const ownsHistory = userId !== null && owner === userId;
    if (sweepEpoch === startEpoch) {
      if (ownsHistory) {
        try {
          cache = raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
          cache = [];
        }
      } else {
        cache = [];
      }
    }
  })();
}

export function getRecentSearches(): string[] {
  return cache ?? [];
}

export async function pushRecentSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  const current = getRecentSearches().filter(
    (s) => s.toLowerCase() !== q.toLowerCase(),
  );
  const updated = [q, ...current].slice(0, MAX_RECENT_SEARCHES);
  cache = updated;
  await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
}

/** Clears this device's recent recipe searches from cache + disk. Mirrors
 *  clearHomeActionsState: bumps epoch + nulls cache synchronously, publishes
 *  the removeItem as sweepInFlight, never throws. Wired into auth teardown. */
export async function clearRecentSearches(): Promise<boolean> {
  sweepEpoch++;
  cache = null;
  let ok = true;
  const sweep = AsyncStorage.removeItem(RECENT_SEARCHES_KEY)
    .catch(() => {
      ok = false;
    })
    .then(() => {});
  sweepInFlight = sweep;
  void sweep.finally(() => {
    if (sweepInFlight === sweep) sweepInFlight = null;
  });
  await sweep;
  return ok;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/lib/__tests__/recent-recipe-searches-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `clearRecentSearches` into auth teardown**

In `client/hooks/useAuth.ts`, add the import alongside `clearHomeActionsState`:

```ts
import { clearRecentSearches } from "@/lib/recent-recipe-searches-storage";
```

Inside `clearDurableLocalState` (after the `clearHomeActionsState()` line, ~`useAuth.ts:70`):

```ts
if (!(await clearHomeActionsState())) ok = false;
// Recent recipe searches: same global-key cross-user bleed risk on a shared
// device; clear them on every session-ending path. Non-throwing.
if (!(await clearRecentSearches())) ok = false;
```

- [ ] **Step 6: Typecheck (auth is NEVER-delegate — verify carefully)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "useAuth|recent-recipe" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add client/lib/recent-recipe-searches-storage.ts client/lib/__tests__/recent-recipe-searches-storage.test.ts client/hooks/useAuth.ts
git commit -m "feat(home): per-user recent recipe searches store + auth teardown wiring"
```

---

## Task 7: Server trending aggregation + route

**Files:**

- Modify: `server/storage/community-recipes.ts`
- Modify: `server/storage/index.ts`
- Modify: `server/routes/recipe-search.ts`
- Create: `server/storage/__tests__/community-recipes-trending.test.ts`

**Interfaces:**

- Produces:
  - `getTrendingSearchTerms(limit?: number): Promise<string[]>` (storage) — top public diet-tag + cuisine terms by `popularityScore`.
  - Exposed as `storage.getTrendingSearchTerms`.
  - `GET /api/recipes/trending` → `{ terms: string[] }`.

- [ ] **Step 1: Write the failing aggregation test**

This test seeds two public community recipes and asserts the top term ordering. It uses the live dev DB (the project's Vitest setup connects to it).

```ts
// server/storage/__tests__/community-recipes-trending.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../db";
import { communityRecipes } from "@shared/schema";
import { getTrendingSearchTerms } from "../community-recipes";
import { sql } from "drizzle-orm";

async function insertRecipe(over: Record<string, unknown>) {
  await db.insert(communityRecipes).values({
    normalizedProductName: "t",
    title: "t",
    instructions: ["x"],
    isPublic: true,
    ...over,
  } as typeof communityRecipes.$inferInsert);
}

describe("getTrendingSearchTerms", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM community_recipes`);
  });

  it("ranks diet-tag + cuisine terms by summed popularity, public only", async () => {
    await insertRecipe({
      dietTags: ["vegan"],
      cuisineOrigin: "Italian",
      popularityScore: 100,
    });
    await insertRecipe({
      dietTags: ["vegan", "high-protein"],
      popularityScore: 50,
    });
    await insertRecipe({
      dietTags: ["keto"],
      popularityScore: 5,
      isPublic: false,
    }); // excluded

    const terms = await getTrendingSearchTerms(5);
    expect(terms[0]).toBe("vegan"); // 150 total
    expect(terms).toContain("Italian");
    expect(terms).toContain("high-protein");
    expect(terms).not.toContain("keto"); // private
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/storage/__tests__/community-recipes-trending.test.ts`
Expected: FAIL — `getTrendingSearchTerms` is not exported.

- [ ] **Step 3: Implement the storage function**

Append to `server/storage/community-recipes.ts` (it already imports `db` and `sql`):

```ts
/**
 * Top "trending search" terms derived from the popular public recipe set:
 * unnested diet tags + cuisine origins, ranked by summed popularityScore.
 * Returns display-ready term strings (original casing). Powers the Home
 * search drawer's trending carousel.
 */
export async function getTrendingSearchTerms(limit = 8): Promise<string[]> {
  const result = await db.execute(sql`
    WITH terms AS (
      SELECT tag AS term, popularity_score AS score
      FROM community_recipes,
           jsonb_array_elements_text(diet_tags) AS tag
      WHERE is_public = true AND tag <> ''
      UNION ALL
      SELECT cuisine_origin AS term, popularity_score AS score
      FROM community_recipes
      WHERE is_public = true
        AND cuisine_origin IS NOT NULL
        AND cuisine_origin <> ''
    )
    SELECT term, SUM(score) AS weight, COUNT(*) AS n
    FROM terms
    GROUP BY term
    ORDER BY SUM(score) DESC, COUNT(*) DESC, term ASC
    LIMIT ${limit}
  `);
  const rows = result.rows as { term: string }[];
  return rows.map((r) => r.term);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/storage/__tests__/community-recipes-trending.test.ts`
Expected: PASS.

- [ ] **Step 5: Expose via the storage facade**

In `server/storage/index.ts`, find the `community-recipes` import block and the storage object. Add `getTrendingSearchTerms` to both. Example (match the file's existing style):

```ts
import {
  // ...existing community-recipes imports...
  getTrendingSearchTerms,
} from "./community-recipes";

export const storage = {
  // ...existing...
  getTrendingSearchTerms,
};
```

- [ ] **Step 6: Add the route**

In `server/routes/recipe-search.ts`, inside `register(app)`, add after the `/api/recipes/search` handler:

```ts
// GET /api/recipes/trending — top popularity-derived search terms (Home drawer)
app.get(
  "/api/recipes/trending",
  requireAuth,
  instructionsRateLimit,
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const terms = await storage.getTrendingSearchTerms(8);
      res.json({ terms });
    } catch (error) {
      handleRouteError(res, error, "trending searches");
    }
  },
);
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "community-recipes|recipe-search|storage/index" || echo "clean"`
Expected: `clean`.

- [ ] **Step 8: Commit**

```bash
git add server/storage/community-recipes.ts server/storage/index.ts server/routes/recipe-search.ts server/storage/__tests__/community-recipes-trending.test.ts
git commit -m "feat(recipes): trending search terms aggregation + GET /api/recipes/trending"
```

---

## Task 8: `useTrendingSearches` hook

**Files:**

- Create: `client/hooks/useTrendingSearches.ts`

**Interfaces:**

- Consumes: `useQuery`, `apiRequest` (`@/lib/query-client`).
- Produces: `useTrendingSearches(enabled: boolean)` → `{ data, isLoading, isError }` where `data: { terms: string[] }`.

- [ ] **Step 1: Write the hook (mirror useDailyBudget; lazy via enabled)**

```ts
// client/hooks/useTrendingSearches.ts
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface TrendingSearchesResponse {
  terms: string[];
}

/** Fetches popularity-derived trending search terms. Pass `enabled = isOpen`
 *  so it only fires when the search drawer is open (it rides the shared
 *  instructionsRateLimit and must not run on every Home mount). */
export function useTrendingSearches(enabled: boolean) {
  return useQuery<TrendingSearchesResponse>({
    queryKey: ["/api/recipes/trending"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/recipes/trending");
      return res.json() as Promise<TrendingSearchesResponse>;
    },
    enabled,
    staleTime: 1000 * 60 * 30, // 30 min — trending changes slowly
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i useTrendingSearches || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add client/hooks/useTrendingSearches.ts
git commit -m "feat(home): useTrendingSearches lazy query hook"
```

---

## Task 9: `RecipeSearchDrawer` body + wire into HomeScreen

**Files:**

- Create: `client/components/home/RecipeSearchDrawer.tsx`
- Modify: `client/screens/HomeScreen.tsx`

**Interfaces:**

- Consumes: `useTrendingSearches` (T8), `recent-recipe-searches-storage` (T6), `resolveTrendingSource`/`formatTermLabel` (T1), `TRENDING_FALLBACK_TERMS` (T5).
- Produces: `RecipeSearchDrawer({ isOpen, onUsed }: { isOpen: boolean; onUsed: () => void })`. On submit / chip / term tap: pushes the query to recent-search storage, calls `onUsed()` (which records the home action), and navigates to `MealPlanTab → RecipeBrowser { searchQuery }`.

- [ ] **Step 1: Write the body component**

```tsx
// client/components/home/RecipeSearchDrawer.tsx
import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useTrendingSearches } from "@/hooks/useTrendingSearches";
import {
  getRecentSearches,
  pushRecentSearch,
} from "@/lib/recent-recipe-searches-storage";
import {
  resolveTrendingSource,
  formatTermLabel,
} from "@/components/home/inline-drawer-utils";
import { TRENDING_FALLBACK_TERMS } from "@/components/home/trending-fallback";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Search ${label}`}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <ThemedText
        style={[styles.chipText, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

interface RecipeSearchDrawerProps {
  isOpen: boolean;
  onUsed: () => void;
}

export function RecipeSearchDrawer({
  isOpen,
  onUsed,
}: RecipeSearchDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<string[]>(getRecentSearches);

  // Refresh recent list whenever the drawer opens
  useEffect(() => {
    if (isOpen) setRecent(getRecentSearches());
  }, [isOpen]);

  const trending = useTrendingSearches(isOpen);
  const resolved = resolveTrendingSource(
    {
      isLoading: trending.isLoading,
      isError: trending.isError,
      terms: trending.data?.terms,
    },
    TRENDING_FALLBACK_TERMS,
  );

  const runSearch = (query: string) => {
    const q = query.trim();
    if (!q) return;
    haptics.selection();
    void pushRecentSearch(q);
    onUsed();
    navigation.navigate("MealPlanTab", {
      screen: "RecipeBrowser",
      params: { searchQuery: q },
    });
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
          },
        ]}
      >
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="Search recipes…"
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => runSearch(text)}
          returnKeyType="search"
          accessibilityLabel="Search recipes"
          // No auto-focus: keep chips/trending visible until the user taps in.
        />
      </View>

      {recent.length > 0 && (
        <View style={styles.section}>
          <ThemedText
            style={[styles.sectionLabel, { color: theme.textSecondary }]}
          >
            RECENT
          </ThemedText>
          <View style={styles.chipsWrap}>
            {recent.slice(0, 8).map((q) => (
              <Chip
                key={`recent-${q}`}
                label={q}
                onPress={() => runSearch(q)}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <ThemedText
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          TRENDING
        </ThemedText>
        {resolved.kind === "loading" ? (
          <View
            style={[
              styles.skeleton,
              { backgroundColor: withOpacity(theme.text, 0.06) },
            ]}
            accessibilitylabel="Loading trending searches"
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carousel}
            keyboardShouldPersistTaps="handled"
          >
            {resolved.terms.map((term) => (
              <Chip
                key={`trending-${term}`}
                label={formatTermLabel(term)}
                onPress={() => runSearch(term)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
  },
  input: { flex: 1, height: 40, fontSize: 14, fontFamily: FontFamily.regular },
  section: { gap: Spacing.xs },
  sectionLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  carousel: { gap: Spacing.xs, paddingRight: Spacing.lg },
  skeleton: { height: 36, borderRadius: BorderRadius.full },
  chip: {
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    maxWidth: 160,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: FontFamily.regular },
});
```

- [ ] **Step 2: Swap the placeholder body for Search in HomeScreen**

In `renderInlineAction` (HomeScreen), replace the placeholder for `search-recipes`:

```tsx
if (action.id === "search-recipes") {
  return (
    <HomeInlineDrawer
      key={action.id}
      ref={drawerRowRefs[action.id]}
      icon={action.icon}
      label={action.label}
      isOpen={openDrawerId === action.id}
      onToggle={() => handleDrawerToggle(action)}
      maxHeight={DRAWER_MAX_HEIGHT}
    >
      <RecipeSearchDrawer
        isOpen={openDrawerId === action.id}
        onUsed={() => recordAction(action.id)}
      />
    </HomeInlineDrawer>
  );
}
```

Add the import:

```tsx
import { RecipeSearchDrawer } from "@/components/home/RecipeSearchDrawer";
```

Also ensure the recent-search cache is initialized for the user. The Home screen already initializes the home-actions cache via `useHomeActions`. Add a sibling init in HomeScreen so recent searches load on mount:

```tsx
import { initRecentSearchesCache } from "@/lib/recent-recipe-searches-storage";
// inside the component:
useEffect(() => {
  const uid = user?.id != null ? String(user.id) : null;
  void initRecentSearchesCache(uid);
}, [user?.id]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "RecipeSearchDrawer|HomeScreen" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Verify in the simulator**

Open Home → tap "Search Recipes". Confirm:

- Drawer shows search box + (if any) RECENT chips + TRENDING carousel (live terms, or curated fallback when the catalog is thin).
- Typing a query + return navigates to the recipe browser with results.
- Tapping a trending/recent chip navigates with that term and the term then appears under RECENT next time.
- No keyboard appears until you tap the input.

- [ ] **Step 5: Commit**

```bash
git add client/components/home/RecipeSearchDrawer.tsx client/screens/HomeScreen.tsx
git commit -m "feat(home): Search Recipes inline drawer (search + recent + trending)"
```

---

# PHASE 3 — Generate drawer

## Task 10: `GenerateRecipeDrawer` body + wire into HomeScreen

**Files:**

- Create: `client/components/home/GenerateRecipeDrawer.tsx`
- Modify: `client/screens/HomeScreen.tsx`

**Interfaces:**

- Consumes: `GENERATE_IDEA_CHIPS` (T5). Premium gate already enforced by `handleDrawerToggle` (T4), so this body only renders for premium users when open.
- Produces: `GenerateRecipeDrawer({ onUsed }: { onUsed: () => void })`. On submit / idea-chip tap: calls `onUsed()` and navigates to `RecipeChat { initialMessage }`.

- [ ] **Step 1: Write the body component**

```tsx
// client/components/home/GenerateRecipeDrawer.tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { GENERATE_IDEA_CHIPS } from "@/components/home/trending-fallback";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

interface GenerateRecipeDrawerProps {
  onUsed: () => void;
}

export function GenerateRecipeDrawer({ onUsed }: GenerateRecipeDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const [text, setText] = useState("");

  const generate = (prompt: string) => {
    const p = prompt.trim();
    if (!p) return;
    haptics.selection();
    onUsed();
    navigation.navigate("RecipeChat", { initialMessage: p });
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
          },
        ]}
      >
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="Describe a recipe…"
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => generate(text)}
          returnKeyType="go"
          accessibilityLabel="Describe a recipe to generate"
        />
        <Pressable
          onPress={() => generate(text)}
          accessibilityRole="button"
          accessibilityLabel="Generate recipe"
          hitSlop={8}
          style={({ pressed }) => [
            styles.goButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather
            name="arrow-right"
            size={20}
            color={theme.link}
            accessible={false}
          />
        </Pressable>
      </View>

      <View style={styles.chipsWrap}>
        {GENERATE_IDEA_CHIPS.map((idea) => (
          <Pressable
            key={idea}
            onPress={() => generate(idea)}
            accessibilityRole="button"
            accessibilityLabel={`Generate: ${idea}`}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: withOpacity(theme.link, 0.08),
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ThemedText
              style={[styles.chipText, { color: theme.link }]}
              numberOfLines={1}
            >
              {idea}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  input: { flex: 1, height: 40, fontSize: 14, fontFamily: FontFamily.regular },
  goButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: FontFamily.medium },
});
```

- [ ] **Step 2: Swap the placeholder body for Generate in HomeScreen**

In `renderInlineAction`, replace the placeholder for `generate-recipe`:

```tsx
if (action.id === "generate-recipe") {
  return (
    <HomeInlineDrawer
      key={action.id}
      ref={drawerRowRefs[action.id]}
      icon={action.icon}
      label={action.label}
      isOpen={openDrawerId === action.id}
      onToggle={() => handleDrawerToggle(action)}
      maxHeight={DRAWER_MAX_HEIGHT}
      isLocked={!isPremium}
    >
      <GenerateRecipeDrawer onUsed={() => recordAction(action.id)} />
    </HomeInlineDrawer>
  );
}
```

The final fallthrough `return null` of `renderInlineAction` can remain for any other future inline action. Add the import:

```tsx
import { GenerateRecipeDrawer } from "@/components/home/GenerateRecipeDrawer";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "GenerateRecipeDrawer|HomeScreen" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Verify in the simulator (premium + non-premium)**

- Non-premium: tapping "Generate Recipe" shows the Upgrade modal; drawer stays closed; a lock icon shows on the row.
- Premium: tapping opens the drawer with a "Describe a recipe…" box + idea chips; submitting or tapping an idea navigates to the recipe chat with that prompt.
- Switching from an open Search drawer to Generate sequences (Search collapses, then Generate opens + glides).

- [ ] **Step 5: Commit**

```bash
git add client/components/home/GenerateRecipeDrawer.tsx client/screens/HomeScreen.tsx
git commit -m "feat(home): Generate Recipe inline drawer (prompt + idea chips)"
```

---

## Final verification (before PR)

- [ ] Run the full new-unit test set:
      `npx vitest run client/components/home/__tests__/inline-drawer-utils.test.ts client/lib/__tests__/recent-recipe-searches-storage.test.ts server/storage/__tests__/community-recipes-trending.test.ts`
      Expected: all PASS.
- [ ] Run `npm run preflight` (full CI parity incl. coverage) — required before opening a PR.
- [ ] Confirm `navigateAction` cases for `search-recipes`/`generate-recipe` are still present (Discovery card + Recent row still navigate full-screen).
- [ ] Hand the screen-reader pass (close-on-scroll vs 3-finger SR scroll; expand discoverability with no auto-focus) to the `accessibility-specialist` per the spec.

> **Deferred — Phase 4 (separate spec):** first-use coachmark tour for the Generate drawer. Not in this plan.

---

## Self-Review (completed during authoring)

- **Spec coverage:** glide-to-top (T1+T4), single-open + sequenced switch (T1+T4), 75% clamp (T2+T4), close-on-drag (T4), close-on-blur (T4), inline render via `renderInline` (T4), premium gate in toggle (T4), `recordAction` on use (T9/T10 `onUsed`), `navigateAction` retained (T4 note), recent-search store + owner discipline + teardown (T6), trending aggregation as new server work (T7), lazy fetch (T8), trending states incl. curated fallback (T1+T5+T9), recent empty state (T9 conditional), keyboard no-auto-focus (T9). All mapped.
- **Placeholder scan:** none — every code step has complete code; the one cross-task import note in T4 explicitly corrects itself to the real path.
- **Type consistency:** `glideToTopOffset`/`nextOpenDrawer`/`resolveTrendingSource`/`formatTermLabel` signatures match between T1 and their consumers (T4, T9); `getTrendingSearchTerms` return type (`string[]`) matches route + hook usage; `onUsed`/`isOpen` drawer props consistent T9/T10/T4.
