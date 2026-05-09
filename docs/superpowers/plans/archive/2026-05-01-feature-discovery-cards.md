# Feature Discovery Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a feature discovery system — a swipeable gradient card carousel on HomeScreen plus enhanced empty states in Pantry, Grocery List, and Meal Plan — that surfaces unused features based on existing `usageCounts` tracking and lets users permanently dismiss individual cards.

**Architecture:** A static card config maps action IDs to copy + emoji. A new `discovery-storage.ts` (AsyncStorage, same in-memory cache pattern as `home-actions-storage.ts`) tracks dismissed card IDs. The `useDiscoveryCards(usageCounts)` hook computes the visible set. `DiscoveryCarousel` renders a snapping horizontal FlatList with gradient `DiscoveryCard` items and returns `null` when all cards are gone. Three feature screens get enhanced `EmptyState` content with camera-forward CTAs.

**Tech Stack:** React Native, Reanimated 4 (FadeOut), expo-linear-gradient, AsyncStorage, Vitest + @testing-library/react

---

## File Map

| Status | Path                                                              | Responsibility                                               |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Create | `client/components/home/discovery-cards-config.ts`                | DiscoveryCard type + 12-card inventory                       |
| Create | `client/lib/discovery-storage.ts`                                 | AsyncStorage wrapper for dismissed IDs                       |
| Create | `client/hooks/useDiscoveryCards.ts`                               | Computes visible cards; exposes dismiss()                    |
| Create | `client/components/home/DiscoveryCard.tsx`                        | Single gradient card with dismiss button                     |
| Create | `client/components/home/DiscoveryCarousel.tsx`                    | Horizontal FlatList + dots; null when empty                  |
| Edit   | `client/screens/HomeScreen.tsx`                                   | Insert DiscoveryCarousel between header and RecentActionsRow |
| Edit   | `client/components/EmptyState.tsx`                                | Add optional secondaryLabel + onSecondaryAction props        |
| Edit   | `client/screens/meal-plan/PantryScreen.tsx`                       | Receipt-scan CTA in ListEmptyComponent                       |
| Edit   | `client/screens/meal-plan/GroceryListScreen.tsx`                  | Meal-plan CTA in ListEmptyComponent                          |
| Edit   | `client/screens/meal-plan/MealPlanHomeScreen.tsx`                 | Browse-recipes CTA when selected day has no items            |
| Create | `client/components/home/__tests__/discovery-cards-config.test.ts` | Integrity: all IDs in HOME_ACTIONS, no duplicates            |
| Create | `client/lib/__tests__/discovery-storage.test.ts`                  | Init, dismiss, hydration                                     |
| Create | `client/hooks/__tests__/useDiscoveryCards.test.ts`                | Visibility rules; dismiss flow                               |
| Create | `client/components/home/__tests__/DiscoveryCard.test.tsx`         | Renders fields; dismiss + CTA callbacks                      |
| Create | `client/components/home/__tests__/DiscoveryCarousel.test.tsx`     | Null when empty; renders N cards                             |

---

## Task 1: Card config type + 12-card inventory

**Files:**

- Create: `client/components/home/discovery-cards-config.ts`
- Create: `client/components/home/__tests__/discovery-cards-config.test.ts`

- [ ] **Step 1: Write the failing integrity test**

```ts
// client/components/home/__tests__/discovery-cards-config.test.ts
import { describe, it, expect } from "vitest";
import { DISCOVERY_CARDS } from "../discovery-cards-config";
import { HOME_ACTIONS } from "../action-config";

describe("discovery-cards-config", () => {
  it("every card id maps to an existing HOME_ACTION", () => {
    const actionIds = new Set(HOME_ACTIONS.map((a) => a.id));
    for (const card of DISCOVERY_CARDS) {
      expect(
        actionIds.has(card.id),
        `card.id "${card.id}" not found in HOME_ACTIONS`,
      ).toBe(true);
    }
  });

  it("has no duplicate card ids", () => {
    const ids = DISCOVERY_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run client/components/home/__tests__/discovery-cards-config.test.ts
```

Expected: FAIL — `DISCOVERY_CARDS` not exported.

- [ ] **Step 3: Create the config file**

