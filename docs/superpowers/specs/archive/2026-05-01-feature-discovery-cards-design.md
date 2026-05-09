# Feature Discovery Cards — Design Spec

**Date:** 2026-05-01
**Status:** Approved

## Overview

Introduce a feature discovery system to surface unused app capabilities to users. Two complementary surfaces: a swipeable carousel on the HomeScreen, and enhanced empty states inside feature screens. Cards disappear automatically as features are used and can be manually dismissed with an ✕ button.

## Goals

- Increase activation of camera-powered and planning features among users who haven't discovered them
- Respect user intent — cards disappear permanently once dismissed or after first feature use
- Add zero backend complexity — all state lives in AsyncStorage alongside existing usage tracking

## Non-Goals

- Cross-device sync of dismissal state (acceptable loss for a nudge system)
- Personalisation beyond "used vs. not used" (no ML, no server-side targeting)
- Modifying the existing `usageCounts` tracking mechanism

---

## Architecture

### Data Layer

**`client/components/home/discovery-cards-config.ts`** (new)

Static array of `DiscoveryCard` definitions. Each card maps 1-to-1 to an existing `HomeAction` id so visibility is computable from existing `usageCounts` data.

```ts
interface DiscoveryCard {
  id: string; // matches HomeAction.id — used for both dismissal tracking and navigation
  eyebrow: string; // e.g. "✨ Try this"
  headline: string; // e.g. "Scan receipts to fill your pantry instantly"
  subtitle: string; // one short supporting line
  emoji: string; // large faded watermark emoji on the card
  ctaLabel: string; // e.g. "Scan Now"
}
```

**`client/lib/discovery-storage.ts`** (new)

AsyncStorage wrapper for dismissed card IDs. Mirrors the shape and in-memory cache pattern of `home-actions-storage.ts`.

- Key: `@ocrecipes_dismissed_discovery_cards`
- Serialised as a JSON array of strings
- Exports: `initDiscoveryCache()`, `getDismissedCardIds(): Set<string>`, `dismissCard(id: string): Promise<void>`

### Hooks

**`client/hooks/useDiscoveryCards.ts`** (new)

Computes the visible card set reactively. A card is visible when:

1. `usageCounts[card.id] === 0` (feature never used), AND
2. `card.id` not present in the dismissed set

Returns `{ cards: DiscoveryCard[]; dismiss: (id: string) => void }`.

### Components

**`client/components/home/DiscoveryCard.tsx`** (new)

Visual treatment: illustrated gradient (deep-to-light terracotta: `#7B2D14` → `#B5451C` → `#D4683A`). Large faded emoji watermark positioned bottom-right at ~15% opacity. Layout:

- Eyebrow label (small uppercase, e.g. "✨ Try this")
- Headline (bold, 2 lines max)
- Subtitle (muted, 1 line)
- CTA button (semi-transparent white pill, right-arrow)
- ✕ dismiss button (top-right, circular, semi-transparent white)

On dismiss: `FadeOut` animation → `dismissCard(id)` → card removed from visible set.

Props:

```ts
interface DiscoveryCardProps {
  card: DiscoveryCard;
  onPress: () => void;
  onDismiss: () => void;
  reducedMotion: boolean;
}
```

**`client/components/home/DiscoveryCarousel.tsx`** (new)

Horizontal `FlatList` with:

- Card width: ~90% of screen width (peek pattern reveals next card)
- `snapToInterval` + `decelerationRate="fast"` for smooth snapping
- Pagination dots below the track (active dot is a wider pill, inactive are circles)
- Section header: "✨ Discover"
- Returns `null` when `cards` is empty — section header also vanishes, leaving no gap

Props:

```ts
interface DiscoveryCarouselProps {
  onActionPress: (action: HomeAction) => void;
}
```

Internally calls `useDiscoveryCards()` and maps each card to a `DiscoveryCard` component. Navigation on CTA press reuses `navigateAction()` from `action-config.ts`. For premium actions (e.g. `generate-recipe`), this is handled by the existing `handleActionPress` in `HomeScreen` — non-premium users see the `UpgradeModal` rather than the screen.

---

## Card Inventory (v1 — 12 cards)

Ordered by display priority. Cards shown in this order to new users.

| id                     | Eyebrow     | Headline                                         | Subtitle                                   | Emoji | CTA             |
| ---------------------- | ----------- | ------------------------------------------------ | ------------------------------------------ | ----- | --------------- |
| `scan-receipt`         | ✨ Try this | Scan receipts to fill your pantry instantly      | Point your camera at any grocery receipt.  | 📷    | Scan Now        |
| `photo-food-log`       | ✨ Try this | Log food by snapping a photo                     | No searching — just point and shoot.       | 📷    | Try Photo Log   |
| `scan-menu`            | ✨ Try this | Point at a restaurant menu to track your meal    | Works at any restaurant or café.           | 🍽    | Scan a Menu     |
| `scan-nutrition-label` | ✨ Try this | Scan nutrition labels for instant, accurate data | More reliable than barcode lookup.         | 📋    | Scan a Label    |
| `batch-scan`           | ✨ Try this | Scan multiple barcodes at once                   | Bulk-log a whole grocery haul in seconds.  | 📦    | Try Batch Scan  |
| `ai-coach`             | ✨ Try this | Ask your AI nutrition coach anything             | Get personalised advice about your diet.   | 🤖    | Open Coach      |
| `meal-plan`            | ✨ Try this | Plan your week's meals and hit your goals        | Auto-generates your grocery list too.      | 📅    | Start Planning  |
| `grocery-list`         | ✨ Try this | Build smart shopping lists from your meal plan   | One tap from your weekly plan to the shop. | 🛒    | Create a List   |
| `pantry`               | ✨ Try this | Track what's in your kitchen                     | Never waste food or duplicate ingredients. | 🥫    | Open Pantry     |
| `voice-log`            | ✨ Try this | Log food hands-free — just say what you ate      | Great for cooking or eating on the go.     | 🎤    | Try Voice Log   |
| `generate-recipe`      | ✨ Try this | Generate custom recipes tailored to your goals   | AI-powered and ready to cook.              | ⚡    | Generate Recipe |
| `import-recipe`        | ✨ Try this | Import any recipe from a website in seconds      | Paste a URL and we'll parse the rest.      | 🔗    | Import a Recipe |

