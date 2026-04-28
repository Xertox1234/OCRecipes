# React Native Patterns

### Multi-Select Checkbox Pattern

For lists where users can select/deselect individual items, use `Set<number>` for O(1) lookup:

```typescript
// State: Track selected indices with Set for efficient lookup
const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

// Initialize all items as selected when data arrives
useEffect(() => {
  if (items.length > 0) {
    setSelectedItems(new Set(items.map((_, i) => i)));
  }
}, [items.length]); // See "Intentional useEffect Dependencies" pattern

// Toggle with haptic feedback
const toggleItemSelection = (index: number) => {
  haptics.selection();
  setSelectedItems((prev) => {
    const updated = new Set(prev);
    if (updated.has(index)) {
      updated.delete(index);
    } else {
      updated.add(index);
    }
    return updated;
  });
};

// In component - checkbox with accessibility
<Pressable
  onPress={() => toggleItemSelection(index)}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedItems.has(index) }}
  hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }} // 44x44 touch target
>
  <Feather
    name={selectedItems.has(index) ? "check-square" : "square"}
    size={22}
    color={selectedItems.has(index) ? theme.success : theme.textSecondary}
  />
</Pressable>

// Visual dimming for unselected items
<Card style={[styles.card, !isSelected && { opacity: 0.6 }]}>
```

**When to use:** Photo analysis results, batch operations, shopping lists.

### Premium Feature Gating UI

When a feature requires premium, extract the condition and provide clear feedback:

```typescript
// Extract condition to avoid repetition
const isFeatureAvailable = features.someFeature && canUseFeature;

// Button with lock badge and accessibility hint
<Pressable
  onPress={handleFeature}
  accessibilityLabel={
    isFeatureAvailable
      ? "Use premium feature"
      : "Premium feature locked"
  }
  accessibilityHint={
    isFeatureAvailable
      ? undefined
      : "Upgrade to premium to unlock this feature"
  }
>
  <Feather name="star" color={isFeatureAvailable ? theme.text : theme.textSecondary} />
  <ThemedText style={{ color: isFeatureAvailable ? theme.text : theme.textSecondary }}>
    Feature
  </ThemedText>
  {!isFeatureAvailable && (
    <View style={[styles.lockBadge, { backgroundColor: theme.backgroundRoot }]}>
      <Feather name="lock" size={10} color={theme.textSecondary} accessible={false} />
    </View>
  )}
</Pressable>

// Handler with warning haptic for locked state
const handleFeature = () => {
  if (isFeatureAvailable) {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    // Proceed with feature
  } else {
    haptics.notification(Haptics.NotificationFeedbackType.Warning);
    // Optionally show upgrade prompt
  }
};
```

**Prefer `usePremiumFeature(key)` over raw context access** for checking a single feature flag in a component:

```typescript
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";

// Good: one-liner, boolean result
const canShowMacros = usePremiumFeature("macroGoals");

// Avoid: pulling the full context just to check one flag
const { features } = usePremiumContext();
const canShowMacros = features.macroGoals;
```

Use `usePremiumCamera()` only in camera screens where you need the combined bundle (barcode types, scan limits, quality, etc.).

**Section-level gating — replace content with a lock row:**

When an entire section is premium-only, show the content for premium users and replace it with a compact `Pressable` lock row for free users. The lock row should have full accessibility props and be tappable for a future upgrade modal.

```typescript
// ProfileScreen — NutritionGoalsSection
const canShowMacros = usePremiumFeature("macroGoals");

{canShowMacros ? (
  <>
    <View style={styles.macroGoalRow}>
      {/* Protein progress bar */}
    </View>
    <View style={styles.macroGoalRow}>
      {/* Carbs progress bar */}
    </View>
    <View style={[styles.macroGoalRow, styles.macroGoalRowLast]}>
      {/* Fat progress bar */}
    </View>
  </>
) : (
  <Pressable
    accessible
    accessibilityRole="button"
    accessibilityLabel="Detailed macro tracking requires Premium subscription"
    accessibilityHint="Upgrade to premium to unlock macro goals"
    onPress={() => {
      // TODO: Show upgrade modal
    }}
    style={[styles.macroGoalRow, styles.macroGoalRowLast, styles.premiumLockRow]}
  >
    <Feather name="lock" size={16} color={theme.textSecondary} />
    <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
      Detailed macro tracking available with Premium
    </ThemedText>
  </Pressable>
)}
```

**Key rules for section-level gating:**

- Lock row uses `Pressable`, not `View` — keeps it tappable for upgrade prompts
- Always set `accessible`, `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint`
- Use `theme.textSecondary` for lock icon and text (muted, not attention-grabbing)
- Extract lock row layout into a named style (`premiumLockRow`) instead of inline

**Disabled input gating — visible but non-editable:**

When free users should _see_ calculated values but not _edit_ them, render the inputs as disabled with a lock icon overlay. This preserves layout and lets free users understand what premium offers.

```typescript
// GoalSetupScreen — macro goal inputs
const canSetMacros = usePremiumFeature("macroGoals");

<View style={[styles.goalItem, !canSetMacros && { opacity: 0.4 }]}>
  <View>
    <TextInput
      style={[styles.goalInput, { backgroundColor: theme.backgroundSecondary, color: theme.proteinAccent }]}
      value={manualProtein}
      onChangeText={setManualProtein}
      keyboardType="numeric"
      editable={canSetMacros}
      accessibilityLabel={
        canSetMacros
          ? "Daily protein target"
          : "Daily protein target (Premium required)"
      }
    />
    {!canSetMacros && (
      <View style={styles.goalLockIcon}>
        <Feather name="lock" size={12} color={theme.textSecondary} />
      </View>
    )}
  </View>
  <ThemedText type="small" style={{ color: theme.textSecondary }}>
    Protein (g)
  </ThemedText>
</View>
```

**Key rules for disabled input gating:**

- Set `editable={false}` on `TextInput` — prevents keyboard from opening
- Apply `opacity: 0.4` to the wrapper — visually signals "unavailable"
- Position a lock icon absolutely within the input area (`position: "absolute"`, top-right)
- Append "(Premium required)" to `accessibilityLabel` so screen readers announce the restriction
- The calculated server values still save normally — free users get defaults, premium users can override

### Parent Label Prefix for Decorative Child Elements (Accessibility)

When a component has a decorative badge or status indicator that is a visual child of an interactive parent (like a `Pressable`), prevent double-announcement by:

1. Prefixing the parent's `accessibilityLabel` with the badge status
2. Setting `accessible={false}` on the child element

This pattern applies to any card, button, or interactive component with a decorative badge (remix badge, premium lock, allergen indicator, etc.).

```typescript
// ❌ Bad: Child badge announces separately — VoiceOver hears "Remixed recipe" twice
<Pressable
  accessibilityLabel="Pasta Carbonara by Alice"
  accessibilityRole="button"
>
  <View>
    <Image source={{ uri: imageUrl }} />
    <Text>Pasta Carbonara</Text>
    {remixedFromId && (
      <View style={styles.remixBadge}>
        <Feather name="repeat-2" size={12} />
        <Text accessibilityLabel="Remixed recipe">Remixed</Text>
      </View>
    )}
  </View>
</Pressable>
```

```typescript
// ✅ Good: Parent label includes badge status; child is invisible to a11y tree
<Pressable
  accessibilityLabel={
    remixedFromId
      ? "Remixed recipe. Pasta Carbonara by Alice"
      : "Pasta Carbonara by Alice"
  }
  accessibilityRole="button"
>
  <View>
    <Image source={{ uri: imageUrl }} />
    <Text>Pasta Carbonara</Text>
    {remixedFromId && (
      <View
        style={styles.remixBadge}
        accessible={false}  // Hide from a11y tree
      >
        <Feather name="repeat-2" size={12} />
        <Text>Remixed</Text>
      </View>
    )}
  </View>
</Pressable>
```

**When to use:**

- Decorative badges in card/button components (remix badge, lock icon, allergen dot)
- Status indicators that are visual-only (not tappable)
- Components where the badge semantics should roll into the parent label

**When NOT to use:**

- Interactive badges or controls (if the badge itself is tappable, it needs its own label)
- Informational text that provides different meaning than the parent (e.g., an error message that contradicts the parent label)

**Why:** React Native's accessibility system (iOS VoiceOver, Android TalkBack) announce all interactive element labels in hierarchy. A child with `accessibilityLabel` inside a parent `Pressable` causes both to announce, resulting in repetition. Setting `accessible={false}` removes the child from the a11y tree while keeping it visually rendered. Prefixing the parent's label ensures the information is still available to screen reader users.

**Related checks:**

- Code reviewer: "Decorative badges must set `accessible={false}` and parent label must include badge status"
- Touch target: Badge wrapper itself should never be tappable (hit target only on parent)

### Intentional useEffect Dependencies

When you deliberately use a derived value (like `array.length`) instead of the array itself in a useEffect dependency, document WHY to prevent "fixes" that break the intended behavior:

```typescript
// Good: Clear comment explaining the intentional choice
// Initialize all items as selected when foods array populates.
// We intentionally only track foods.length (not the foods array reference) because:
// 1. handleEditFood creates new array references but preserves length
// 2. We only want to reset selections when AI analysis returns NEW foods
// 3. This avoids resetting user's selections when they edit food names
useEffect(() => {
  if (foods.length > 0) {
    setSelectedItems(new Set(foods.map((_, i) => i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [foods.length]);
```

```typescript
// Bad: Suppressing lint without explanation invites "fixes"
useEffect(() => {
  if (foods.length > 0) {
    setSelectedItems(new Set(foods.map((_, i) => i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [foods.length]); // Future dev: "Why not [foods]? Let me fix this..."
```

**Rule:** If you suppress `react-hooks/exhaustive-deps`, always explain WHY in a comment above the useEffect.

### Conditional Pressable Rendering

When building reusable wrapper components that may or may not be interactive, conditionally render as `View` or `Pressable` based on whether `onPress` is provided:

```typescript
// Good: Renders as View when not interactive
export function Card({ children, onPress, style }: CardProps) {
  const content = <>{children}</>;

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={[styles.card, style]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{content}</View>;
}

// Usage - Card passes through touch events to parent
<Pressable onPress={handleNavigate}>
  <Card>  {/* Renders as View, doesn't block touches */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

```typescript
// Bad: Always renders as Pressable
export function Card({ children, onPress, style }: CardProps) {
  return (
    <Pressable onPress={onPress} style={[styles.card, style]}>
      {children}
    </Pressable>
  );
}