```ts
// client/components/home/discovery-cards-config.ts
export interface DiscoveryCard {
  id: string; // matches HomeAction.id — drives visibility check and navigation
  eyebrow: string;
  headline: string;
  subtitle: string;
  emoji: string; // decorative watermark emoji rendered at large size
  ctaLabel: string;
}

export const DISCOVERY_CARDS: DiscoveryCard[] = [
  {
    id: "scan-receipt",
    eyebrow: "✨ Try this",
    headline: "Scan receipts to fill your pantry instantly",
    subtitle: "Point your camera at any grocery receipt.",
    emoji: "📷",
    ctaLabel: "Scan Now",
  },
  {
    id: "photo-food-log",
    eyebrow: "✨ Try this",
    headline: "Log food by snapping a photo",
    subtitle: "No searching — just point and shoot.",
    emoji: "📷",
    ctaLabel: "Try Photo Log",
  },
  {
    id: "scan-menu",
    eyebrow: "✨ Try this",
    headline: "Point at a restaurant menu to track your meal",
    subtitle: "Works at any restaurant or café.",
    emoji: "🍽",
    ctaLabel: "Scan a Menu",
  },
  {
    id: "scan-nutrition-label",
    eyebrow: "✨ Try this",
    headline: "Scan nutrition labels for instant, accurate data",
    subtitle: "More reliable than barcode lookup.",
    emoji: "📋",
    ctaLabel: "Scan a Label",
  },
  {
    id: "batch-scan",
    eyebrow: "✨ Try this",
    headline: "Scan multiple barcodes at once",
    subtitle: "Bulk-log a whole grocery haul in seconds.",
    emoji: "📦",
    ctaLabel: "Try Batch Scan",
  },
  {
    id: "ai-coach",
    eyebrow: "✨ Try this",
    headline: "Ask your AI nutrition coach anything",
    subtitle: "Get personalised advice about your diet.",
    emoji: "🤖",
    ctaLabel: "Open Coach",
  },
  {
    id: "meal-plan",
    eyebrow: "✨ Try this",
    headline: "Plan your week's meals and hit your goals",
    subtitle: "Auto-generates your grocery list too.",
    emoji: "📅",
    ctaLabel: "Start Planning",
  },
  {
    id: "grocery-list",
    eyebrow: "✨ Try this",
    headline: "Build smart shopping lists from your meal plan",
    subtitle: "One tap from your weekly plan to the shop.",
    emoji: "🛒",
    ctaLabel: "Create a List",
  },
  {
    id: "pantry",
    eyebrow: "✨ Try this",
    headline: "Track what's in your kitchen",
    subtitle: "Never waste food or duplicate ingredients.",
    emoji: "🥫",
    ctaLabel: "Open Pantry",
  },
  {
    id: "voice-log",
    eyebrow: "✨ Try this",
    headline: "Log food hands-free — just say what you ate",
    subtitle: "Great for cooking or eating on the go.",
    emoji: "🎤",
    ctaLabel: "Try Voice Log",
  },
  {
    id: "generate-recipe",
    eyebrow: "✨ Try this",
    headline: "Generate custom recipes tailored to your goals",
    subtitle: "AI-powered and ready to cook.",
    emoji: "⚡",
    ctaLabel: "Generate Recipe",
  },
  {
    id: "import-recipe",
    eyebrow: "✨ Try this",
    headline: "Import any recipe from a website in seconds",
    subtitle: "Paste a URL and we'll parse the rest.",
    emoji: "🔗",
    ctaLabel: "Import a Recipe",
  },
];
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run client/components/home/__tests__/discovery-cards-config.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add client/components/home/discovery-cards-config.ts \
        client/components/home/__tests__/discovery-cards-config.test.ts
git commit -m "feat: add feature discovery card config with 12-card inventory"
```

---

## Task 2: discovery-storage (AsyncStorage wrapper)

**Files:**