---

## HomeScreen Integration

**`client/screens/HomeScreen.tsx`** — edited

Insert `<DiscoveryCarousel onActionPress={handleActionPress} />` between `DailySummaryHeader` and `RecentActionsRow`. Reuses the existing `handleActionPress` callback (including premium gating and haptics) so carousel CTAs behave identically to `ActionRow` taps.

```tsx
<Animated.View style={[styles.expandableHeader, headerAnimatedStyle]}>
  <DailySummaryHeader onCalorieTap={handleCalorieTap} />
</Animated.View>

{/* NEW */}
<DiscoveryCarousel onActionPress={handleActionPress} />

<RecentActionsRow ... />
```

The carousel is wrapped in the same `FadeInDown` animation timing as the rest of the feed sections.

---

## Feature Screen Empty States

Three existing screens gain camera-forward CTAs when their lists are empty. All use the existing `EmptyState` component — the change is copy, icon, and `onAction` wiring. A secondary text link ("or add items manually") below the primary CTA preserves user agency.

### Pantry Screen (`client/screens/meal-plan/PantryScreen.tsx`)

- **Icon:** `camera` (Feather)
- **Title:** Your pantry is empty
- **Description:** Scan a grocery receipt and we'll add every item to your pantry automatically.
- **CTA:** Scan a Receipt → `navigation.navigate("ReceiptCapture")`
- **Secondary:** or add items manually → existing manual-add flow

### Grocery List Screen (`client/screens/meal-plan/GroceryListScreen.tsx`)

- **Icon:** `shopping-cart` (Feather)
- **Title:** No items yet
- **Description:** Generate a shopping list from your meal plan in one tap, or add items yourself.
- **CTA:** Build from Meal Plan → `navigation.navigate("MealPlanHome")`
- **Secondary:** or add items manually → existing manual-add flow

### Meal Plan Screen (`client/screens/meal-plan/MealPlanHomeScreen.tsx`)

- **Icon:** `calendar` (Feather)
- **Title:** No meals planned yet
- **Description:** Plan your week's meals to hit your nutrition goals and auto-generate your grocery list.
- **CTA:** Browse Recipes → `navigation.navigate("RecipeBrowser", {})`
- **Secondary:** none (no alternative manual-add flow exists for meal plans)

### EmptyState component (`client/components/EmptyState.tsx`) — minor edit

Add an optional `secondaryLabel` + `onSecondaryAction` prop pair. Rendered as a `Pressable` below the primary button, styled with `theme.link` colour. Both props are optional; existing usages are unaffected.

---

## Testing

### `client/lib/__tests__/discovery-storage.test.ts` (new)

- Init with no prior AsyncStorage data → `getDismissedCardIds()` returns empty Set
- `dismissCard(id)` persists to AsyncStorage and is reflected immediately via in-memory cache
- Re-`initDiscoveryCache()` hydrates correctly from stored JSON

### `client/components/home/__tests__/discovery-cards-config.test.ts` (new)

- Every `actionId` in the card inventory exists as an `id` in `HOME_ACTIONS` (integrity guard against config drift)

### `client/hooks/__tests__/useDiscoveryCards.test.ts` (new)

- Card visible when `usageCounts[id] === 0` and not dismissed
- Card hidden when `usageCounts[id] > 0`
- Card hidden immediately after `dismiss(id)` called
- Returns empty array when all cards dismissed or used

### `client/components/home/__tests__/DiscoveryCard.test.tsx` (new)

- Renders headline, subtitle, and CTA label
- Pressing ✕ calls `onDismiss`
- Pressing CTA calls `onPress`

### `client/components/home/__tests__/DiscoveryCarousel.test.tsx` (new)

- Returns `null` (nothing rendered) when `cards` is an empty array
- Renders correct number of card items when `cards` is populated

No snapshot tests — fragile against gradient/style changes.

---

## File Summary

| File                                                              | Status                          |
| ----------------------------------------------------------------- | ------------------------------- |
| `client/components/home/discovery-cards-config.ts`                | New                             |
| `client/lib/discovery-storage.ts`                                 | New                             |
| `client/hooks/useDiscoveryCards.ts`                               | New                             |
| `client/components/home/DiscoveryCard.tsx`                        | New                             |
| `client/components/home/DiscoveryCarousel.tsx`                    | New                             |
| `client/screens/HomeScreen.tsx`                                   | Edited                          |
| `client/screens/meal-plan/PantryScreen.tsx`                       | Edited                          |
| `client/screens/meal-plan/GroceryListScreen.tsx`                  | Edited                          |
| `client/screens/meal-plan/MealPlanHomeScreen.tsx`                 | Edited                          |
| `client/components/EmptyState.tsx`                                | Edited (optional secondary CTA) |
| `client/lib/__tests__/discovery-storage.test.ts`                  | New                             |
| `client/components/home/__tests__/discovery-cards-config.test.ts` | New                             |
| `client/hooks/__tests__/useDiscoveryCards.test.ts`                | New                             |
| `client/components/home/__tests__/DiscoveryCard.test.tsx`         | New                             |
| `client/components/home/__tests__/DiscoveryCarousel.test.tsx`     | New                             |