// Problem - nested Pressables block touch events
<Pressable onPress={handleNavigate}>  {/* This onPress never fires! */}
  <Card>  {/* Inner Pressable captures and swallows the touch */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

**Why:** In React Native, nested `Pressable` components cause the inner one to capture touch events. If the inner `Pressable` has no `onPress` handler, the touch is swallowed and the parent never receives it.

**When to use:** Any reusable component (Card, ListItem, Container) that wraps content and may optionally be tappable.

### Route Params for Mode Toggling

Use route params to toggle between screen modes instead of creating separate screens:

```typescript
// Good: Single screen with mode param (HistoryScreen.tsx)
type HistoryScreenRouteProp = RouteProp<
  { History: { showAll?: boolean } },
  "History"
>;

export default function HistoryScreen() {
  const route = useRoute<HistoryScreenRouteProp>();
  const showAll = route.params?.showAll ?? false;

  // Conditional rendering based on mode
  if (showAll) {
    return <FullHistoryView onBack={() => navigation.setParams({ showAll: false })} />;
  }

  return <DashboardView onViewAll={() => navigation.setParams({ showAll: true })} />;
}
```

```typescript
// Bad: Separate screens for each mode
// HistoryDashboardScreen.tsx
// FullHistoryScreen.tsx
// Duplicates shared logic, state management, and navigation setup
```

**When to use:**

- Dashboard + expanded view (Today dashboard vs full history)
- List view + detail view in same context
- Compact + expanded modes of same data

**Benefits:**

- Shared state and queries (no refetch when switching modes)
- Cleaner navigation stack (back button works naturally)
- Single source of truth for the data

### Deep Linking Configuration

Deep linking is configured in `client/navigation/linking.ts` and wired into `NavigationContainer` via the `linking` prop in `App.tsx`. The config maps URL paths to screens through the nested navigator hierarchy.

**Supported URLs:**

| URL pattern                        | Screen               | Stack path                                               |
| ---------------------------------- | -------------------- | -------------------------------------------------------- |
| `ocrecipes://recipe/:recipeId`     | FeaturedRecipeDetail | Root modal (uses community endpoint, works for any user) |
| `ocrecipes://chat/:conversationId` | Chat                 | Main → CoachTab → Chat                                   |
| `ocrecipes://nutrition/:barcode`   | NutritionDetail      | Root modal                                               |
| `ocrecipes://scan`                 | Scan                 | Root modal                                               |

Universal link prefix `https://ocrecipes.app` is also registered (requires server-side AASA file for iOS).

**Adding a new deep link path:**

1. Add the screen's path mapping to `linking.config.screens` in `client/navigation/linking.ts`, nesting it to match the navigator hierarchy
2. If the param is numeric, use `parseIntOrZero` for the parse function
3. Add a test case in `client/navigation/__tests__/linking.test.ts`

**Boundary validation for URL params:**

Deep links are untrusted external input. Always use `parseIntOrZero` (not raw `parseInt`) for numeric params — it returns `0` instead of `NaN` for non-numeric strings, which the screen's existing error/not-found UI handles gracefully.

```typescript
// client/navigation/linking.ts
function parseIntOrZero(value: string): number {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : num;
}

// Usage in config
FeaturedRecipeDetail: {
  path: "recipe/:recipeId",
  parse: { recipeId: parseIntOrZero },
},
```

### Deep Link Query Param Aliases

When a deep link uses a query param (`?type=mealPlan`) that maps to a different navigation param name (`recipeType`), handle it in three layers: parse, type, and screen fallback.

**1. Parse function in linking config** — sanitize the query param value:

```typescript
// client/navigation/linking.ts
FeaturedRecipeDetail: {
  path: "recipe/:recipeId",
  parse: {
    recipeId: parseIntOrZero,
    type: (value: string) =>
      value === "mealPlan" ? "mealPlan" : "community", // sanitize to known values
  },
},
```

**2. Add the alias field to the param list** — keeps it type-safe:

```typescript
// RootStackParamList
FeaturedRecipeDetail: {
  recipeId: number;
  recipeType?: "community" | "mealPlan";
  /** Deep link query param — alias for recipeType */
  type?: "community" | "mealPlan";
};
```

**3. Screen fallback chain** — prefer the canonical name, fall back to the alias:

```typescript
const recipeType = route.params.recipeType ?? route.params.type ?? "community";
```

**Why all three layers?** Deep links are untrusted external input. The parse function rejects garbage values at the boundary. The type declaration keeps TypeScript happy. The fallback chain ensures the screen works whether navigated to programmatically (`recipeType`) or via deep link (`type`).

**References:**

- `client/navigation/linking.ts` — `type` parser on `FeaturedRecipeDetail`
- `client/navigation/RootStackNavigator.tsx` — `type` field in `FeaturedRecipeDetail` params
- `client/screens/FeaturedRecipeDetailScreen.tsx` — fallback chain

### CompositeNavigationProp for Cross-Stack Navigation

When navigating from one tab stack to a screen in another tab stack, use `CompositeNavigationProp`:

```typescript
import {
  CompositeNavigationProp,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Define the composite type for cross-tab navigation
type HistoryScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HistoryStackParamList, "History">,
  BottomTabNavigationProp<MainTabParamList>
>;

export default function HistoryScreen() {
  const navigation = useNavigation<HistoryScreenNavigationProp>();

  const handleScanPress = () => {
    // Navigate to ScanTab (different tab stack)
    navigation.navigate("ScanTab");
  };

  const handleItemPress = (itemId: number) => {
    // Navigate within current stack
    navigation.navigate("ItemDetail", { itemId });
  };
}
```

**When to use:**

- Dashboard with "Scan" CTA that navigates to camera tab
- Profile screen navigating to history or settings in other tabs
- Any cross-tab navigation from within a stack

**Why:** Standard `NativeStackNavigationProp` only knows about screens in its own stack. `CompositeNavigationProp` combines the stack navigator's type with the tab navigator's type, enabling type-safe navigation across both.

### Intersection Type for Dual-Stack Screen Registration

When a screen is registered in **two different stack navigators** (e.g., `FavouriteRecipesScreen` in both `MealPlanStackNavigator` and `ProfileStackNavigator`), use an intersection type for the inner `NativeStackNavigationProp`:

```typescript
// Screen registered in both MealPlanStack and ProfileStack
type FavouriteRecipesScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<
    MealPlanStackParamList & ProfileStackParamList, // Intersection of both stacks
    "FavouriteRecipes"
  >,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;
```

**When to use:** A screen registered in multiple stack navigators that needs to navigate to routes from either hosting stack.

**Why intersection, not union?** The intersection (`A & B`) tells TypeScript "this screen can navigate to routes from _both_ stacks," which is truthful — React Navigation resolves navigation calls through the composite prop chain regardless of which stack is active.

**References:**

- `client/types/navigation.ts` — `FavouriteRecipesScreenNavigationProp`

### Align Route Params Across Dual-Navigator Screens

When a screen component is mounted in **two different navigators** with separate param lists (e.g., `RecipeBrowserScreen` as both `RecipeBrowser` in `MealPlanStack` and `RecipeBrowserModal` in `RootStack`), keep the shared param fields synchronized across both `ParamList` types. This extends the "Intersection Type for Dual-Stack Screen Registration" pattern above, which covers the navigation prop — this pattern covers the **route params**.

```typescript
// Both navigators define planDays — screen reads it without casting
export type MealPlanStackParamList = {
  RecipeBrowser: {
    mealType?: string;
    plannedDate?: string;
    planDays?: MealPlanDay[]; // ← also in RootStackParamList
  };
};

export type RootStackParamList = {
  RecipeBrowserModal:
    | { mealType?: string; date?: string; planDays?: MealPlanDay[] }
    | undefined;
};

// In the screen — no cast needed
const { mealType, plannedDate, searchQuery, planDays } = route.params || {};
```

```typescript
// Bad: Using `as` cast because the route type doesn't include planDays
const planDays = (route.params as { planDays?: MealPlanDay[] } | undefined)
  ?.planDays;
```

**Why:** React Navigation merges params at runtime regardless of TypeScript types. An `as` cast makes it _work_ but defeats the compiler — if someone renames `planDays` in one ParamList but not the other, no type error fires. Aligned types make the compiler your safety net.

**When to use:** A screen registered in two navigators that receives the same data field from both entry points.

**References:**

- `client/navigation/MealPlanStackNavigator.tsx` — `MealPlanStackParamList["RecipeBrowser"]`
- `client/navigation/RootStackNavigator.tsx` — `RootStackParamList["RecipeBrowserModal"]`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — reads `planDays` without cast

### Full-Screen Detail with transparentModal

Use `presentation: "transparentModal"` with `slide_from_bottom` animation for full-screen detail views. The screen component fills the entire screen with its own background, close button, and scrollable content. The hero image extends to the very top with no native chrome.

**Key learnings from iOS modal presentations:**

| Presentation                | Background visible            | Native chrome        | Verdict          |
| --------------------------- | ----------------------------- | -------------------- | ---------------- |
| `modal` / `formSheet`       | Yes                           | Grabber bar, detents | Not customizable |
| `containedTransparentModal` | Yes                           | Grabber bar          | Not customizable |
| `fullScreenModal`           | No (detaches previous screen) | None                 | Black background |
| `transparentModal`          | Yes                           | None                 | Use this one     |

**Navigator config:**

```typescript
// RootStackNavigator.tsx
<Stack.Screen
  name="RecipeDetail"
  component={RecipeDetailScreen}
  options={{
    headerShown: false,
    presentation: "transparentModal",
    animation: "slide_from_bottom",
  }}
/>
```

**Screen component:**

```typescript
// RecipeDetailScreen.tsx
export default function RecipeDetailScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const dismiss = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Close button — floats over hero image */}
      <View style={[styles.closeHeader, { top: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          style={styles.closeButton}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Feather name="chevron-down" size={20} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
      >
        <Image source={{ uri: imageUri }} style={styles.heroImage} />
        {/* Content below image */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  closeHeader: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.4)", // hardcoded
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: "100%",
    height: 250,
  },
});
```

**Critical ScrollView props:** On iOS, ScrollView inside a modal automatically adds content insets for the status bar. Set `contentInsetAdjustmentBehavior="never"` and `automaticallyAdjustContentInsets={false}` to prevent a gap above the hero image.

**When to use:** Detail views, recipe cards, or any screen that slides up over the current content as a full-screen overlay.

**When NOT to use:** Standard modals that benefit from native iOS sheet gestures (drag-to-dismiss detents). Use `presentation: "modal"` or `formSheet` for those.

**Why:** `transparentModal` is the only native-stack presentation that both keeps the previous screen visible (no black/grey background flash) and adds no native chrome (no grabber bars or forced corner radius). The tradeoff is you must handle your own close button and cannot use native swipe-to-dismiss.

**Cross-navigator reuse:** When the same content appears from multiple entry points across different navigators, use a single root-level modal with a type discriminator param. See [Unified Modal with Type Discriminator](#unified-modal-with-type-discriminator).

### fullScreenModal Exception for Camera

Use `presentation: "fullScreenModal"` instead of `transparentModal` for camera/scan screens. `transparentModal` has rendering issues on iOS that cause visual artifacts, and `fullScreenModal`'s black background is acceptable because the camera feed fills the screen immediately.

```typescript
<Stack.Screen
  name="Scan"
  component={ScanScreen}
  options={{
    headerShown: false,
    // fullScreenModal intentional — transparentModal had rendering issues
    presentation: "fullScreenModal",
    animation: "slide_from_bottom",
  }}
/>
```

**When to use:** Camera screens, barcode scanners, or any full-screen view where the content fills the screen with a dark/opaque background.

**When NOT to use:** Detail views or overlays where the previous screen should remain visible underneath. Use `transparentModal` for those.

**Why:** `transparentModal` is the default recommendation for full-screen overlays, but it has rendering issues that cause visual artifacts on some iOS versions. Camera screens don't benefit from transparency anyway since the camera feed is opaque, so `fullScreenModal` is the better choice.

### Dismiss-then-Navigate: Modal to Another Screen

When a button inside a modal needs to open a different screen (not a child of the modal), dismiss the modal first with `goBack()`, then use `InteractionManager.runAfterInteractions()` before navigating. Without this, `navigate()` fires against a stale navigator state mid-animation, causing unpredictable behavior.

```typescript
import { InteractionManager } from "react-native";

const handleOpenScan = useCallback(() => {
  navigation.goBack(); // dismiss modal
  InteractionManager.runAfterInteractions(() => {
    navigation.navigate("Scan"); // navigate after dismissal completes
  });
}, [navigation]);
```

**Do NOT use `navigation.replace()`** for this pattern. `replace` swaps one screen for another in the stack, but modal-to-modal replacement has undefined presentation behavior — the replacement screen's presentation mode (`fullScreenModal` vs `modal`) may conflict with the replaced screen's animation context.

**When to use:** A button inside a modal (Quick Log, settings sheet, etc.) that opens a different root-level screen.

**When NOT to use:** Standard in-stack navigation where `navigate()` or `push()` adds to the current stack.

**References:**

- `client/screens/QuickLogScreen.tsx` — camera button dismisses Quick Log then opens Scan
- `client/screens/meal-plan/RecipeCreateScreen.tsx` — uses `InteractionManager` for bottom sheet transitions

### Two-Tap Expand-then-Navigate for List Items

When list items have both a detail view and contextual actions (favourite, share, delete), use a two-tap interaction: first tap expands an animated action row, second tap navigates to detail. This avoids swipe gestures (which conflict with horizontal scrolling) and long-press (which has poor discoverability). The parent tracks a single `expandedItemId` (not a Set) for accordion behavior -- only one item expands at a time.

**Key insight -- branch on expanded state in the child:**

```typescript
const handlePress = () => {
  if (isExpanded) {
    onNavigateToDetail(item.id); // Second tap: navigate
  } else {
    onToggleExpand(item.id); // First tap: expand actions
  }
};
```

**Key elements:**

1. **Single-selection accordion** -- `expandedItemId` is a single `number | null`, toggled via `setExpandedItemId(prev => prev === itemId ? null : itemId)`
2. **Collapse on refresh** -- reset `setExpandedItemId(null)` in `handleRefresh`
3. **FlatList `extraData`** -- pass `expandedItemId` so FlatList re-renders when expansion state changes
4. **Animated height** -- use `withTiming` on a `useSharedValue` for smooth expand/collapse

**References:**

- `client/screens/HistoryScreen.tsx` -- `handleToggleExpand`, `handleNavigateToDetail`
- `client/components/HistoryItemActions.tsx` -- action button row
- `client/constants/animations.ts:21` -- `expandTimingConfig`, `collapseTimingConfig`

### FAB Overlay with Tab Bar Clearance

When adding a Floating Action Button (FAB) as a sibling to `Tab.Navigator`, use static layout constants instead of `useBottomTabBarHeight()`. The hook requires Tab.Navigator context and crashes when called from a sibling component.

**Layout constants** (defined in `client/constants/theme.ts`):

```typescript
export const TAB_BAR_HEIGHT = Platform.select({ ios: 88, android: 72 }) ?? 88;
export const FAB_SIZE = 56;
export const FAB_CLEARANCE = FAB_SIZE + 16; // FAB size + gap
```

**FAB positioning** (sibling to Tab.Navigator, not a child):

```typescript
// MainTabNavigator.tsx
<View style={{ flex: 1 }}>
  <Tab.Navigator>{/* tabs */}</Tab.Navigator>
  <ScanFAB />  {/* sibling — cannot use useBottomTabBarHeight() here */}
</View>
```

```typescript
// ScanFAB.tsx — position relative to static tab bar height
<AnimatedPressable
  style={[styles.fab, { bottom: TAB_BAR_HEIGHT + Spacing.lg }]}
>
```

**Content clearance** — every tab screen must add `FAB_CLEARANCE` to its bottom padding so scrollable content isn't obscured:

```typescript
import { FAB_CLEARANCE } from "@/constants/theme";

<ScrollView
  contentContainerStyle={{
    paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
  }}
/>
```

**Critical gotcha:** `useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` only works inside components rendered as children of `Tab.Navigator` (tab screens). A FAB rendered as a sibling will crash with "No safe area value available" because the hook depends on Tab.Navigator context that doesn't exist at the sibling level.

**When to use:** Any persistent overlay (FAB, mini-player, banner) positioned above the tab bar but outside the tab navigator's component tree.

**Why:** Static constants are reliable across all component positions. The values must be kept in sync with `Tab.Navigator`'s `tabBarStyle.height` — both reference `TAB_BAR_HEIGHT` from `theme.ts` to ensure a single source of truth.

**No FAB on screens inside tab stacks:** The Scan FAB is rendered at the root level and floats over all tab content. Any screen that adds its own FAB in the same bottom-right position will overlap with the Scan FAB. Use header buttons, inline CTAs, or positioned differently (e.g., top-right) instead of adding a second FAB to screens within tab stacks.

### `useBottomTabBarHeight()` for Tab Screen Bottom Padding

Screens rendered inside a tab navigator must use `useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` for bottom content padding — not `useSafeAreaInsets().bottom`. The tab bar is significantly taller than the safe area inset (88pt vs ~34pt on iPhone with home indicator), so using `insets.bottom` leaves content hidden behind the tab bar.

```typescript
// ✅ GOOD: Correct bottom padding inside tab screens
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { FAB_CLEARANCE, Spacing } from "@/constants/theme";

function MyTabScreen() {
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
      }}
    />
  );
}
```

```typescript
// ❌ BAD: Content hidden behind tab bar
import { useSafeAreaInsets } from "react-native-safe-area-context";

function MyTabScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: insets.bottom + Spacing.xl, // ~34pt — tab bar is 88pt!
      }}
    />
  );
}
```

**When to use:** Any screen rendered as a direct child of `Tab.Navigator` that has scrollable content.

**When NOT to use:** Screens inside modal stacks or root-level stacks that don't have a tab bar. Also cannot be used in FAB siblings — see "FAB Overlay with Tab Bar Clearance" above for that case.

**Why:** `useBottomTabBarHeight()` returns the actual measured tab bar height including safe area padding. `useSafeAreaInsets().bottom` only returns the hardware safe area (home indicator), which is a subset of the tab bar height.

### Unified Create/Edit Screen via Optional Param

Instead of separate `CreateScreen` and `EditScreen` with 90% duplication, use a single screen with an optional ID param. If the ID is present, fetch and pre-populate the form for editing; if absent, render a blank form for creation.

```typescript
// Navigation types
type CookbookFormParams = {
  CookbookForm: { cookbookId?: number };
};

// Single screen handles both create and edit
export default function CookbookFormScreen() {
  const route = useRoute<RouteProp<CookbookFormParams, "CookbookForm">>();
  const cookbookId = route.params?.cookbookId;
  const isEditing = cookbookId != null;

  // Fetch existing data only when editing
  const { data: existing } = useCookbook(cookbookId!, {
    enabled: isEditing,
  });

  // Pre-populate form when data arrives
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
    }
  }, [existing]);

  const handleSave = () => {
    if (isEditing) {
      updateMutation.mutate({ id: cookbookId!, name, description });
    } else {
      createMutation.mutate({ name, description });
    }
  };

  return (
    <View>
      <ThemedText type="title">
        {isEditing ? "Edit Cookbook" : "New Cookbook"}
      </ThemedText>
      {/* Form fields — identical for both modes */}
    </View>
  );
}
```

**When to use:** Any CRUD resource where the create and edit forms share the same fields and layout (cookbooks, recipes, grocery lists, profiles).

**When NOT to use:** When create and edit have substantially different fields, validation rules, or layouts (e.g., onboarding vs profile editing).

**Why:** Eliminates duplication of form state, validation, layout, and styling. Changes to the form only need to happen in one place. The `isEditing` boolean provides a clear branch point for the few differences (title text, save handler, initial data).

### Unified Modal with Type Discriminator

When the same content is displayed from multiple entry points across different navigators, register **one root-level modal** with a type discriminator param instead of maintaining separate screens per navigator. The single screen uses mutually exclusive `useQuery` hooks and a normalization layer to handle different data sources.

```typescript
// RootStackParamList — discriminator param with default
FeaturedRecipeDetail: {
  recipeId: number;
  recipeType?: "community" | "mealPlan";  // defaults to "community"
};
```

```typescript
// Single screen with dual-fetch + normalization
export default function FeaturedRecipeDetailScreen() {
  const { recipeId, recipeType = "community" } = route.params;

  // Only one query fires — mutually exclusive `enabled` flags
  const { data: community, isLoading: communityLoading } = useQuery({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: recipeType === "community",
  });
  const { data: mealPlan, isLoading: mealPlanLoading } = useQuery({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    enabled: recipeType === "mealPlan",
  });

  // Normalize all sources into shared props interface
  const normalized = useMemo((): NormalizedRecipe | null => {
    if (recipeType === "mealPlan" && mealPlan) return normalizeMealPlan(mealPlan);
    if (community) return normalizeCommunity(community);
    return null;
  }, [recipeType, mealPlan, community]);

  // Check only the active query
  const isLoading =
    recipeType === "community" ? communityLoading : mealPlanLoading;

  return (
    <View accessibilityViewIsModal>
      <DragHandle />
      <RecipeDetailContent {...normalized} />
    </View>
  );
}
```

**Reference implementation:** `FeaturedRecipeDetailScreen` — single root modal for all recipe detail views across home carousel, recipe browser, meal plan, cookbooks, and profile.

**Key principles:**

- **Discriminator param with default**: `recipeType` defaults to `"community"` so deep links and existing callers work without changes.
- **Mutually exclusive queries**: Two `useQuery` hooks with opposite `enabled` flags — only the active source fetches. Check `isLoading`/`error` on the active query only, not with OR.
- **Always fetch from API**: The detail screen always fetches the full recipe from the server, ensuring complete data (ingredients, instructions, etc.) is available regardless of the entry point.
- **Normalization in `useMemo`**: A typed interface (e.g., `NormalizedRecipe`) unifies different API shapes. Each source gets its own normalizer function.
- **Shared content component**: The layout lives in a separate `*Content` component (`RecipeDetailContent`) that accepts the normalized interface. The screen handles chrome (drag handle, safe areas), the content component handles layout.
- **Hide missing sections**: Use conditional rendering (`{data && <Section />}`), not placeholders. Different data sources have different fields available.

**When to use:** The same content is shown from 3+ entry points across different navigators and you want uniform UX (same presentation, same dismissal, same chrome).

**When NOT to use:** When screens have genuinely different chrome requirements (e.g., one needs a toolbar with actions, another is read-only). In that case, share a `*Content` component but keep separate screen wrappers.

### Drag Handle for Gesture-Dismissible Modals

When a root-level modal uses `gestureEnabled` + `fullScreenGestureEnabled`, replace interactive close buttons with a visual-only drag handle pill. The navigator handles dismissal — the handle is purely a visual affordance.

```typescript
// Navigator registration
<Stack.Screen
  name="FeaturedRecipeDetail"
  options={{
    presentation: "transparentModal",
    animation: "slide_from_bottom",
    gestureEnabled: true,
    fullScreenGestureEnabled: true, // iOS swipe-right from edge
  }}
/>

// Screen — visual-only drag handle
<View style={styles.handleContainer} pointerEvents="none">
  <View style={[styles.handle, { backgroundColor: withOpacity(theme.text, 0.3) }]} />
</View>

// Styles
handleContainer: { position: "absolute", left: 0, right: 0, zIndex: 10, alignItems: "center" },
handle: { width: 36, height: 5, borderRadius: 2.5 },
```

**Key principles:**

- **`pointerEvents="none"`** on the handle — it is visual-only, not interactive.
- **`fullScreenGestureEnabled`** is iOS-only. Android users dismiss via system back button or swipe-down gesture (both work with `gestureEnabled: true`).
- **ScrollView interaction**: Native stack modal swipe-down only triggers when ScrollView is scrolled to top — no extra gesture conflict handling needed.
- **`accessibilityViewIsModal`** on the root container — VoiceOver users need to know this is a modal.

**Reference implementation:** `RecipeDetailContent` shared by `RecipeDetailScreen` (MealPlan stack) and `FeaturedRecipeDetailScreen` (root modal).

### Coordinated Pull-to-Refresh for Multiple Queries

When a screen fetches data from multiple endpoints, coordinate refresh with `Promise.all`:

```typescript
const {
  data: summaryData,
  refetch: refetchSummary,
} = useQuery<DailySummaryResponse>({
  queryKey: ["/api/daily-summary"],
});

const {
  data: itemsData,
  refetch: refetchItems,
} = useInfiniteQuery<PaginatedResponse<ScannedItemResponse>>({
  queryKey: ["/api/scanned-items"],
});

const [refreshing, setRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    // Refresh all queries in parallel
    await Promise.all([refetchSummary(), refetchItems()]);
  } finally {
    setRefreshing(false);
  }
}, [refetchSummary, refetchItems]);

return (
  <FlatList
    refreshing={refreshing}
    onRefresh={handleRefresh}
    // ...
  />
);
```

**When to use:**

- Dashboard screens with stats + list data
- Profile screens with user info + activity data
- Any screen combining data from multiple API calls

**Why:** Individual `refetch()` calls would cause jarring partial updates. Coordinated refresh ensures the UI updates atomically when all data is ready.

### Safe Area Handling

Always use `useSafeAreaInsets()` for screen layouts:

```typescript
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function MyScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      }}
    >
      {/* Content */}
    </ScrollView>
  );
}
```

**Why:** Handles iOS notch, Dynamic Island, and home indicator. Adding theme spacing (`Spacing.lg`, `Spacing.xl`) provides visual breathing room beyond the safe area.

### useRef for Synchronous Checks in Callbacks

When a callback needs to check mutable state synchronously (e.g., debouncing, rate limiting), use `useRef` instead of state. State values captured in closures become stale:

```typescript
// Good: useRef for synchronous checks
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    // Use ref for synchronous check - always has current value
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    // Process barcode...

    // Debounce: reset after delay
    debounceTimeoutRef.current = setTimeout(() => {
      isScanningRef.current = false;
      setIsScanning(false);
    }, 2000);
  }, []); // Empty deps - refs don't need to be dependencies

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return { isScanning, handleBarcodeScanned };
}
```

```typescript
// Bad: State check in callback - always stale!
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);

  const handleBarcodeScanned = useCallback(
    (barcode: string) => {
      // BUG: isScanning is captured at callback creation time
      // It will always be the initial value (false)
      if (isScanning) return; // This never blocks!

      setIsScanning(true);
      // Process barcode... but rapid scans all get through
    },
    [isScanning],
  ); // Adding dependency recreates callback but doesn't fix the issue
}
```

**Why this happens:** `useCallback` creates a closure that captures state values at creation time. Even with dependencies, the check happens against a potentially outdated snapshot.

**When to use:**

- Debouncing rapid events (barcode scans, button clicks)
- Rate limiting (API calls, animations)
- Any callback that needs to check "am I already processing?"

**Pattern:** Keep both `useState` (for UI rendering) and `useRef` (for synchronous logic) when you need both reactive UI updates and reliable synchronous checks.

---

### Haptic Feedback on User Actions

Provide haptic feedback for meaningful interactions:

```typescript
import * as Haptics from "expo-haptics";

// Light impact for navigation/selection
const handleItemPress = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  navigation.navigate("Detail");
};

// Success notification for completed actions
const handleSave = async () => {
  await saveData();
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

// Error notification for failures
const handleError = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
```

**When to use:** Navigation, successful saves, errors, toggle switches, barcode scan success.

**When NOT to use:** Every tap, scrolling, or high-frequency interactions.

### Accessibility Props Pattern

Provide semantic accessibility information for screen readers (VoiceOver on iOS, TalkBack on Android). This is essential for WCAG 2.1 Level AA compliance.

#### Core Accessibility Props

```typescript
// accessibilityLabel: Descriptive text read by screen readers
// accessibilityRole: Semantic role (button, checkbox, radio, text, header, etc.)
// accessibilityState: Current state (selected, checked, disabled, expanded)
// accessibilityHint: Optional hint about what happens when activated

<Pressable
  accessibilityLabel="Add to favorites"
  accessibilityRole="button"
  accessibilityHint="Saves this item to your favorites list"
  onPress={handleAddToFavorites}
>
  <Feather name="heart" size={24} />
</Pressable>
```

#### Checkbox Pattern (Multi-Select Lists)

Use for lists where users can select multiple items (allergies, health conditions):

```typescript
// Good: Combines title and description for context
<Pressable
  onPress={() => toggleSelection(item.id)}
  accessibilityLabel={`${item.name}: ${item.description}`}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedIds.includes(item.id) }}
>
  <Text>{item.name}</Text>
  <Text>{item.description}</Text>
  <Feather name={isSelected ? "check-square" : "square"} />
</Pressable>
```

**Why combine title and description:** Screen reader users hear the full context in one announcement, rather than having to navigate to separate elements.

#### Radio Pattern (Single-Select Lists)

Use for lists where users select exactly one option (diet type, goals):

```typescript
// Good: Uses radio role with selected state
<Pressable
  onPress={() => setSelectedOption(option.id)}
  accessibilityLabel={`${option.name}: ${option.description}`}
  accessibilityRole="radio"
  accessibilityState={{ selected: selectedOption === option.id }}
>
  <Text>{option.name}</Text>
  <Text>{option.description}</Text>
  <View style={[styles.radioOuter, isSelected && styles.radioSelected]}>
    {isSelected && <View style={styles.radioInner} />}
  </View>
</Pressable>
```

**Difference from checkbox:** Use `accessibilityRole="radio"` with `selected` state (not `checked`). This tells screen readers the selection is mutually exclusive.

#### Icon-Only Button Pattern

Icon buttons without visible text MUST have an `accessibilityLabel`:

```typescript
// Good: Descriptive label for icon button
<Pressable
  onPress={() => navigation.goBack()}
  accessibilityLabel="Go back"
  accessibilityRole="button"
>
  <Feather name="arrow-left" size={24} color={colors.text} />
</Pressable>

// Good: Toggle button with state-aware label
<Pressable
  onPress={() => setTorch(!torch)}
  accessibilityLabel={torch ? "Turn off flashlight" : "Turn on flashlight"}
  accessibilityRole="button"
  accessibilityState={{ checked: torch }}
>
  <Feather name={torch ? "zap" : "zap-off"} size={24} />
</Pressable>
```

**Why state-aware labels:** Users know both the current state AND what will happen when they activate the button.

#### Password Visibility Toggle Pattern

```typescript
<Pressable
  onPress={() => setShowPassword(!showPassword)}
  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
  accessibilityRole="button"
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
>
  <Feather name={showPassword ? "eye-off" : "eye"} size={20} />
</Pressable>
```

#### Decorative Icons Inside Interactive Elements

Icons inside a `Pressable` or `TouchableOpacity` that serve only as visual decoration (leading icons, trailing chevrons, status indicators) must be marked `accessible={false}`. Without this, VoiceOver on iOS announces each icon as a separate focusable element, forcing users to swipe through redundant items.

```typescript
// Good: Decorative icons hidden from screen readers
<Pressable
  onPress={handlePress}
  accessibilityLabel="GLP-1 Companion"
  accessibilityRole="button"
>
  <Feather name="activity" size={20} color={theme.text} accessible={false} />
  <ThemedText>GLP-1 Companion</ThemedText>
  <Feather name="chevron-right" size={16} color={theme.textSecondary} accessible={false} />
</Pressable>

// Bad: Icons are focusable — VoiceOver announces "activity image", then "GLP-1 Companion", then "chevron-right image"
<Pressable onPress={handlePress} accessibilityLabel="GLP-1 Companion">
  <Feather name="activity" size={20} color={theme.text} />
  <ThemedText>GLP-1 Companion</ThemedText>
  <Feather name="chevron-right" size={16} color={theme.textSecondary} />
</Pressable>
```

**When to mark `accessible={false}`:**

- Leading icons in settings rows, list items, action rows
- Trailing chevrons or arrow indicators
- Lock badge icons (the parent `Pressable` already has the accessibility label)
- Status icons next to text that already describes the status
- Emoji or decorative `Image` components inside labeled containers

**When NOT to mark `accessible={false}`:**

- Icon-only buttons with no visible text (these need `accessibilityLabel` instead)
- Icons that convey information not present in the text label (e.g., an error icon when the label doesn't mention the error)

**References:** `client/screens/ProfileScreen.tsx` (SettingsItem), `client/components/home/ActionRow.tsx`, `client/components/HistoryItemActions.tsx`, `client/components/EmptyState.tsx`, `client/components/Toast.tsx`

#### Text Input Pattern

```typescript
<TextInput
  value={username}
  onChangeText={setUsername}
  placeholder="Username"
  accessibilityLabel="Username"
  accessibilityHint="Enter your username to sign in"
  autoCapitalize="none"
  autoCorrect={false}
/>
```

**When to add `accessibilityHint`:** When the purpose isn't obvious from the label alone, or when there are specific requirements (format, length, etc.).

#### List Item Navigation Pattern

For items that navigate to detail screens:

```typescript
// Good: Comprehensive label with action hint
const HistoryItem = React.memo(function HistoryItem({
  item,
  onPress,
}: HistoryItemProps) {
  const calorieText = item.calories ? `${item.calories} calories` : "Calories unknown";

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityLabel={`${item.productName}${item.brandName ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
      accessibilityRole="button"
    >
      <Text>{item.productName}</Text>
      <Text>{item.brandName}</Text>
      <Text>{item.calories} cal</Text>
    </Pressable>
  );
});
```

**Why include "Tap to view details":** Informs users that activation will navigate somewhere, not perform an immediate action.

### Touch Target Size Pattern

Ensure interactive elements meet the minimum touch target size of 44x44 points (WCAG 2.1 Level AA requirement):

```typescript
// Good: Element meets minimum size naturally
<Pressable
  style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
  onPress={handlePress}
>
  <Feather name="settings" size={24} />
</Pressable>

// Good: Small visual element with expanded touch area using hitSlop
<Pressable
  onPress={handlePress}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
  accessibilityLabel="Show password"
>
  <Feather name="eye" size={20} />
</Pressable>
```

**When to use `hitSlop`:**

- Icon buttons smaller than 44pt
- Inline interactive elements (password toggle inside input)
- Dense UIs where visual spacing is constrained

**Calculating hitSlop:** If your touchable is 24pt, add hitSlop of 10pt on each side to reach 44pt total: `(24 + 10 + 10) = 44pt`.

### Accessibility Grouping Pattern

Group related elements so screen readers announce them together:

```typescript
// Good: Card announced as single unit
<View
  accessible={true}
  accessibilityLabel={`${productName}, ${brandName}, ${calories} calories. Scanned ${relativeTime}`}
>
  <Text>{productName}</Text>
  <Text>{brandName}</Text>
  <Text>{calories} cal</Text>
  <Text>{relativeTime}</Text>
</View>
```

**When to use `accessible={true}`:**

- Cards or list items with multiple text elements
- Complex components that should be announced as one unit
- When navigating element-by-element would be tedious

**When NOT to use:** When child elements are independently interactive (buttons, links within the group).

### Radio/Checkbox Group Container Pattern

When rendering lists of radio buttons or checkboxes, wrap them in a container with the appropriate group role:

```typescript
// Good: Radio group with accessibilityRole
<View accessibilityRole="radiogroup">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => setSelected(option.id)}
      accessibilityRole="radio"
      accessibilityState={{ selected: selected === option.id }}
    >
      {/* Radio button content */}
    </Pressable>
  ))}