- Create: `client/lib/discovery-storage.ts`
- Create: `client/lib/__tests__/discovery-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// client/lib/__tests__/discovery-storage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

import {
  initDiscoveryCache,
  getDismissedCardIds,
  dismissCard,
} from "../discovery-storage";

describe("discovery-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
  });

  it("getDismissedCardIds returns empty set before init", () => {
    expect(getDismissedCardIds().size).toBe(0);
  });

  it("initDiscoveryCache with no prior data leaves dismissed set empty", async () => {
    await initDiscoveryCache();
    expect(getDismissedCardIds().size).toBe(0);
  });

  it("initDiscoveryCache hydrates from stored JSON", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(
      JSON.stringify(["scan-receipt", "pantry"]),
    );
    await initDiscoveryCache();
    const ids = getDismissedCardIds();
    expect(ids.has("scan-receipt")).toBe(true);
    expect(ids.has("pantry")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("dismissCard persists to AsyncStorage and updates in-memory cache", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    await initDiscoveryCache();

    await dismissCard("scan-receipt");

    expect(getDismissedCardIds().has("scan-receipt")).toBe(true);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      "@ocrecipes_dismissed_discovery_cards",
      JSON.stringify(["scan-receipt"]),
    );
  });

  it("dismissCard accumulates multiple dismissals without duplicates", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    await initDiscoveryCache();

    await dismissCard("scan-receipt");
    await dismissCard("pantry");
    await dismissCard("scan-receipt"); // duplicate — should not grow set

    const ids = getDismissedCardIds();
    expect(ids.size).toBe(2);
    expect(ids.has("scan-receipt")).toBe(true);
    expect(ids.has("pantry")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run client/lib/__tests__/discovery-storage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the storage module**

```ts
// client/lib/discovery-storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const DISMISSED_KEY = "@ocrecipes_dismissed_discovery_cards";

let dismissedCache: Set<string> | null = null;

export async function initDiscoveryCache(): Promise<void> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
  try {
    dismissedCache = new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    dismissedCache = new Set();
  }
}

export function getDismissedCardIds(): Set<string> {
  return dismissedCache ?? new Set();
}

export async function dismissCard(id: string): Promise<void> {
  const updated = new Set(getDismissedCardIds());
  updated.add(id);
  dismissedCache = updated;
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...updated]));
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run client/lib/__tests__/discovery-storage.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/lib/discovery-storage.ts \
        client/lib/__tests__/discovery-storage.test.ts
git commit -m "feat: add discovery-storage AsyncStorage wrapper for dismissed card IDs"
```

---

## Task 3: useDiscoveryCards hook

**Files:**

- Create: `client/hooks/useDiscoveryCards.ts`
- Create: `client/hooks/__tests__/useDiscoveryCards.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// client/hooks/__tests__/useDiscoveryCards.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { mockInitDiscoveryCache, mockGetDismissedCardIds, mockDismissCard } =
  vi.hoisted(() => ({
    mockInitDiscoveryCache: vi.fn(),
    mockGetDismissedCardIds: vi.fn(),
    mockDismissCard: vi.fn(),
  }));

vi.mock("@/lib/discovery-storage", () => ({
  initDiscoveryCache: () => mockInitDiscoveryCache(),
  getDismissedCardIds: () => mockGetDismissedCardIds(),
  dismissCard: (id: string) => mockDismissCard(id),
}));

import { useDiscoveryCards } from "../useDiscoveryCards";