</View>

// Good: Checkbox group (no special container role needed, but can use "list")
<View accessibilityRole="list">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => toggleOption(option.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selectedIds.includes(option.id) }}
    >
      {/* Checkbox content */}
    </Pressable>
  ))}
</View>
```

**Why:** Screen readers use the `radiogroup` role to understand that only one option can be selected. This provides proper context and navigation behavior for assistive technology users.

**When to use:**

- Single-select option lists (diet type, goals, activity level)
- Any UI where exactly one option must be selected

### Dynamic Accessibility Announcements

Announce important state changes that aren't reflected in focus:

```typescript
import { AccessibilityInfo } from "react-native";

// Announce scan success
const handleBarcodeScanned = async (barcode: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  AccessibilityInfo.announceForAccessibility("Barcode scanned successfully");
  // Process barcode...
};

// Announce errors
const handleError = (message: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  AccessibilityInfo.announceForAccessibility(`Error: ${message}`);
};
```

**When to use:**

- Success/error states after async operations
- Content updates not caused by user navigation
- Timer-based notifications

### useAccessibility Hook Pattern

Centralize accessibility detection with a custom hook that provides reduced motion and screen reader status:

```typescript
// client/hooks/useAccessibility.ts
import { useReducedMotion } from "react-native-reanimated";
import { AccessibilityInfo } from "react-native";
import { useState, useEffect } from "react";

export function useAccessibility() {
  const reducedMotion = useReducedMotion();
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => {
      subscription.remove();
    };
  }, []);

  return {
    reducedMotion: reducedMotion ?? false,
    screenReaderEnabled,
  };
}
```

**Why:** Provides a single source of truth for accessibility settings across the app.

**When to use:**

- Components with animations that should respect reduced motion
- Features that behave differently with screen readers
- Any component needing accessibility context

### Accessibility-Aware Haptics Pattern

Wrap haptic feedback to automatically disable when reduced motion is preferred:

```typescript
// client/hooks/useHaptics.ts
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { useAccessibility } from "./useAccessibility";

export function useHaptics() {
  const { reducedMotion } = useAccessibility();

  const impact = useCallback(
    (
      style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
    ) => {
      if (!reducedMotion) {
        Haptics.impactAsync(style);
      }
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (!reducedMotion) {
        Haptics.notificationAsync(type);
      }
    },
    [reducedMotion],
  );

  const selection = useCallback(() => {
    if (!reducedMotion) {
      Haptics.selectionAsync();
    }
  }, [reducedMotion]);

  return { impact, notification, selection, disabled: reducedMotion };
}
```

**Usage:**

```typescript
const haptics = useHaptics();

const handlePress = () => {
  haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  // ... action
};
```

**Why:** Users who enable reduced motion often want reduced sensory feedback overall. This respects that preference while keeping haptic code unchanged.

### Reduced Motion Animation Pattern

Skip or simplify animations when the user has reduced motion enabled:

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";
import Animated, { FadeInDown } from "react-native-reanimated";

function ListItem({ item, index }: { item: Item; index: number }) {
  const { reducedMotion } = useAccessibility();

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      {/* content */}
    </Animated.View>
  );
}
```

**For press animations:**

```typescript
const handlePressIn = () => {
  if (!reducedMotion) {
    scale.value = withSpring(0.98, pressSpringConfig);
  }
};

const handlePressOut = () => {
  if (!reducedMotion) {
    scale.value = withSpring(1, pressSpringConfig);
  }
};
```

**Why:** WCAG 2.1 requires respecting the "prefers-reduced-motion" setting. This prevents motion sickness and cognitive overload for users who need it.

**For continuous/looping animations:**

Animations that run indefinitely (pulse, shimmer, breathing effects) need a different approach - set a static fallback value instead:

```typescript
const cornerOpacity = useSharedValue(0.6);
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    cornerOpacity.value = 0.8; // Static fallback value
    return; // Skip animation setup entirely
  }

  // Only start continuous animation if reduced motion is disabled
  cornerOpacity.value = withRepeat(
    withSequence(
      withTiming(1, { duration: 1000 }),
      withTiming(0.6, { duration: 1000 }),
    ),
    -1, // Infinite repeat
    true, // Reverse direction
  );
}, [reducedMotion]); // Re-run if preference changes
```

**Key differences from entrance/press animations:**

| Animation Type              | Reduced Motion Approach         |
| --------------------------- | ------------------------------- |
| Entrance (`entering` prop)  | Set to `undefined`              |
| Press (scale on tap)        | Skip `withSpring` call          |
| Continuous (pulse, shimmer) | Set static value + early return |

**When to use:** Pulse effects, shimmer loaders, breathing animations, any `withRepeat` with `-1` (infinite).

### Skeleton Loader Pattern

Create reusable skeleton components with shimmer animation and reduced motion support:

```typescript
// client/components/SkeletonLoader.tsx
export function SkeletonBox({ width, height, borderRadius, style }: SkeletonBoxProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const shimmerValue = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      shimmerValue.value = 0.5; // Static opacity for reduced motion
      return;
    }

    shimmerValue.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      false,
    );

    return () => cancelAnimation(shimmerValue);
  }, [reducedMotion]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmerValue.value, [0, 0.5, 1], [0.3, 0.7, 0.3]),
  }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: theme.backgroundSecondary }, shimmerStyle, style]}
    />
  );
}
```

**Hide skeletons from screen readers:**

```typescript
<FlatList
  ListEmptyComponent={
    isLoading ? (
      <View accessibilityElementsHidden>
        <SkeletonList count={5} />
      </View>
    ) : (
      <EmptyState />
    )
  }
/>
```

**Why:** Screen readers shouldn't announce loading placeholders. `accessibilityElementsHidden` hides the entire subtree from assistive technologies.

**Announce loading for VoiceOver:** Since `accessibilityElementsHidden` makes skeletons invisible to screen readers, add an explicit announcement so users know content is loading:

```typescript
function MySkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <View accessibilityElementsHidden>
      <SkeletonBox width="80%" height={20} />
      {/* ... */}
    </View>
  );
}
```

**FlatList screens — prefer `ListEmptyComponent` over early return:** For screens using `FlatList`, render the skeleton via `ListEmptyComponent` rather than an early-return `if (isLoading)` block. This keeps the `FlatList` mounted so `RefreshControl` works even during initial load:

```typescript
// ✅ Good — FlatList mounts immediately, pull-to-refresh works during load
<FlatList
  data={items}
  ListEmptyComponent={isLoading ? <MySkeleton /> : <EmptyState />}
  refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
/>

// ❌ Avoid — FlatList never mounts during load, no pull-to-refresh
if (isLoading) return <MySkeleton />;
return <FlatList data={items} ... />;
```

**Screen-specific skeletons:** Define skeleton components inline in each screen file (not centralized), matching the screen's actual content layout. Skeletons are tightly coupled to their screen — they change when the layout changes. See `DashboardSkeleton` in `HistoryScreen.tsx` for the established pattern.

**Skeletons trigger on `isLoading` only** (not `isFetching`). TanStack Query's `isLoading` is true only on first load with no cached data. Using `isFetching` would flash the skeleton on every pull-to-refresh or refetch.

### Dynamic Loading State Labels

Update `accessibilityLabel` to reflect loading state for buttons and actions:

```typescript
<Button
  onPress={handleSubmit}
  disabled={isLoading}
  accessibilityLabel={
    isLoading
      ? mode === "login" ? "Signing in" : "Creating account"
      : mode === "login" ? "Sign In" : "Create Account"
  }
>
  {isLoading ? <ActivityIndicator /> : mode === "login" ? "Sign In" : "Create Account"}
</Button>
```

**For loading indicators:**

```typescript
function LoadingFooter() {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading more items"
    >
      <ActivityIndicator size="small" />
    </View>
  );
}
```

**Why:** Screen reader users need to know when an action is in progress. `accessibilityLiveRegion="polite"` announces the content when it appears without interrupting current speech.

### Slider Live SR Feedback Pattern

`@react-native-community/slider` only fires `onSlidingComplete` by default — `accessibilityValue.now` stays stale during the drag gesture, so VoiceOver/TalkBack users hear the committed value, not the live thumb position. Fix with local state driven by `onValueChange`:

```typescript
// accessibilityValue driven by local live state — updated on every frame
const [livePrepTime, setLivePrepTime] = useState(filters.maxPrepTime ?? 0);

// Sync back when parent resets (e.g. "Reset filters" button)
useEffect(() => {
  setLivePrepTime(filters.maxPrepTime ?? 0);
}, [filters.maxPrepTime]);

<Slider
  value={filters.maxPrepTime ?? 0}
  onValueChange={(val) => setLivePrepTime(val)}        // live SR feedback
  onSlidingComplete={(val) => {
    setLivePrepTime(val);                               // keep in sync
    onFiltersChange({ ...filters, maxPrepTime: val > 0 ? val : undefined });
  }}
  accessibilityValue={{
    min: 0, max: 120,
    now: livePrepTime,
    text: livePrepTime > 0 ? `${livePrepTime} minutes` : "Any prep time",
  }}
/>
```

**Key points:**

- `onValueChange` updates local state only (no parent call on every frame — no filter churn)
- `onSlidingComplete` commits to parent AND updates local state (prevents stale value on release)
- `useEffect` syncs local state when committed filter changes externally (e.g. Reset button) — without this the SR text shows the last dragged value even after reset

**References:** `client/components/meal-plan/SearchFilterSheet.tsx`

### Stepper +/− Button accessibilityValue Pattern

Numeric steppers (+/− Pressable pair) should carry `accessibilityValue` on each button so VoiceOver announces the current value after activation. The decorative number text in between should be hidden from the accessibility tree to prevent double-announcement.

```typescript
import { MIN_SERVINGS, MAX_SERVINGS } from "./step-utils";

<Pressable
  onPress={() => handleChange(-1)}
  disabled={atMin}
  accessibilityRole="button"
  accessibilityLabel="Decrease servings"
  accessibilityValue={{
    now: servings,
    min: MIN_SERVINGS,
    max: MAX_SERVINGS,
    text: `${servings} servings`,
  }}
>
  <Feather name="minus" ... />
</Pressable>

{/* Hide from VoiceOver — value is on the buttons */}
<Text
  accessibilityElementsHidden
  importantForAccessibility="no"
>
  {servings}
</Text>

<Pressable
  onPress={() => handleChange(1)}
  accessibilityRole="button"
  accessibilityLabel="Increase servings"
  accessibilityValue={{ now: servings, min: MIN_SERVINGS, max: MAX_SERVINGS, text: `${servings} servings` }}
>
  <Feather name="plus" ... />
</Pressable>
```

**Why `accessibilityElementsHidden` + `importantForAccessibility="no"`:** These are the correct cross-platform RN props for hiding decorative elements from the accessibility tree. `accessibilityElementsHidden` covers iOS VoiceOver; `importantForAccessibility="no"` covers Android TalkBack. Do NOT use `aria-hidden` — it is a web HTML attribute and is silently ignored in React Native.

**References:** `client/components/recipe-wizard/TimeServingsStep.tsx`

### Query Error Retry Pattern

Provide retry functionality for failed data fetching with accessible controls:

```typescript
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ["/api/dietary-profile"],
  // ...
});

// In error UI
{isError && (
  <View style={styles.errorContainer}>
    <ThemedText>Failed to load preferences</ThemedText>
    <Pressable
      onPress={() => refetch()}
      accessibilityLabel="Retry loading dietary preferences"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.retryButton,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name="refresh-cw" size={14} />
      <ThemedText>Retry</ThemedText>
    </Pressable>
  </View>
)}
```