describe("useDiscoveryCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitDiscoveryCache.mockResolvedValue(undefined);
    mockGetDismissedCardIds.mockReturnValue(new Set<string>());
    mockDismissCard.mockResolvedValue(undefined);
  });

  it("returns scan-receipt card when usageCounts is empty", async () => {
    const { result } = renderHook(() => useDiscoveryCards({}));
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        true,
      ),
    );
  });

  it("hides a card when its usageCounts entry is greater than zero", async () => {
    const { result } = renderHook(() =>
      useDiscoveryCards({ "scan-receipt": 2 }),
    );
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        false,
      ),
    );
  });

  it("hides a card immediately after dismiss() is called", async () => {
    const { result } = renderHook(() => useDiscoveryCards({}));
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        true,
      ),
    );

    await act(async () => {
      await result.current.dismiss("scan-receipt");
    });

    expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
      false,
    );
    expect(mockDismissCard).toHaveBeenCalledWith("scan-receipt");
  });

  it("returns empty array when all 12 cards have been used", async () => {
    const allUsed = Object.fromEntries(
      [
        "scan-receipt",
        "photo-food-log",
        "scan-menu",
        "scan-nutrition-label",
        "batch-scan",
        "ai-coach",
        "meal-plan",
        "grocery-list",
        "pantry",
        "voice-log",
        "generate-recipe",
        "import-recipe",
      ].map((id) => [id, 1]),
    );
    const { result } = renderHook(() => useDiscoveryCards(allUsed));
    await waitFor(() => expect(result.current.cards).toHaveLength(0));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run client/hooks/__tests__/useDiscoveryCards.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the hook**

```ts
// client/hooks/useDiscoveryCards.ts
import { useState, useCallback, useEffect } from "react";
import {
  initDiscoveryCache,
  getDismissedCardIds,
  dismissCard,
} from "@/lib/discovery-storage";
import {
  DISCOVERY_CARDS,
  type DiscoveryCard,
} from "@/components/home/discovery-cards-config";

export function useDiscoveryCards(usageCounts: Record<string, number>): {
  cards: DiscoveryCard[];
  dismiss: (id: string) => Promise<void>;
} {
  const [dismissedIds, setDismissedIds] =
    useState<Set<string>>(getDismissedCardIds);

  useEffect(() => {
    initDiscoveryCache().then(() => {
      setDismissedIds(new Set(getDismissedCardIds()));
    });
  }, []);

  const visibleCards = DISCOVERY_CARDS.filter(
    (card) => (usageCounts[card.id] ?? 0) === 0 && !dismissedIds.has(card.id),
  );

  const dismiss = useCallback(async (id: string) => {
    await dismissCard(id);
    setDismissedIds((prev) => new Set([...prev, id]));
  }, []);

  return { cards: visibleCards, dismiss };
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run client/hooks/__tests__/useDiscoveryCards.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useDiscoveryCards.ts \
        client/hooks/__tests__/useDiscoveryCards.test.ts
git commit -m "feat: add useDiscoveryCards hook for usage-driven card visibility"
```

---

## Task 4: EmptyState — optional secondary action

**Files:**

- Modify: `client/components/EmptyState.tsx`
- Modify: `client/components/__tests__/EmptyState.test.tsx`

- [ ] **Step 1: Add the failing test to the existing EmptyState test file**

Open `client/components/__tests__/EmptyState.test.tsx` and add this test at the end of the `describe` block (before the closing `}`):

```ts
  it("renders secondary link when secondaryLabel and onSecondaryAction are provided", () => {
    const onSecondaryAction = vi.fn();
    renderComponent(
      <EmptyState
        variant="firstTime"
        icon="camera"
        title="Your pantry is empty"
        description="Scan a receipt"
        actionLabel="Scan a Receipt"
        onAction={vi.fn()}
        secondaryLabel="or add items manually"
        onSecondaryAction={onSecondaryAction}
      />,
    );
    expect(screen.getByText("or add items manually")).toBeDefined();
  });

  it("does not render secondary link when secondaryLabel is absent", () => {
    renderComponent(
      <EmptyState
        variant="firstTime"
        icon="camera"
        title="Title"
        description="Desc"
      />,
    );
    expect(screen.queryByText("or add items manually")).toBeNull();
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run client/components/__tests__/EmptyState.test.tsx
```

Expected: FAIL — `secondaryLabel` prop not accepted.

- [ ] **Step 3: Update EmptyState.tsx**

Open `client/components/EmptyState.tsx`. The full updated file:

```tsx
// client/components/EmptyState.tsx
import React from "react";
import { StyleSheet, Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { getEmptyStateDefaults } from "./empty-state-utils";
import type { EmptyStateVariant } from "./empty-state-utils";

interface EmptyStateProps {
  variant: EmptyStateVariant;
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

export function EmptyState({
  variant,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const defaults = getEmptyStateDefaults(variant);

  const entering = reducedMotion ? undefined : FadeInUp.duration(300);

  return (
    <Animated.View
      entering={entering}
      style={styles.container}
      accessibilityLabel={`${title}. ${description}`}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: withOpacity(theme.text, 0.06) },
        ]}
      >
        <Feather
          name={icon as keyof typeof Feather.glyphMap}
          size={defaults.iconSize}
          color={withOpacity(theme.text, defaults.iconOpacity)}
          accessible={false}
        />
      </View>
      <ThemedText type="h4" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.description, { color: theme.textSecondary }]}
      >
        {description}
      </ThemedText>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: theme.link,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <ThemedText
            type="body"
            style={[styles.actionText, { color: theme.buttonText }]}
          >
            {actionLabel}
          </ThemedText>
        </Pressable>
      )}
      {secondaryLabel && onSecondaryAction && (
        <Pressable
          onPress={onSecondaryAction}
          accessibilityRole="button"
          accessibilityLabel={secondaryLabel}
          style={styles.secondaryAction}
        >
          <ThemedText
            type="small"
            style={[styles.secondaryText, { color: theme.link }]}
          >
            {secondaryLabel}
          </ThemedText>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  description: {
    textAlign: "center",
    maxWidth: 280,
  },
  actionButton: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.button,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  actionText: {
    fontFamily: FontFamily.semiBold,
  },
  secondaryAction: {
    marginTop: Spacing.md,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  secondaryText: {
    fontFamily: FontFamily.medium,
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run client/components/__tests__/EmptyState.test.tsx
```

Expected: PASS — 7 tests (5 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add client/components/EmptyState.tsx \
        client/components/__tests__/EmptyState.test.tsx
git commit -m "feat: add optional secondaryLabel/onSecondaryAction to EmptyState"
```

---

## Task 5: DiscoveryCard component

**Files:**

- Create: `client/components/home/DiscoveryCard.tsx`
- Create: `client/components/home/__tests__/DiscoveryCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/components/home/__tests__/DiscoveryCard.test.tsx
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { DiscoveryCard } from "../DiscoveryCard";
import type { DiscoveryCard as DiscoveryCardType } from "../discovery-cards-config";

const mockCard: DiscoveryCardType = {
  id: "scan-receipt",
  eyebrow: "✨ Try this",
  headline: "Scan receipts to fill your pantry instantly",
  subtitle: "Point your camera at any grocery receipt.",
  emoji: "📷",
  ctaLabel: "Scan Now",
};

describe("DiscoveryCard", () => {
  const onPress = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the headline", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    expect(
      screen.getByText("Scan receipts to fill your pantry instantly"),
    ).toBeDefined();
  });

  it("renders the subtitle", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    expect(
      screen.getByText("Point your camera at any grocery receipt."),
    ).toBeDefined();
  });

  it("renders the CTA label", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    expect(screen.getByLabelText("Scan Now")).toBeDefined();
  });

  it("calls onDismiss when the dismiss button is pressed", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    fireEvent.press(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onPress when the CTA button is pressed", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    fireEvent.press(screen.getByLabelText("Scan Now"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run client/components/home/__tests__/DiscoveryCard.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the DiscoveryCard component**

```tsx
// client/components/home/DiscoveryCard.tsx
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeOut } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { FontFamily, Spacing, BorderRadius } from "@/constants/theme";
import type { DiscoveryCard as DiscoveryCardType } from "./discovery-cards-config";

interface DiscoveryCardProps {
  card: DiscoveryCardType;
  onPress: () => void;
  onDismiss: () => void;
  reducedMotion: boolean;
  width: number;
}

export function DiscoveryCard({
  card,
  onPress,
  onDismiss,
  reducedMotion,
  width,
}: DiscoveryCardProps) {
  return (
    <Animated.View
      style={[styles.container, { width }]}
      exiting={reducedMotion ? undefined : FadeOut.duration(200)}
    >
      <LinearGradient
        colors={["#7B2D14", "#B5451C", "#D4683A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <ThemedText style={styles.watermark} accessibilityElementsHidden>
        {card.emoji}
      </ThemedText>
      <Pressable
        onPress={onDismiss}
        style={styles.dismissButton}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
      >
        <ThemedText style={styles.dismissX}>✕</ThemedText>
      </Pressable>
      <ThemedText style={styles.eyebrow}>{card.eyebrow}</ThemedText>
      <ThemedText style={styles.headline} numberOfLines={2}>
        {card.headline}
      </ThemedText>
      <ThemedText style={styles.subtitle} numberOfLines={1}>
        {card.subtitle}
      </ThemedText>
      <Pressable
        onPress={onPress}
        style={styles.cta}
        accessibilityRole="button"
        accessibilityLabel={card.ctaLabel}
      >
        <ThemedText style={styles.ctaText}>{card.ctaLabel} →</ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: "hidden",
    padding: Spacing.md,
    minHeight: 120,
  },
  watermark: {
    position: "absolute",
    right: -4,
    bottom: -4,
    fontSize: 64,
    opacity: 0.15,
  },
  dismissButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  dismissX: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 9,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: FontFamily.bold,
    lineHeight: 20,
    paddingRight: 24,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    paddingRight: 32,
    marginBottom: Spacing.md,
    lineHeight: 16,
  },
  cta: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    borderRadius: BorderRadius.chip,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    alignSelf: "flex-start",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run client/components/home/__tests__/DiscoveryCard.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/components/home/DiscoveryCard.tsx \
        client/components/home/__tests__/DiscoveryCard.test.tsx
git commit -m "feat: add DiscoveryCard gradient component with dismiss button"
```

---

## Task 6: DiscoveryCarousel component

**Files:**

- Create: `client/components/home/DiscoveryCarousel.tsx`
- Create: `client/components/home/__tests__/DiscoveryCarousel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/components/home/__tests__/DiscoveryCarousel.test.tsx
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { DiscoveryCarousel } from "../DiscoveryCarousel";
import type { DiscoveryCard } from "../discovery-cards-config";

const mockCards: DiscoveryCard[] = [
  {
    id: "scan-receipt",
    eyebrow: "✨ Try this",
    headline: "Scan receipts to fill your pantry instantly",
    subtitle: "Point your camera at any grocery receipt.",
    emoji: "📷",
    ctaLabel: "Scan Now",
  },
  {
    id: "photo-food-log",
    eyebrow: "✨ Try this",
    headline: "Log food by snapping a photo",
    subtitle: "No searching — just point and shoot.",
    emoji: "📷",
    ctaLabel: "Try Photo Log",
  },
];

const { mockUseDiscoveryCards } = vi.hoisted(() => ({
  mockUseDiscoveryCards: vi.fn(),
}));

vi.mock("@/hooks/useDiscoveryCards", () => ({
  useDiscoveryCards: (...args: unknown[]) => mockUseDiscoveryCards(...args),
}));

describe("DiscoveryCarousel", () => {
  const onActionPress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when cards array is empty", () => {
    mockUseDiscoveryCards.mockReturnValue({ cards: [], dismiss: vi.fn() });
    const { container } = renderComponent(
      <DiscoveryCarousel onActionPress={onActionPress} usageCounts={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a card item for each card in the list", () => {
    mockUseDiscoveryCards.mockReturnValue({
      cards: mockCards,
      dismiss: vi.fn(),
    });
    renderComponent(
      <DiscoveryCarousel onActionPress={onActionPress} usageCounts={{}} />,
    );
    expect(
      screen.getByText("Scan receipts to fill your pantry instantly"),
    ).toBeDefined();
    expect(screen.getByText("Log food by snapping a photo")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run client/components/home/__tests__/DiscoveryCarousel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the DiscoveryCarousel component**

```tsx
// client/components/home/DiscoveryCarousel.tsx
import React, { useState } from "react";
import { FlatList, StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { DiscoveryCard } from "./DiscoveryCard";
import { HOME_ACTIONS } from "./action-config";
import { useDiscoveryCards } from "@/hooks/useDiscoveryCards";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";
import type { HomeAction } from "./action-config";

const CARD_H_PADDING = Spacing.lg;
const CARD_GAP = Spacing.sm;
const PEEK = 20;

interface DiscoveryCarouselProps {
  onActionPress: (action: HomeAction) => void;
  usageCounts: Record<string, number>;
}

export function DiscoveryCarousel({
  onActionPress,
  usageCounts,
}: DiscoveryCarouselProps) {
  const { width: screenWidth } = useWindowDimensions();
  const { reducedMotion } = useAccessibility();
  const { theme } = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const { cards, dismiss } = useDiscoveryCards(usageCounts);

  if (cards.length === 0) return null;

  const cardWidth = screenWidth - CARD_H_PADDING * 2 - PEEK;
  const clampedIndex = Math.min(activeIndex, cards.length - 1);

  return (
    <View>
      <ThemedText
        style={[styles.sectionHeader, { color: theme.textSecondary }]}
      >
        DISCOVER
      </ThemedText>
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: CARD_H_PADDING,
          gap: CARD_GAP,
        }}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(
            e.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP),
          );
          setActiveIndex(index);
        }}
        renderItem={({ item }) => {
          const action = HOME_ACTIONS.find((a) => a.id === item.id);
          return (
            <DiscoveryCard
              card={item}
              width={cardWidth}
              reducedMotion={reducedMotion}
              onPress={() => action && onActionPress(action)}
              onDismiss={() => dismiss(item.id)}
            />
          );
        }}
        accessibilityRole="list"
        accessibilityLabel="Feature discovery cards"
      />
      <View style={styles.dotsRow}>
        {cards.map((card, i) => (
          <View
            key={card.id}
            style={[
              styles.dot,
              i === clampedIndex
                ? [styles.dotActive, { backgroundColor: theme.link }]
                : { backgroundColor: withOpacity(theme.text, 0.15) },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    paddingVertical: Spacing.sm,
  },
  dot: {
    height: 5,
    width: 5,
    borderRadius: 2.5,
  },
  dotActive: {
    width: 14,
    borderRadius: 3,
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run client/components/home/__tests__/DiscoveryCarousel.test.tsx
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add client/components/home/DiscoveryCarousel.tsx \
        client/components/home/__tests__/DiscoveryCarousel.test.tsx
git commit -m "feat: add DiscoveryCarousel snapping FlatList with pagination dots"
```

---

## Task 7: HomeScreen integration

**Files:**

- Modify: `client/screens/HomeScreen.tsx`

No new unit test needed — the carousel's own tests cover its logic. Verify manually in the simulator.

- [ ] **Step 1: Add the DiscoveryCarousel import**

In `client/screens/HomeScreen.tsx`, add this import after the existing home component imports (around line 16):

```ts
import { DiscoveryCarousel } from "@/components/home/DiscoveryCarousel";
```

- [ ] **Step 2: Insert the carousel between the header and RecentActionsRow**

Find the block in `HomeScreen.tsx` that renders `<Animated.View style={[styles.expandableHeader, headerAnimatedStyle]}>` (around line 151) and add `<DiscoveryCarousel>` immediately after the closing `</Animated.View>` tag:

```tsx
        <Animated.View style={[styles.expandableHeader, headerAnimatedStyle]}>
          <DailySummaryHeader onCalorieTap={handleCalorieTap} />
        </Animated.View>

        <DiscoveryCarousel
          onActionPress={handleActionPress}
          usageCounts={usageCounts}
        />

        <RecentActionsRow
```

- [ ] **Step 3: Verify types compile**

```bash
npm run check:types
```

Expected: no new errors.

- [ ] **Step 4: Verify in iOS Simulator**

Start the app (`npx expo run:ios`). On first launch (fresh install), the "DISCOVER" section appears below the daily summary with the gradient cards. Swipe the carousel to page through cards. Tap ✕ on a card to dismiss it — the card fades out. Tap any CTA — navigates correctly (respects premium gating for `generate-recipe`). After dismissing all cards, the "DISCOVER" section disappears entirely. After using a feature once (e.g. scan a receipt), its card no longer appears on next app open.

- [ ] **Step 5: Commit**

```bash
git add client/screens/HomeScreen.tsx
git commit -m "feat: add DiscoveryCarousel to HomeScreen between header and recent actions"
```

---

## Task 8: Feature screen enhanced empty states

**Files:**

- Modify: `client/screens/meal-plan/PantryScreen.tsx`
- Modify: `client/screens/meal-plan/GroceryListScreen.tsx`
- Modify: `client/screens/meal-plan/MealPlanHomeScreen.tsx`

No new unit tests — these are prop-level changes to existing, already-tested EmptyState usages. Verify manually.

### 8a — Pantry Screen

- [ ] **Step 1: Update the ListEmptyComponent in PantryScreen.tsx**

Find the `ListEmptyComponent` in `client/screens/meal-plan/PantryScreen.tsx` (around line 350). It currently reads:

```tsx
ListEmptyComponent={
  <EmptyState
    variant="firstTime"
    icon="package"
    title="Your pantry is empty"
    description="Add items below to track what you have at home."
    actionLabel="Add Items"
    onAction={() => addItemInputRef.current?.focus()}
  />
}
```

Replace it with:

```tsx
ListEmptyComponent={
  <EmptyState
    variant="firstTime"
    icon="camera"
    title="Your pantry is empty"
    description="Scan a grocery receipt and we'll add every item to your pantry automatically."
    actionLabel="Scan a Receipt"
    onAction={() => navigation.navigate("ReceiptCapture")}
    secondaryLabel="or add items manually"
    onSecondaryAction={() => addItemInputRef.current?.focus()}
  />
}
```

Add `useNavigation` import if not already present. `PantryScreen.tsx` already imports `useNavigation` and `RootStackParamList` — check the top of the file. If `navigation` is not already declared, add:

```ts
const navigation =
  useNavigation<NativeStackNavigationProp<RootStackParamList>>();
```

- [ ] **Step 2: Verify PantryScreen compiles**

```bash
npm run check:types
```

### 8b — Grocery List Screen

- [ ] **Step 3: Set up navigation, a TextInput ref, and the ListEmptyComponent in GroceryListScreen.tsx**

Add these imports at the top of `client/screens/meal-plan/GroceryListScreen.tsx`:

```ts
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
```

Inside the `GroceryListScreen` function body (near the other hook calls), add:

```ts
const navigation =
  useNavigation<NativeStackNavigationProp<MealPlanStackParamList>>();
const addItemRef = useRef<TextInput>(null);
```

Find the `<TextInput` used for manual item entry inside `ListFooterComponent` (around line 443) and attach the ref:

```tsx
<TextInput
  ref={addItemRef}
  {/* ...all existing props unchanged... */}
/>
```

Find the `<SectionList` (around line 352) and add `ListEmptyComponent` after `keyExtractor`:

```tsx
ListEmptyComponent={
  <EmptyState
    variant="firstTime"
    icon="shopping-cart"
    title="No items yet"
    description="Generate a shopping list from your meal plan in one tap, or add items yourself."
    actionLabel="Build from Meal Plan"
    onAction={() => navigation.navigate("MealPlanHome")}
    secondaryLabel="or add items manually"
    onSecondaryAction={() => addItemRef.current?.focus()}
  />
}
```

- [ ] **Step 4: Verify GroceryListScreen compiles**

```bash
npm run check:types
```

### 8c — Meal Plan Screen

- [ ] **Step 5: Add an EmptyState when the selected day has no items in MealPlanHomeScreen.tsx**

In `client/screens/meal-plan/MealPlanHomeScreen.tsx`, find the section that renders `{/* Meal Slots */}` (around line 1094). Insert the EmptyState **between** the `<CalorieRing .../>` and the `{MEAL_TYPES.map(...)` block:

```tsx
        {selectedDayItems.length === 0 && (
          <EmptyState
            variant="firstTime"
            icon="calendar"
            title="No meals planned yet"
            description="Plan your week's meals to hit your nutrition goals and auto-generate your grocery list."
            actionLabel="Browse Recipes"
            onAction={handleBrowseRecipes}
          />
        )}

        {/* Meal Slots */}
        {MEAL_TYPES.map((mealType) => {
```

Add the `EmptyState` import at the top of `MealPlanHomeScreen.tsx` (it is not currently imported):

```ts
import { EmptyState } from "@/components/EmptyState";
```

- [ ] **Step 6: Verify MealPlanHomeScreen compiles**

```bash
npm run check:types
```

- [ ] **Step 7: Run the full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 8: Verify in iOS Simulator**

- Open Pantry (empty): sees "Your pantry is empty" with "Scan a Receipt" CTA and "or add items manually" link.
- Tap "Scan a Receipt": navigates to ReceiptCapture.
- Tap "or add items manually": keyboard opens on the add-item text field.
- Open a new Grocery List (no items): sees "No items yet" with "Build from Meal Plan" CTA.
- Tap "Build from Meal Plan": navigates to MealPlanHome.
- Open Meal Plan on a day with no items: sees "No meals planned yet" with "Browse Recipes" CTA below the calorie ring.
- Tap "Browse Recipes": navigates to RecipeBrowser.

- [ ] **Step 9: Commit**

```bash
git add client/screens/meal-plan/PantryScreen.tsx \
        client/screens/meal-plan/GroceryListScreen.tsx \
        client/screens/meal-plan/MealPlanHomeScreen.tsx
git commit -m "feat: add camera-forward empty states to Pantry, Grocery, and Meal Plan screens"
```