**Why:** Users should always have a way to recover from transient errors without navigating away. The retry button provides an immediate action rather than requiring a pull-to-refresh or screen reload.

### Modal Focus Trapping

Add `accessibilityViewIsModal` to the inner container of all modal components to prevent screen readers from accessing content behind the modal:

```typescript
<Modal visible={visible} transparent animationType="slide">
  <View style={styles.overlay}>
    <KeyboardAvoidingView
      accessibilityViewIsModal   // ← on the inner focusable container
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* modal content */}
    </KeyboardAvoidingView>
  </View>
</Modal>
```

**Why:** Without this prop, VoiceOver/TalkBack can navigate to elements behind the modal overlay, confusing users and breaking the expected focus flow.

**Portal-rendered modals (BottomSheetModal):** `BottomSheetModal` renders via a portal outside the normal component tree. If the parent screen has `accessibilityViewIsModal={true}` on its container and the `<ConfirmationModal />` is a sibling (outside that container), VoiceOver cannot reach the portal-rendered sheet. Place hook-returned modal components **inside** the `accessibilityViewIsModal` container, not as siblings.

### Inline Validation Errors

Use the shared `<InlineError>` component for form validation instead of `Alert.alert()`:

```typescript
import { InlineError } from "@/components/InlineError";

const [error, setError] = useState<string | null>(null);

// Validate on submit
const handleSubmit = () => {
  if (isNaN(value) || value <= 0) {
    setError("Please enter a valid value.");
    return;
  }
  setError(null);
  // proceed...
};

// Clear error on input change
<TextInput onChangeText={(text) => {
  setValue(text);
  if (error) setError(null);
}} />

// Render after input
<InlineError message={error} style={{ marginTop: Spacing.sm }} />
```

**Why:** Inline errors are visible alongside the input, accessible via `accessibilityRole="alert"`, and don't block interaction like `Alert.alert()` does.

### KeyboardAvoidingView Android Behavior

Always use `"height"` for Android, not `undefined`:

```typescript
<KeyboardAvoidingView
  behavior={Platform.OS === "ios" ? "padding" : "height"}
>
```

**Why:** `undefined` on Android causes the keyboard to overlap inputs. `"height"` shrinks the view to fit above the keyboard.

### Keyboard Dismiss on Scroll

Add `keyboardDismissMode` to scrollable views on screens with text inputs:

```typescript
// Form screens — dismiss on drag
<ScrollView keyboardDismissMode="on-drag">

// Chat screens — interactive dismiss (keyboard follows finger)
<FlatList keyboardDismissMode="interactive" />
```

**Why:** Users expect the keyboard to dismiss when scrolling. Without this, they must tap outside the input to dismiss.

### Cross-Platform Live Region Announcements

`accessibilityLiveRegion` is Android-only in React Native. For cross-platform coverage, pair it with `AccessibilityInfo.announceForAccessibility()`:

```typescript
// Android: live region announces automatically
<View accessibilityLiveRegion="polite">
  <ThemedText>{statusText}</ThemedText>
</View>

// iOS: announce via useEffect when state changes
useEffect(() => {
  if (isScanning) {
    AccessibilityInfo.announceForAccessibility("Scanning");
  }
}, [isScanning]);
```

**Why:** `accessibilityLiveRegion` has no effect on iOS. The explicit announcement ensures VoiceOver users get the same feedback as TalkBack users.

### Input Error States with `aria-invalid`

Use `aria-invalid` (not `accessibilityState={{ invalid: true }}`) to mark inputs in an error state:

```tsx
<RNTextInput
  aria-invalid={error ? true : undefined}
  accessibilityHint={
    error && errorMessage
      ? props.accessibilityHint
        ? `${props.accessibilityHint}. ${errorMessage}`
        : errorMessage
      : props.accessibilityHint
  }
  {...props}
/>
```

**Why:** React Native's `AccessibilityState` type does not include `invalid` — using `accessibilityState={{ invalid: true }}` causes a TypeScript error. The `aria-invalid` prop is the correct cross-platform ARIA prop supported since RN 0.71.

**Hint preservation:** When an error occurs, append the error message to the caller-supplied `accessibilityHint` rather than replacing it. Replacing it silently discards the caller's hint (e.g., "Enter a valid email address"). Appending with `. ` preserves both: VoiceOver/TalkBack reads the original hint then the error detail.

**References:**

- `client/components/TextInput.tsx` — shared input component with error state

### `role` Prop for Unsupported ARIA Roles

When `accessibilityRole` doesn't support a needed value (like `"group"`), use the `role` prop instead:

```tsx
// Bad: "group" is not in accessibilityRole's type union — TS error
<View accessibilityRole="group" accessibilityLabel="Side effects">

// Good: role prop supports all ARIA roles (RN 0.73+)
<View role="group" accessibilityLabel="Side effects">
```

**When to use:** ARIA roles not in `accessibilityRole`'s type union: `"group"`, `"list"`, `"listitem"`, `"form"`, etc.

**When NOT to use:** Roles that `accessibilityRole` already supports (`"button"`, `"radiogroup"`, `"checkbox"`, `"alert"`, etc.) — prefer `accessibilityRole` for consistency with the rest of the codebase.

**References:**

- `client/screens/GLP1CompanionScreen.tsx` — `role="group"` on checkbox group container

### Cancel Running Animations on `reducedMotion` Change

When `reducedMotion` toggles at runtime (user enables Reduce Motion while the app is open), actively cancel running `withRepeat` animations and reset shared values:

```tsx
const dot1 = useSharedValue(0);
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(dot1);
    dot1.value = 0; // Reset to rest position
    return;
  }
  dot1.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
}, [dot1, reducedMotion]);
```

**Why:** Simply returning early from the effect doesn't stop already-running `withRepeat` animations. The shared values continue animating on the UI thread. `cancelAnimation()` explicitly stops them, and resetting to 0 (or 1, depending on the rest state) ensures a clean visual state.

**When to use:** Any `useEffect` that starts `withRepeat` or continuous animations conditionally on `reducedMotion`.

**When NOT to use:** One-shot entrance animations using the `entering` prop (these are handled by passing `undefined` when `reducedMotion` is true).

**References:**

- `client/components/ChatBubble.tsx` — typing indicator dots
- `client/components/VoiceLogButton.tsx` — recording pulse

### Ref Guard for One-Shot Effects

When a `useEffect` should fire a side effect exactly once per boolean transition (e.g., show a toast when an error flag becomes `true`), use a ref to prevent duplicate firings. Without the guard, the effect re-runs whenever any dependency in the array changes — even if the triggering boolean hasn't toggled.

```tsx
// client/screens/ChatScreen.tsx — one-shot toast on stream error
const shownStreamErrorRef = useRef(false);

useEffect(() => {
  if (streamError && !shownStreamErrorRef.current) {
    shownStreamErrorRef.current = true;
    toast.error("Response was interrupted.");
  }
  if (!streamError) {
    shownStreamErrorRef.current = false;
  }
}, [streamError, toast]);
```

**Why:** React's `useEffect` fires whenever any value in the dependency array changes reference. If `toast` gets a new reference (e.g., context provider re-renders) while `streamError` is still `true`, the effect body runs again — showing a duplicate toast. The ref tracks whether the side effect has already been dispatched for the current `true` cycle and resets when the flag returns to `false`.

**When to use:**

- Showing a toast or alert in response to a boolean error/success flag
- Triggering a one-time analytics event when a state condition is met
- Any `useEffect` where a side effect should fire once per `false → true` transition, not on every re-render while the value remains `true`

**When NOT to use:**

- Effects that should legitimately re-run on every dependency change (e.g., updating derived state)
- Effects gated on values that naturally reset immediately (no window for duplicate fires)

**References:**

- `client/screens/ChatScreen.tsx` — stream error toast with `shownStreamErrorRef`

### WCAG Color Contrast

Light mode color tokens must maintain at least 4.5:1 contrast ratio against white backgrounds (WCAG 2.1 AA). Current compliant values:

| Token                           | Value     | Ratio  |
| ------------------------------- | --------- | ------ |
| `textSecondary`                 | `#717171` | ~4.5:1 |
| `success` / `proteinAccent`     | `#008A38` | ~4.6:1 |
| `calorieAccent` / `carbsAccent` | `#C94E1A` | ~4.6:1 |
| `fatAccent`                     | `#8C6800` | ~5.1:1 |

When adding new color tokens, verify contrast at [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) before committing.

### Multi-Section Accordion with Set State

When multiple sections can be independently expanded/collapsed (unlike single-selection accordions that use `number | null`), use a `Set` for the expanded state. Initialize with a default via a factory function.

```tsx
// client/screens/meal-plan/MealPlanHomeScreen.tsx
const [expandedSections, setExpandedSections] = useState<Set<MealType>>(
  () => new Set([getAutoExpandedMealType()]),
);

const handleToggleSection = useCallback(
  (mealType: MealType) => {
    haptics.impact(ImpactFeedbackStyle.Light);
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(mealType)) {
        next.delete(mealType);
      } else {
        next.add(mealType);
      }
      return next;
    });
  },
  [haptics],
);
```

**When to use:** Any multi-section layout where users should be able to have multiple sections open simultaneously (e.g., meal sections, settings groups).

**When NOT to use:** Single-selection accordions (FAQ, detail panels) — use `string | null` state instead.

**Key elements:**

- `useState<Set<T>>` with factory initializer `() => new Set([default])`
- Functional updater in toggle to avoid stale closures
- `getAutoExpandedMealType()` auto-selects the contextually relevant section (time-of-day)
- Section receives `isExpanded` boolean and `onToggle` callback

**References:**

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — meal section expand/collapse
- `client/screens/meal-plan/meal-plan-utils.ts` — `getAutoExpandedMealType()`

### Measure-Then-Animate Collapsible Height

For collapsible sections where content height is dynamic, measure via `onLayout` and animate between 0 and the measured height. Use a sentinel value (`-1`) to switch to `"auto"` after expand completes, so content reflows naturally.

```tsx
// client/screens/meal-plan/MealPlanHomeScreen.tsx — MealSlotSection
const contentHeight = useRef(0);
const animHeight = useSharedValue(isExpanded ? -1 : 0);

// Measure content
const handleContentLayout = useCallback((e: LayoutChangeEvent) => {
  contentHeight.current = e.nativeEvent.layout.height;
}, []);

// Toggle animation
useEffect(() => {
  if (reducedMotion) {
    animHeight.value = isExpanded ? -1 : 0;
    return;
  }
  if (isExpanded) {
    animHeight.value = withTiming(
      contentHeight.current || 200,
      expandTimingConfig,
      () => {
        animHeight.value = -1;
      }, // Switch to auto after animation
    );
  } else {
    if (animHeight.value === -1) {
      animHeight.value = contentHeight.current || 200;
    }
    animHeight.value = withTiming(0, collapseTimingConfig);
  }
}, [isExpanded, reducedMotion]);

const animStyle = useAnimatedStyle(() => ({
  height: animHeight.value === -1 ? "auto" : animHeight.value,
  overflow: animHeight.value === -1 ? "visible" : "hidden",
}));
```

**Why:** Fixed-height animations clip content when items are added/removed. The `-1` sentinel means "use auto height" so the container can grow naturally between user interactions.

**When to use:** Any collapsible section with dynamic-length content (lists, forms).

**Key elements:**

- `onLayout` measures natural height into a `ref` (not state, to avoid re-renders)
- Animate to measured height, then switch to `auto` via `-1` sentinel in `withTiming` callback
- On collapse: snapshot current height before animating to 0
- Respect `reducedMotion` by setting final value instantly

**References:**

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — `MealSlotSection` collapsible

### Return-to-Origin Navigation Flow

When a creation/import flow is triggered from an inline context (e.g., a bottom sheet), pass a `returnTo` param so the destination screen can auto-add the result and `popToTop()` back to the origin.

```tsx
// 1. Define the param in the navigator
type MealPlanStackParamList = {
  RecipeCreate: {
    returnToMealPlan?: { mealType: string; plannedDate: string };
  };
};

// 2. Pass it from the trigger (QuickAddSheet footer)
onNavigateCreate(mealType, plannedDate);
// → navigation.navigate("RecipeCreate", {
//     returnToMealPlan: { mealType, plannedDate },
//   });

// 3. Consume in the destination screen
const returnToMealPlan = route.params?.returnToMealPlan;

const handleSave = async () => {
  const newRecipe = await createMutation.mutateAsync(payload);
  if (returnToMealPlan) {
    await addItemMutation.mutateAsync({
      recipeId: newRecipe.id,
      mealType: returnToMealPlan.mealType,
      plannedDate: returnToMealPlan.plannedDate,
    });
    navigation.popToTop(); // Back to origin
  } else {
    navigation.goBack(); // Normal flow
  }
};
```

**When to use:** Any flow where a screen can be reached from multiple contexts and should return differently based on origin (inline add vs standalone browse).

**Key elements:**

- Optional `returnTo` route param with the data needed to complete the action
- Destination screen auto-performs the follow-up action (add to plan) on success
- `popToTop()` instead of `goBack()` to clear the entire sub-stack
- Both paths share the same save logic — only post-save behavior differs

**References:**

- `client/screens/meal-plan/RecipeCreateScreen.tsx` — auto-add + `popToTop` when `returnToMealPlan` set
- `client/screens/meal-plan/RecipeImportScreen.tsx` — same pattern
- `client/components/meal-plan/QuickAddSheet.tsx` — passes `returnToMealPlan` via footer buttons

### Inline Quick-Add Bottom Sheet

For lightweight add flows, use a `BottomSheetModal` with search + tap-to-add instead of navigating to a full-screen browser. This keeps the user's context visible and reduces navigation depth.

```tsx
// client/components/meal-plan/QuickAddSheet.tsx
interface QuickAddSheetProps {
  mealType: MealType | null; // null = sheet is closed
  plannedDate: string;
  onDismiss: () => void;
  onNavigateCreate: (mealType: MealType, plannedDate: string) => void;
  onNavigateImport: (mealType: MealType, plannedDate: string) => void;
}

// Parent state controls visibility
const [quickAddMealType, setQuickAddMealType] = useState<MealType | null>(null);

// Open: set meal type (sheet reads it in useEffect and calls .present())
const handleAddItem = (mealType: MealType) => setQuickAddMealType(mealType);

// Close: clear meal type
const handleDismiss = () => setQuickAddMealType(null);
```

**Key elements:**

- `mealType: null` = closed, non-null = open for that type. Sheet calls `present()`/`dismiss()` in a `useEffect` on `mealType`.
- Debounced search (300ms) with `useUnifiedRecipes()` — shows personal recipes by default, combined results when searching
- Tap anywhere on a result row → `addItemMutation` + dismiss (no confirm step)
- Footer actions navigate to full create/import screens with `returnToMealPlan` param
- `BottomSheetFlatList` + `BottomSheetTextInput` for proper scroll/keyboard handling inside sheets

**References:**

- `client/components/meal-plan/QuickAddSheet.tsx` — full implementation
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — integration with `quickAddMealType` state

### Async Mutation Double-Tap Guard

For mutation handlers in bottom sheets or modals where rapid taps can fire duplicate requests, use a `useRef(false)` guard instead of relying on button `disabled` state (which may not update fast enough).

```tsx
// client/components/meal-plan/QuickAddSheet.tsx
const isAdding = useRef(false);

const handleAdd = useCallback(
  async (recipe: RecipeRow) => {
    if (!mealType || isAdding.current) return;
    isAdding.current = true;
    haptics.impact(ImpactFeedbackStyle.Light);
    try {
      await addItemMutation.mutateAsync({
        recipeId: recipe.id,
        plannedDate,
        mealType,
      });
      haptics.notification(NotificationFeedbackType.Success);
      onDismiss();
    } catch {
      // Mutation errors handled by React Query
    } finally {
      isAdding.current = false;
    }
  },
  [mealType, plannedDate, haptics, addItemMutation, onDismiss],
);
```

**Why:** `disabled` prop relies on a state update → re-render cycle, which can lag behind rapid taps. A ref check is synchronous and prevents the second tap from ever entering the async path.

**When to use:**

- Tap-to-add in lists/sheets where each row triggers a mutation
- Any `mutateAsync` handler without a loading spinner that disables the trigger

**When NOT to use:**

- Buttons that already show a loading state and are properly `disabled` during mutation
- Forms with a single submit button (use `isPending` from mutation)

**References:**

- `client/components/meal-plan/QuickAddSheet.tsx` — `isAdding` ref guard on recipe add

### Config-Driven Screen Rendering

When a screen displays a list of actions, items, or sections that map to navigation targets, define the items as a typed config array in a separate file and render by mapping over the array. Keep navigation logic in a single `navigateAction()` function co-located with the config so any consumer can reuse the same targets.

```typescript
// client/components/home/action-config.ts

export interface HomeAction {
  id: string;
  group: "scanning" | "nutrition" | "recipes" | "planning";
  icon: string;
  label: string;
  subtitle?: string;
  premium?: boolean;
}

/** Single source of truth for navigation targets */
export function navigateAction(
  action: HomeAction,
  navigation: HomeScreenNavigationProp,
) {
  switch (action.id) {
    case "scan-barcode":
      navigation.navigate("Scan");
      break;
    case "quick-log":
      navigation.navigate("QuickLog");
      break;
    // ... all other actions
  }
}

export const HOME_ACTIONS: HomeAction[] = [
  {
    id: "scan-barcode",
    group: "scanning",
    icon: "maximize",
    label: "Scan Barcode",
  },
  { id: "quick-log", group: "nutrition", icon: "edit-3", label: "Quick Log" },
  {
    id: "search-recipes",
    group: "recipes",
    icon: "search",
    label: "Search Recipes",
    subtitle: "Browse the recipe catalog",
  },
  // ... all 16 actions
];

export function getActionsByGroup(group: HomeAction["group"]): HomeAction[] {
  return HOME_ACTIONS.filter((a) => a.group === group);
}
```

```typescript
// client/screens/HomeScreen.tsx — renders sections by mapping over config

const SECTIONS: { key: SectionKey; title: string; delay: number }[] = [
  { key: "scanning", title: "Camera & Scanning", delay: 150 },
  { key: "nutrition", title: "Nutrition & Health", delay: 200 },
  { key: "recipes", title: "Recipes", delay: 250 },
  { key: "planning", title: "Planning", delay: 300 },
];

// In JSX — no per-section component duplication
{SECTIONS.map(({ key, title, delay }) => (
  <Animated.View key={key} entering={reducedMotion ? undefined : FadeInDown.delay(delay).duration(400)}>
    <CollapsibleSection title={title} isExpanded={sections[key]} onToggle={() => toggleSection(key)}>
      {getActionsByGroup(key).map((action) => (
        <ActionRow
          key={action.id}
          icon={action.icon}
          label={action.label}
          subtitle={action.subtitle}
          onPress={() => handleActionPress(action)}
          isLocked={action.premium && !isPremium}
        />
      ))}
    </CollapsibleSection>
  </Animated.View>
))}
```

```typescript
// client/components/ScanFAB.tsx — reuses the same config + navigateAction

import {
  getActionsByGroup,
  navigateAction,
} from "@/components/home/action-config";

const scanningActions = getActionsByGroup("scanning");

const speedDialActions = useMemo(
  () =>
    scanningActions.map((action) => ({
      icon: action.icon,
      label: action.label,
      onPress: () => {
        closeMenu();
        navigateAction(action, navigation);
      },
    })),
  [closeMenu, haptics, navigation],
);
```

**Key elements:**

1. **Config array is the single source of truth** — adding a new action is one object in the array + one case in `navigateAction()`. No template changes needed.
2. **`navigateAction()` centralizes all navigation** — both HomeScreen and ScanFAB call it, preventing divergent navigation targets for the same action.
3. **Group filtering** — `getActionsByGroup()` lets different consumers show subsets without duplicating the list.
4. **Optional props drive visual variants** — `subtitle` presence switches ActionRow from plain row to card style, avoiding a second component.
5. **Section metadata as config** — the `SECTIONS` array in HomeScreen defines section keys, titles, and animation delays, eliminating per-section JSX blocks.

**When to use:**

- Screens with repeated action items, settings rows, or menu entries that navigate to different destinations
- When multiple UI surfaces (screen, FAB, drawer) need to share the same set of navigation targets
- Hub/dashboard screens where the item list is likely to grow

**When NOT to use:**

- Screens with 2-3 hardcoded actions that are unlikely to change (config overhead exceeds benefit)
- Highly heterogeneous layouts where each item has unique rendering logic that cannot be parameterized

**References:**

- `client/components/home/action-config.ts` — config array + `navigateAction()`
- `client/screens/HomeScreen.tsx` — config-driven section rendering
- `client/components/ScanFAB.tsx` — reuses config for speed dial menu

### Typed Navigation Dispatch from AI-Generated Actions

When AI-generated blocks contain navigation actions with dynamically determined screen names (validated by Zod), use a `switch` on literal screen names at the call site. This gives TypeScript proper param type narrowing per screen while keeping the navigation object fully typed. Never cast the navigation object itself to bypass typed navigation.

```typescript
// ❌ BAD: Casts away the entire navigation type
(
  navigation as {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  }
).navigate(screen, params);
```

```typescript
// ✅ GOOD: Literal screen names give TypeScript per-screen param narrowing
const screen = action.screen as string; // Zod-validated to NAVIGABLE_SCREENS
const params = action.params as Record<string, unknown> | undefined;

switch (screen) {
  case "FeaturedRecipeDetail":
    navigation.navigate(
      "FeaturedRecipeDetail",
      params as RootStackParamList["FeaturedRecipeDetail"],
    );
    break;
  case "RecipeBrowserModal":
    navigation.navigate(
      "RecipeBrowserModal",
      params as RootStackParamList["RecipeBrowserModal"],
    );
    break;
  case "QuickLog":
    navigation.navigate("QuickLog"); // no params needed
    break;
  // ... one case per NAVIGABLE_SCREEN
}
```

**Key elements:**

1. **Literal screen name in each `case`** — TypeScript narrows the second arg to the correct param type
2. **`params as RootStackParamList[Screen]`** — acceptable boundary cast since Zod validated upstream via `NAVIGABLE_SCREENS` enum
3. **No-param screens omit the second arg** — cleaner than passing `undefined`
4. **Adding a new navigable screen** requires adding it to both the `NAVIGABLE_SCREENS` Zod enum and a new `case` branch

**When to use:**

- Handling AI-generated navigation actions where the screen name comes from validated but dynamic data
- Any context where a Zod-validated screen name must be dispatched through typed React Navigation

**When NOT to use:**

- Static navigation (hardcoded screen names) — just call `navigation.navigate("Screen", params)` directly
- Config-driven navigation with a `navigateAction()` helper — use the "Config-Driven Screen Rendering" pattern above instead

**Why:** `navigation.navigate(variable, params)` with a `string` variable forces TypeScript to accept any params shape (or none). With a literal `"FeaturedRecipeDetail"`, TypeScript requires `params` to match `{ recipeId: number; ... }`. The switch ensures each screen gets its correct param constraint while the Zod enum upstream ensures only allowlisted screens reach this code.

**References:**

- `client/components/coach/CoachChat.tsx` — `handleBlockAction` switch dispatch
- `shared/schemas/coach-blocks.ts` — `NAVIGABLE_SCREENS` Zod enum + `navigateActionSchema`
- "Whitelist AI-Generated Navigation Targets" pattern in `docs/patterns/security.md` — the validation side of this pattern

**Origin:** Coach Pro code review (2026-04-10) — navigation type cast flagged as Important finding

### Progressive Disclosure via Usage Counting

Transition UI elements from verbose (icon + label) to compact (icon-only) after the user has interacted with them enough times to learn what they mean. Track per-element usage counts in AsyncStorage with an in-memory cache, and apply a threshold to conditionally hide labels.

```typescript
// 1. Storage layer (home-actions-storage.ts) — same cache pattern as other storage
const USAGE_COUNTS_KEY = "@ocrecipes_action_usage_counts";
let usageCountsCache: Record<string, number> | null = null;

export function getActionUsageCounts(): Record<string, number> {
  return usageCountsCache ?? {};
}

export async function incrementActionUsage(actionId: string): Promise<void> {
  const counts = getActionUsageCounts();
  const updated = { ...counts, [actionId]: (counts[actionId] ?? 0) + 1 };
  usageCountsCache = updated;
  await AsyncStorage.setItem(USAGE_COUNTS_KEY, JSON.stringify(updated));
}

// 2. Component layer — threshold-based rendering
const ICON_ONLY_THRESHOLD = 5;

function ActionChip({ action, usageCounts }: Props) {
  const iconOnly = (usageCounts[action.id] ?? 0) >= ICON_ONLY_THRESHOLD;

  return (
    <Pressable accessibilityLabel={action.label}>
      <Feather name={action.icon} size={iconOnly ? 16 : 14} />
      {!iconOnly && <ThemedText>{action.label}</ThemedText>}
    </Pressable>
  );
}
```

**Key requirements:**

- Always keep `accessibilityLabel` on icon-only elements for screen readers
- Bump icon size slightly when removing label to maintain visual weight
- Use a low threshold (5-10) so the transition happens naturally during normal use

**When to use:**

- Repeated-action toolbars or shortcut rows where space is limited
- Any UI where familiarity reduces the need for text labels

**When NOT to use:**

- Primary navigation (tabs should always show labels)
- Destructive or infrequent actions where clarity matters more than space
- Actions where icons are ambiguous without labels

**References:**

- `client/components/home/RecentActionsRow.tsx` — `ICON_ONLY_THRESHOLD`, conditional label rendering
- `client/lib/home-actions-storage.ts` — `usageCountsCache`, `incrementActionUsage()`
- `client/hooks/useHomeActions.ts` — exposes `usageCounts` to components

### Async Operation with Timeout Fallback + Race Condition Guard

When an async operation (API call) has a timeout fallback (navigate away), guard against the API response arriving after the timeout fires:

```typescript
const isProcessingRef = useRef(false);
const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleAsyncWithFallback = async (data: string) => {
  if (isProcessingRef.current) return; // Prevent duplicate calls
  isProcessingRef.current = true;

  // Timeout → fallback navigation
  timeoutRef.current = setTimeout(() => {
    isProcessingRef.current = false;
    navigation.navigate("Fallback");
  }, 10000);

  try {
    const result = await apiCall(data);

    // Clear timeout (no-op if already fired)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // CRITICAL: bail out if timeout already fired and navigated
    if (!isProcessingRef.current) return;

    // ... handle result (navigate, set state)
  } catch {
    isProcessingRef.current = false;
    navigation.navigate("Fallback");
  }
};
```

**Key details:**

- `useRef` (not `useState`) for the guard — synchronous reads, no re-render needed
- `clearTimeout` on an already-fired timer is a no-op — it does NOT tell you the timer ran
- The `if (!isProcessingRef.current) return` guard is the critical line that prevents double navigation
- Always clean up timeout refs in a `useEffect` cleanup function

**Why this matters:** Without the guard, if the API responds after the 10s timeout, both the timeout handler AND the success handler navigate — causing a double navigation crash or confusing UX.

**References:**

- `client/screens/ScanScreen.tsx` -- `handleSmartScan()` with classification timeout fallback
- Bug found and fixed during PR #14 code review

### SVG Elements Are Invisible to the Accessibility Tree

`react-native-svg` inner elements (`<G>`, `<Line>`, `<Circle>`, `<Text>`) silently ignore `accessible`, `accessibilityLabel`, and `accessibilityRole` props. Screen readers cannot focus on individual SVG elements — the entire SVG renders as a single drawing surface.

```typescript
// ❌ BAD: These props are silently ignored
<G accessible accessibilityLabel="12 hour milestone, reached">
  <Line ... />
  <SvgText>12h</SvgText>
</G>

// ✅ GOOD: Provide a summary label on the wrapping View
<View
  accessibilityLabel={`Timer: ${timeDisplay}. Milestones: 2 of 4 reached`}
  accessibilityRole="timer"
>
  <Svg width={size} height={size}>
    {/* SVG elements are purely visual */}
  </Svg>
</View>
```

**Rule:** Never put accessibility props on SVG child elements. Always provide an accessible summary on the parent `View` that conveys the same information visually encoded in the SVG.

**References:**

- `client/components/FastingTimer.tsx` — milestone markers with summary label on wrapping View
- Discovered during PR #25 accessibility review

### accessibilityLiveRegion on Frequently Updating Content

`accessibilityLiveRegion="polite"` on Android triggers a TalkBack announcement **every time the content changes**. On a View that updates every 30 seconds (e.g., a countdown timer), this produces constant screen reader interruptions.

```typescript
// ❌ BAD: Announces every 30-second countdown update
<View accessibilityLiveRegion="polite">
  <Text>Next phase in {formatDuration(remaining)}</Text>
</View>

// ✅ GOOD: Announce only on meaningful discrete events
const prevPhaseRef = useRef<string | null>(null);
useEffect(() => {
  if (currentPhase.name !== prevPhaseRef.current) {
    prevPhaseRef.current = currentPhase.name;
    AccessibilityInfo.announceForAccessibility(
      `You've entered the ${currentPhase.name} phase`,
    );
  }
}, [currentPhase.name]);
```

**Rule:** Use `accessibilityLiveRegion` only on content that changes infrequently (e.g., error messages, status changes). For timer/countdown UIs, use `AccessibilityInfo.announceForAccessibility()` triggered by discrete state transitions, not continuous updates.

**References:**

- `client/screens/FastingScreen.tsx` — phase transition announcements via effect, not live region
- Discovered during PR #25 performance + accessibility review

### Native Text Overlay on react-native-svg Requires Explicit z-ordering

When overlaying a native `View` with `Text` on top of an `<Svg>` element (e.g., center text inside a circular progress ring), the SVG's native view can obscure the text even though the `View` appears later in the component tree. This is because `react-native-svg` creates a native drawing surface that may not respect React Native's default sibling z-ordering.

```typescript
// ❌ BAD: Text may be hidden behind the SVG native layer
<View style={{ width: 280, height: 280 }}>
  <Svg width={280} height={280}>
    <Circle ... />
  </Svg>
  <View style={StyleSheet.absoluteFillObject}>
    <Text style={{ fontSize: 36 }}>09:55</Text>
  </View>
</View>

// ✅ GOOD: Force text above SVG with zIndex + prevent container clipping
<View style={{ width: 280, height: 280, overflow: "visible" }}>
  <Svg width={280} height={280}>
    <Circle ... />
  </Svg>
  <View style={[StyleSheet.absoluteFillObject, { zIndex: 1 }]}>
    <Text style={{ fontSize: 36, lineHeight: 46 }}>09:55</Text>
  </View>
</View>
```

Three things to get right:

1. **`zIndex: 1`** on the text overlay — forces it above the SVG native layer
2. **`overflow: "visible"`** on the container — prevents parent clipping from cutting off text
3. **Explicit `lineHeight`** for large custom fonts — Poppins and similar fonts have ascenders that extend beyond the default line height at large sizes, causing clipping

**References:**

- `client/components/FastingTimer.tsx` — time display overlay on SVG circular progress ring
- Discovered during PR #25 physical device testing

### Error Feedback: toast.error + Haptics

For transient error states (failed API calls, network issues), use `toast.error()` with error haptics. Never use `Alert.alert("Error", ...)` for non-interactive error feedback — it blocks the UI and requires a tap to dismiss.

```typescript
// ✅ GOOD — non-blocking, auto-dismisses, physical feedback
haptics.notification(Haptics.NotificationFeedbackType.Error);
toast.error("Failed to save recipe. Please try again.");

// ❌ BAD — blocks UI, no haptic feedback, inconsistent styling
Alert.alert("Error", "Failed to save recipe. Please try again.");
```

**When to use Alert.alert:** Only for destructive confirmations that need explicit user consent (delete, discard, end fast). These require Cancel/Confirm buttons.

**References:**

- `client/screens/FastingScreen.tsx` — error haptics on mutation failure
- `client/screens/CookSessionReviewScreen.tsx` — 3 mutation error paths
- `client/screens/ChatListScreen.tsx` — conversation creation error

### Toast with Action Button (Undo)

The Toast system supports an optional action button for recoverable operations. Pass `action: { label, onPress }` to any toast method. Auto-dismiss extends from 3s to 5s when an action is present. iOS VoiceOver announces the action availability.

```typescript
const toast = useToast();

// After a destructive action that can be undone:
toast.success("Item removed", {
  action: { label: "Undo", onPress: () => restoreItem(itemId) },
});
```

**References:**

- `client/components/Toast.tsx` — action button rendering, 5s dismiss
- `client/components/toast-utils.ts` — `ToastAction` interface
- `client/context/ToastContext.tsx` — `ToastOptions` with action support

### Pull-to-Refresh Completion Haptics

Add a light haptic impact when pull-to-refresh completes so users know data has finished loading:

```typescript
// For screens using refetch directly:
<RefreshControl
  refreshing={isRefetching}
  onRefresh={() => refetch().then(() => haptics.impact())}
/>

// For screens with custom handleRefresh:
const handleRefresh = useCallback(async () => {
  await Promise.all([refetchA(), refetchB()]);
  haptics.impact(); // Light tap on completion
}, [refetchA, refetchB, haptics]);
```

`haptics.impact()` defaults to `ImpactFeedbackStyle.Medium` — a subtle confirmation without being jarring.

**References:**

- All 9 refreshable screens: HomeScreen, SavedItemsScreen, HistoryScreen, MealPlanHomeScreen, FastingScreen, ChatListScreen, GroceryListScreen, PantryScreen, GLP1CompanionScreen

### navigate() vs replace() in Modal Flows

Use `navigation.replace()` instead of `navigate()` when the current modal step is "done" and going back to it makes no sense. This prevents deep modal stacking.

```typescript
// ✅ GOOD — capture is done, move to review (back skips capture)
navigation.replace("CookSessionReview", { sessionId });

// ❌ BAD — stacks review on top of capture (back returns to capture)
navigation.navigate("CookSessionReview", { sessionId });
```

**When to use `replace()`:** Sequential flows where each step consumes the previous (Capture→Review, Scan→Summary, Review→Result).

**When to keep `navigate()`:** Flows where the user might want to go back and retry (Scan→PhotoIntent, PhotoIntent→PhotoAnalysis — user might want to re-scan or pick a different intent).

**References:**

- `client/screens/ReceiptCaptureScreen.tsx` → ReceiptReview
- `client/screens/CookSessionCaptureScreen.tsx` → CookSessionReview
- `client/screens/CookSessionReviewScreen.tsx` → SubstitutionResult
- `client/screens/BatchScanScreen.tsx` → BatchSummary
- Existing correct usage: `FrontLabelConfirmScreen`, `LabelAnalysisScreen`, `ReceiptReviewScreen`

### enableDynamicSizing for Minimal-Content Sheets

When a bottom sheet contains minimal content (confirmation dialogs, single-action prompts, ~200px of content), use `enableDynamicSizing={true}` with `maxDynamicContentSize` instead of fixed `snapPoints`. Fixed percentage snap points (e.g., `["45%"]`) leave excessive empty space below short content.

```typescript
// ✅ GOOD — sheet sizes to content, capped at 350px
<BottomSheetModal
  ref={sheetRef}
  enableDynamicSizing={true}
  maxDynamicContentSize={350}
>
  <BottomSheetView>  {/* Required wrapper for dynamic sizing */}
    <ThemedText>Are you sure?</ThemedText>
    <Pressable onPress={handleConfirm}>
      <ThemedText>Confirm</ThemedText>
    </Pressable>
  </BottomSheetView>
</BottomSheetModal>

// ❌ BAD — 45% of screen for 200px of content
<BottomSheetModal
  ref={sheetRef}
  snapPoints={["45%"]}
  enableDynamicSizing={false}
>
  <View>
    <ThemedText>Are you sure?</ThemedText>
    <Pressable onPress={handleConfirm}>
      <ThemedText>Confirm</ThemedText>
    </Pressable>
  </View>
</BottomSheetModal>
```

**Key elements:**

1. **`enableDynamicSizing={true}`** — sheet measures content and sizes accordingly
2. **`maxDynamicContentSize={350}`** — prevents the sheet from growing too tall on content-heavy renders
3. **`<BottomSheetView>` wrapper** — required for dynamic sizing (plain `<View>` won't measure correctly)
4. **Omit `snapPoints`** — dynamic sizing and snap points are mutually exclusive

**When to use:** Confirmation dialogs, single-action prompts, short forms with 1-3 fields.

**When NOT to use:** Multi-section sheets with scrollable content — use fixed `snapPoints` with `BottomSheetScrollView` instead.

**References:**

- `client/hooks/useConfirmationModal.ts` — dynamically-sized confirmation sheet
- Existing fixed-snap-point sheets: `RecipeCreateScreen`, `GroceryListScreen`

### beforeRemove Navigation Guard with Bottom Sheet

When migrating `Alert.alert` inside `beforeRemove` navigation listeners to bottom sheets, capture the navigation action synchronously before opening the sheet. `Alert.alert` callbacks close over `e` naturally because the handler is synchronous. With an async bottom sheet, the event object may be stale by the time `onConfirm` fires.

```typescript
// ✅ GOOD — capture action before presenting sheet
useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    if (!form.isDirty) return;
    e.preventDefault();

    // Capture action NOW — e.data.action is only valid synchronously
    const action = e.data.action;
    confirm({
      title: "Discard changes?",
      message: "You have unsaved changes.",
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => navigation.dispatch(action),
    });
  });
  return unsubscribe;
}, [navigation, form.isDirty, confirm]);

// ❌ BAD — e.data.action read asynchronously in closure
useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    e.preventDefault();
    confirm({
      onConfirm: () => navigation.dispatch(e.data.action), // may be stale
    });
  });
  return unsubscribe;
}, [navigation, confirm]);
```

**When to use:** Any screen migrating from `Alert.alert` to bottom sheet confirmations inside `beforeRemove` listeners.

**Why:** `Alert.alert` is synchronous — it blocks the JS thread and its callbacks run in the same event loop tick. Bottom sheets are async — `present()` returns immediately and `onConfirm` fires later. The navigation event's `data.action` must be captured in a local variable before the async gap.

**References:**

- Related: "Unsaved Changes Navigation Guard" in `docs/patterns/documentation.md`
- `client/hooks/useConfirmationModal.ts` — `confirm()` pattern

### Haptic Ownership During Component Migration

When migrating from `Alert.alert` (or any inline confirmation) to a shared confirmation component that owns its own haptic feedback, remove pre-existing haptics at the callsite to avoid double-buzz. The component that presents the confirmation owns the feedback timing.

```typescript
// Confirmation modal handles its own haptics internally:
// - Warning haptic on destructive confirm tap
// - Selection haptic on cancel tap

// ✅ GOOD — callsite delegates haptics to the modal
const handleDelete = () => {
  confirm({
    onConfirm: () => deleteMutation.mutate(itemId),
  });
  // No haptics here — modal handles it
};

// ❌ BAD — double haptic (callsite + modal both fire)
const handleDelete = () => {
  haptics.notification(NotificationFeedbackType.Warning); // ← remove this
  confirm({
    onConfirm: () => deleteMutation.mutate(itemId),
  });
};
```

**Exception:** Post-mutation haptics in the `onConfirm` callback are the **caller's responsibility** — they fire at a different time and for a different purpose (success/failure feedback after the action completes, not the confirmation interaction itself).

```typescript
confirm({
  onConfirm: async () => {
    await deleteMutation.mutateAsync(itemId);
    haptics.notification(NotificationFeedbackType.Success); // ✅ caller owns post-mutation feedback
  },
});
```

**When to use:** Any migration that moves user confirmation from an inline pattern to a shared component with built-in haptics.

**When NOT to use:** Components that explicitly do NOT own haptic feedback (e.g., plain `Pressable` wrappers).

**References:**

- `client/hooks/useConfirmationModal.ts` — owns warning haptic on destructive confirm
- Related: "Haptic Feedback on User Actions" and "Accessibility-Aware Haptics Pattern" in this file

### FallbackImage for Remote Image Loading

Remote images (recipe photos, avatars, scanned item thumbnails) can fail to load due to 404s, network errors, or corrupted URLs. Use the `FallbackImage` component to automatically show a themed placeholder on failure, preventing blank/broken image states.

```typescript
import { FallbackImage } from "@/components/FallbackImage";

// Basic usage — default icon placeholder
<FallbackImage
  source={{ uri: recipe.imageUrl ?? undefined }}
  style={styles.recipeImage}
  fallbackIcon="image"
  fallbackIconSize={24}
  accessibilityLabel={`Photo of ${recipe.title}`}
/>

// Custom icon color — when the original design uses an accent color
<FallbackImage
  source={{ uri: user.avatarUrl ?? undefined }}
  style={styles.avatar}
  fallbackStyle={{ backgroundColor: withOpacity(theme.link, 0.12) }}
  fallbackIcon="user"
  fallbackIconColor={theme.link}
/>

// Custom fallback element — when you need a non-standard placeholder
<FallbackImage
  source={{ uri: imageUri ?? undefined }}
  style={StyleSheet.absoluteFill}
  fallback={
    <View style={styles.customPlaceholder}>
      <Feather name="image" size={32} color={theme.textSecondary} />
    </View>
  }
/>
```

**Key details:**

- Always convert nullable strings with `?? undefined` before passing to `source` — `FallbackImage` handles `undefined` but nullable `string | null` types should be explicit
- `fallbackIconColor` defaults to `theme.textSecondary` — override when the original design used an accent color (e.g., `theme.link` for avatars)
- `fallbackStyle` merges with `style` on the fallback `View` — use it for different background colors without duplicating dimensions
- `hasError` state resets automatically when the source URI changes, so dynamic updates (e.g., user uploads new avatar) work without remounting
- The companion `FallbackImage-utils.ts` exports `hasValidUri()` as a pure testable type guard

**When to use:** Any `<Image>` that loads a remote URL (recipe images, avatars, product photos, community content). NOT needed for locally-captured images (camera photos, image picker results) which are guaranteed to exist.

**References:**

- `client/components/FallbackImage.tsx` — component implementation
- `client/components/FallbackImage-utils.ts` — `hasValidUri()` type guard
- `client/screens/ProfileScreen.tsx` — avatar with `fallbackIconColor={theme.link}`
- `client/screens/HistoryScreen.tsx` — scanned item thumbnails with "package" icon

### Reset Derived State on Prop Change

When a component tracks internal state derived from props (e.g., error states, loading flags, selection), that state can become stale when props change without the component remounting. Use a `useEffect` keyed on the relevant prop to reset:

```typescript
// ❌ BAD — hasError persists even after source changes
const [hasError, setHasError] = useState(false);
// User updates avatar → new URI arrives → still shows fallback

// ✅ GOOD — reset when the driving prop changes
const [hasError, setHasError] = useState(false);
const sourceUri = source?.uri;
useEffect(() => {
  setHasError(false);
}, [sourceUri]);
```

**Key details:**

- Extract the primitive value from the prop (`source?.uri` not `source`) to avoid unnecessary resets from object reference changes
- This is different from the "Intentional useEffect Dependencies" pattern — here the goal IS to react to the specific prop change
- Alternative: use `key={sourceUri}` on the component to force a full remount, but this is heavier and destroys all internal state

**When to use:** Any component where internal state (error flags, validation results, expanded/collapsed) should reset when a key prop changes identity.

**When NOT to use:** State that should survive prop changes (scroll position, user input in a form that receives new defaults).

### Dynamic Type Overflow Prevention

iOS Dynamic Type scales all `<Text>` by default — correct for accessibility. But text in **fixed-height containers** (tab bars, badges, chips, toasts) will overflow at extreme sizes. Use `ThemedText`'s `maxScale` prop to cap scaling:

```typescript
import { MAX_FONT_SCALE_CONSTRAINED } from "@/constants/theme";

// Cap at 1.5x in a fixed-height badge
<ThemedText maxScale={MAX_FONT_SCALE_CONSTRAINED} style={styles.badgeLabel}>
  {label}
</ThemedText>
```

**Rules:**

- Always use `maxScale` on `ThemedText` — never pass `maxFontSizeMultiplier` directly (ThemedText strips it to prevent conflicts)
- Use `MAX_FONT_SCALE_CONSTRAINED` (1.5) for standard constrained containers; use a custom value (e.g. 1.3) for very tight spaces like camera overlays
- Never apply `maxScale` to body text in scrollable areas — that defeats the accessibility purpose
- Only constrain text that lives in a genuinely fixed-height layout (tab bar, badge pill, chip, toast, progress bar label)

**Where it's applied:** Tab bar labels, CalorieBudgetBar, Chip, HomeRecipeCard difficulty badge, VerificationBadge, AllergenBadge, FastingStreakBadge (compact), Toast, OfflineBanner, ScanScreen reticle text, HistoryScreen stat values.

### Lifted Filter State with Presentational Sheet

When a bottom sheet provides advanced filtering for a list screen, keep all filter state in the parent screen — not inside the sheet. The sheet is purely presentational: it receives current filters and fires callbacks. This keeps the sheet reusable, testable, and avoids stale-state bugs from sheet mounting/unmounting.

```typescript
// Parent screen — owns the state
const [advancedFilters, setAdvancedFilters] = useState<SearchFilters>({
  sort: "relevance",
  maxPrepTime: undefined,
  maxCalories: undefined,
  minProtein: undefined,
  source: "all",
});
const filterSheetRef = React.useRef<BottomSheetModal>(null);

// Derived badge count
const activeFilterCount = useMemo(() => {
  let count = 0;
  if (advancedFilters.sort !== "relevance") count++;
  if (advancedFilters.maxPrepTime !== undefined) count++;
  if (advancedFilters.maxCalories !== undefined) count++;
  if (advancedFilters.minProtein !== undefined) count++;
  if (advancedFilters.source !== "all") count++;
  return count;
}, [advancedFilters]);
```

```tsx
// Sheet component — purely presentational, no internal state
interface SearchFilterSheetProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  onReset: () => void;
  activeFilterCount: number;
}

export function SearchFilterSheet({
  filters,
  onFiltersChange,
  onReset,
  activeFilterCount,
}: SearchFilterSheetProps) {
  // Renders chips, sliders, reset button — all driven by props
}
```

```tsx
// Filter icon button with badge — opens the sheet
<Pressable onPress={() => filterSheetRef.current?.present()}>
  <Feather name="sliders" size={16} color={theme.link} />
  {activeFilterCount > 0 && (
    <View style={styles.filterBadge}>
      <ThemedText style={styles.filterBadgeText}>
        {activeFilterCount}
      </ThemedText>
    </View>
  )}
</Pressable>
```

**Key rules:**

- **State in parent, not sheet:** The sheet reads `filters` prop and calls `onFiltersChange` — it never calls `useState` for filter values
- **Badge count is derived:** Compute `activeFilterCount` as a `useMemo` comparing current filters to defaults — don't track it as separate state
- **Reset clears to defaults:** The parent's `onReset` handler resets to the default `SearchFilters` object, not to empty/null
- **Sheet is a BottomSheetModal child:** Wrap in `<BottomSheetView>` inside `<BottomSheetModal>`, placed at the end of the screen's return

**When to use:** Any list screen with a filter bottom sheet (recipe search, product catalog, activity log filters).

**Reference:** `client/components/meal-plan/SearchFilterSheet.tsx`, `client/screens/meal-plan/RecipeBrowserScreen.tsx`

### Single-Screen Wizard with Reanimated Transitions

For multi-step forms (recipe creation, onboarding), use a single screen component with a `WizardShell` that manages step state internally. Steps are swapped via Reanimated layout animations using a `key` change — not separate navigation screens.

```typescript
// WizardShell manages: currentStep, direction, validation, progress bar, nav buttons
const [currentStep, setCurrentStep] = useState<WizardStep>(1);
const [direction, setDirection] = useState<"forward" | "back">("forward");

// Step transitions via key change + entering/exiting animations
const entering = direction === "forward" ? SlideInRight.duration(250) : SlideInLeft.duration(250);
const exiting = direction === "forward" ? SlideOutLeft.duration(250) : SlideOutRight.duration(250);

<Animated.View key={`step-${currentStep}`} entering={entering} exiting={exiting}>
  {renderStep()}
</Animated.View>
```

**Architecture:**

```
Screen (thin wrapper — extracts route params, provides navigation callbacks)
└── WizardShell (manages step state, progress bar, nav buttons)
    ├── Step1Component (pure view + form interactions, receives props)
    ├── Step2Component
    └── ...
```

Each step component is a focused, pure-view component receiving only the data and callbacks it needs. No step component manages navigation or validation — that is centralized in the shell.

**Edit-from-preview pattern:** The final step shows a preview with "Edit" links. Tapping one sets `returnToPreview = true` and jumps back to that step. On the next "Next" tap, `returnToPreview` causes a fast-forward back to Preview, skipping intermediate steps.

```typescript
const editFromPreview = useCallback((targetStep: WizardStep) => {
  setReturnToPreview(true);
  setDirection("back");
  setCurrentStep(targetStep);
}, []);

// In goNext:
if (returnToPreview) {
  setReturnToPreview(false);
  setCurrentStep(PREVIEW_STEP);
  return;
}
```

**Why single-screen over navigation stack:**

- Progress bar and nav buttons stay persistent (no re-mount flicker)
- Step state is trivial (`useState` vs navigation params)
- Edit-from-preview jumps are simple state changes, not complex `navigation.navigate` calls
- No risk of stale params or navigation stack depth issues

**When to use:** Multi-step forms with 4+ steps where the user fills data across steps and reviews at the end. Not needed for simple 2-3 step flows where separate screens work fine.

**Reference:** `client/components/recipe-wizard/WizardShell.tsx`, `client/screens/meal-plan/RecipeCreateScreen.tsx`

### Dirty State Sync via Ref Callbacks

When a child component (e.g., `WizardShell`) owns form state but the parent screen needs it for `beforeRemove` navigation guards, use callback props that write to `useRef` values in the parent. The ref avoids re-renders while keeping the `beforeRemove` listener fresh.

```typescript
// Parent screen
const isDirtyRef = useRef(false);
const isSavingRef = useRef(false);

const handleDirtyChange = useCallback((dirty: boolean) => {
  isDirtyRef.current = dirty;
}, []);

useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    if (isSavingRef.current) return;  // Let saves through
    if (!isDirtyRef.current) return;  // Clean form, let go

    e.preventDefault();
    Alert.alert("Discard changes?", "...", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive",
        onPress: () => navigation.dispatch(e.data.action) },
    ]);
  });
  return unsubscribe;
}, [navigation]);

<WizardShell onDirtyChange={handleDirtyChange} onSavingChange={handleSavingChange} />
```

```typescript
// Child component (WizardShell)
useEffect(() => {
  onDirtyChange?.(form.isDirty);
}, [form.isDirty, onDirtyChange]);
```

**Why refs instead of state:** The `beforeRemove` listener has `[navigation]` as its only dependency — it never re-subscribes. Using state would require adding `isDirty` to the dependency array, causing the listener to re-subscribe on every keystroke. Refs let the listener read the current value without re-subscribing.

**When to use:** Any screen where form state lives in a child component but the parent needs it for navigation guards, permission checks, or other cross-cutting concerns.

**Reference:** `client/screens/meal-plan/RecipeCreateScreen.tsx`, `client/components/recipe-wizard/WizardShell.tsx`

---

## Single Owner of Unsaved-Changes Prompt

When a screen uses a `beforeRemove` navigation listener to prompt for
unsaved changes, the child component must NOT also show its own discard
Alert for the same condition. The two prompts chain: the child's Alert
fires, user taps Discard, the onDismiss callback calls
`navigation.goBack()`, and the screen's `beforeRemove` re-fires showing
an identical second Alert.

```typescript
// ❌ Bad: child component duplicates the prompt
// WizardShell.tsx
const goBack = useCallback(() => {
  if (currentStep === 1) {
    if (form.isDirty) {
      Alert.alert("Discard changes?", "...", [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onGoBack },
      ]);
      return;
    }
    onGoBack();
  }
}, [currentStep, form.isDirty, onGoBack]);

// RecipeCreateScreen.tsx — ALSO shows an Alert via beforeRemove
navigation.addListener("beforeRemove", (e) => {
  if (isDirtyRef.current) {
    e.preventDefault();
    Alert.alert("Discard changes?", "...", ...); // fires AFTER WizardShell's
  }
});
```

```typescript
// ✅ Good: child just delegates; screen's beforeRemove is the sole owner
// WizardShell.tsx
const goBack = useCallback(() => {
  if (currentStep === 1) {
    // Screen-level beforeRemove listener owns the unsaved-changes prompt;
    // delegating here avoids a double-alert on discard.
    onGoBack();
    return;
  }
  // ... step-back within wizard
}, [currentStep, onGoBack]);
```

**Why the screen should own it:** `beforeRemove` intercepts all exit
paths — hardware back button, swipe-back gesture, tab switch, deep-link
replace — not just the explicit "Back" button in the child. Putting the
prompt in the screen guarantees one code path handles every exit.

**Origin:** 2026-04-17 audit H13 — WizardShell and RecipeCreateScreen
both had discard Alerts. Tapping the in-wizard Back on step 1 fired the
wizard's Alert; Discard called `onGoBack()` → `navigation.goBack()` →
`beforeRemove` → second identical Alert.

---

## Capture Inner `setTimeout` Handles in Outer `useEffect` Closures

A `useEffect` that schedules a timer, then schedules a _nested_ timer
inside the first callback, must capture both handles via closure
variables so the cleanup function can clear both. The cleanup only sees
the variables captured at effect-setup time.

```typescript
// ❌ Bad: inner setTimeout's handle is never captured
useEffect(() => {
  const outer = setTimeout(() => {
    animate.value = withSequence(withTiming(1), withTiming(0));
    setTimeout(() => onComplete?.(), 300); // fires on unmounted component!
  }, 300);
  return () => clearTimeout(outer); // only clears the outer timer
}, [visible]);
```

```typescript
// ✅ Good: inner timer captured in the outer effect's closure
useEffect(() => {
  let completeTimer: ReturnType<typeof setTimeout> | undefined;
  const outer = setTimeout(() => {
    animate.value = withSequence(withTiming(1), withTiming(0));
    completeTimer = setTimeout(() => onComplete?.(), 300);
  }, 300);
  return () => {
    clearTimeout(outer);
    if (completeTimer) clearTimeout(completeTimer);
  };
}, [visible]);
```

**Why:** The cleanup runs when the effect re-runs or on unmount. The
inner `setTimeout` may not have been scheduled yet at cleanup time, OR
it may have already fired. By keeping a closure variable, the cleanup
function conditionally clears whichever timer is still pending.

**When to apply:** Any effect that schedules chained timers (staggered
animations, fade-in-then-out-then-complete sequences, debounced
state-then-side-effect patterns).

**Origin:** 2026-04-17 audit H15 — `AnimatedCheckmark.tsx` scheduled the
fade-out `setTimeout` from within the draw-complete `setTimeout`. Cleanup
cleared only the outer handle; the inner callback fired after unmount,
risking `setState`-on-unmounted warnings and triggering `onComplete`
after the consumer had already moved on.

### iOS Native Asset Sync for Persistent `ios/` Directory

`npx expo run:ios` only runs `expo prebuild` when the `ios/` directory does not exist. Because this project keeps a persistent `ios/` directory (with custom Podfile patches for MLKit), **changes to `assets/images/icon.png`, `assets/images/splash-icon.png`, or `app.json` splash config are silently ignored by subsequent builds.**

You must manually sync these files in the iOS asset catalog after any asset change:

**App icon (`assets/images/icon.png`):**

```bash
cp assets/images/icon.png \
  ios/OCRecipes/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
```

**Splash screen image (`assets/images/splash-icon.png`):**

```bash
LOGO_DIR="ios/OCRecipes/Images.xcassets/SplashScreenLogo.imageset"
SRC="assets/images/splash-icon.png"
sips -z 200 200 "$SRC" --out "$LOGO_DIR/image.png"
sips -z 400 400 "$SRC" --out "$LOGO_DIR/image@2x.png"
cp "$SRC" "$LOGO_DIR/image@3x.png"
```

**Splash background colour** (`ios/OCRecipes/Images.xcassets/SplashScreenBackground.colorset/Contents.json`):
Colours are stored as 0–1 float components per channel, not hex. Convert:

```
#FAF6F0 → red: 0.9804, green: 0.9647, blue: 0.9412   (light)
#1E1814 → red: 0.1176, green: 0.0941, blue: 0.0784   (dark)
```

**After syncing, always clear the build cache and simulator:**

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/OCRecipes-*
xcrun simctl shutdown <simulator-id> && xcrun simctl erase <simulator-id>
# Then rebuild:
npx expo run:ios
```

**Note:** The simulator icon/splash cache is separate from Xcode's DerivedData cache — both must be cleared. Deleting the app from the simulator alone is not sufficient; the Springboard icon cache persists until the simulator is erased.

**Origin:** 2026-04-25 rebrand — icon and splash changes in `app.json` and `assets/images/` had no effect on the build until the iOS asset catalog was manually updated.
