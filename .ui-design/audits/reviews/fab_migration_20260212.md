# Design Review: FAB Migration (Scan Tab to Floating Action Button)

**Review ID:** fab_migration_20260212
**Reviewed:** 2026-02-12 11:35
**Target:** Recent commit (7 files: ScanFAB, MainTabNavigator, RootStackNavigator, ScanScreen, HistoryScreen, navigation types, deleted ScanStackNavigator)
**Focus:** Comprehensive (Visual, Usability, Code, Performance)
**Platform:** Mobile (iOS + Android)

## Summary

The migration from a tab-based scan button to a floating action button is architecturally clean. Navigation types are properly simplified, the fullScreenModal covers the FAB naturally, and the 3-tab layout is balanced. There are a few issues around the FAB's hardcoded positioning, missing touch feedback, and a potential FAB-content overlap on the History screen that should be addressed.

**Issues Found:** 7

- Critical: 0
- Major: 2
- Minor: 3
- Suggestions: 2

## Major Issues

### Issue 1: Duplicated Tab Bar Height Constant

**Severity:** Major
**Location:** `client/components/ScanFAB.tsx:14`, `client/navigation/MainTabNavigator.tsx:40-42`
**Category:** Code

**Problem:**
The tab bar height is defined in two places — once as `TAB_BAR_HEIGHT` in ScanFAB and again inline in MainTabNavigator's `tabBarStyle.height`. If either value changes independently, the FAB will be mispositioned above or below the tab bar.

**Impact:**
Future maintainers editing tab bar height in one place won't realize the FAB constant must also update, causing a visual bug that's easy to miss in review.

**Recommendation:**
Extract the tab bar height to a shared constant in `theme.ts` and reference it from both files.

**Code Example:**

```typescript
// client/constants/theme.ts
export const TAB_BAR_HEIGHT = Platform.select({ ios: 88, android: 72 }) ?? 88;

// client/components/ScanFAB.tsx
import { TAB_BAR_HEIGHT } from "@/constants/theme";

// client/navigation/MainTabNavigator.tsx
import { TAB_BAR_HEIGHT } from "@/constants/theme";
// ...
tabBarStyle: { height: TAB_BAR_HEIGHT, ... }
```

---

### Issue 2: FAB Overlaps Bottom Content on History Screen

**Severity:** Major
**Location:** `client/components/ScanFAB.tsx:37`, `client/screens/HistoryScreen.tsx:720-721`
**Category:** Usability

**Problem:**
The FAB is positioned at `bottom: TAB_BAR_HEIGHT + 16` (104pt on iOS), floating over the bottom-right of the content area. The History screen's FlatList uses `paddingBottom: tabBarHeight + Spacing.xl` (108pt) which only barely clears the FAB. The last item in the list, the "View All History" link, or the empty state could be partially obscured by the FAB, especially on smaller devices.

**Impact:**
Users may struggle to tap the last history item or the "View All History" link when the FAB overlaps them. This is a common FAB usability pitfall.

**Recommendation:**
Increase the FlatList's `paddingBottom` to account for the FAB (add ~72pt: FAB height 56 + 16 margin), or ensure the FAB position doesn't overlap actionable content. Alternatively, add a spacer in `ListFooterComponent` when items exist.

---

## Minor Issues

### Issue 3: FAB Missing Press Feedback Animation

**Severity:** Minor
**Location:** `client/components/ScanFAB.tsx:27-42`
**Category:** Usability

**Problem:**
The FAB has haptic feedback on press but no visual press state. Other tappable elements in the app use `Pressable` with `onPressIn`/`onPressOut` scale animations (e.g., HistoryItem uses `withSpring(0.98)`). The FAB is a primary action button and should feel responsive on touch.

**Recommendation:**
Add a scale-down animation on press, consistent with the app's existing press patterns. Even a simple `opacity` change via `Pressable`'s style function would help:

```tsx
<Pressable
  style={({ pressed }) => [
    styles.fab,
    Shadows.medium,
    {
      backgroundColor: theme.link,
      bottom: TAB_BAR_HEIGHT + 16,
      transform: [{ scale: pressed ? 0.92 : 1 }],
    },
  ]}
>
```

---

### Issue 4: FAB Shadow Too Subtle for Primary Action

**Severity:** Minor
**Location:** `client/components/ScanFAB.tsx:34`
**Category:** Visual

**Problem:**
The FAB uses `Shadows.medium` (opacity: 0.1, radius: 4, elevation: 2). As the primary action button floating over content, it should have more visual lift to establish depth hierarchy. Material Design recommends elevation 6-8 for FABs. The existing `Shadows.large` (opacity: 0.15, radius: 8, elevation: 4) would be more appropriate.

**Recommendation:**
Change `Shadows.medium` to `Shadows.large` for stronger visual separation from the background content.

---

### Issue 5: `Spacing` Import Unused in ScanFAB

**Severity:** Minor
**Location:** `client/components/ScanFAB.tsx:9`
**Category:** Code

**Problem:**
`Spacing` is not imported, but the magic numbers `16` (bottom offset from tab bar) and `20` (right offset) are used directly. These should ideally reference the spacing scale for consistency.

**Recommendation:**
Use `Spacing.lg` (16) for the bottom offset and `Spacing.xl` (20) for the right offset to stay consistent with the design system:

```typescript
import { BorderRadius, Shadows, Spacing } from "@/constants/theme";
// ...
bottom: TAB_BAR_HEIGHT + Spacing.lg,
// ...
right: Spacing.xl,
```

---

## Suggestions

### Suggestion 1: Consider Reanimated for Smoother FAB Press Animation

If you add press animation to the FAB (Issue 3), consider using Reanimated `withSpring` + `useAnimatedStyle` instead of the `Pressable` style function. This runs on the UI thread and produces smoother 60fps animations, which matters for a primary interactive element. The pattern is already well-established throughout the codebase (see HistoryItem, shutter button in ScanScreen).

---

### Suggestion 2: Dashboard "Scan Barcode" CTA May Be Redundant

**Location:** `client/screens/HistoryScreen.tsx:393-424`

The Today dashboard still has a large "Scan Barcode" CTA card taking up significant vertical space. Now that the FAB provides persistent scan access from every tab, this CTA is somewhat redundant. Consider replacing it with a more compact element (like a quick-action row) or using that space for richer dashboard content (e.g., a calorie progress bar, macro breakdown, or daily tip).

---

## Positive Observations

- **Clean navigation simplification**: Removing the `ScanStackNavigator` and promoting Scan to a RootStack `fullScreenModal` is a clear architectural improvement. The navigation type changes are correctly scoped.
- **Natural FAB/modal layering**: The fullScreenModal covers the FAB without needing conditional visibility logic — well thought out.
- **Good accessibility**: The FAB has `accessibilityRole="button"` and a descriptive `accessibilityLabel`. The ScanScreen close button correctly uses `goBack()` which works with screen readers and swipe-back gestures.
- **Haptic feedback consistency**: The FAB fires `Medium` impact on press, matching the existing convention for primary actions (same as the shutter button and scan CTA).
- **Theme compliance**: Uses `theme.link` for background and `theme.buttonText` for icon color — properly themed for light/dark mode.
- **3-tab balance**: Removing the scan tab creates a visually balanced 3-tab layout (Today, Plan, Profile) with even spacing.

## Next Steps

1. **Extract `TAB_BAR_HEIGHT` to shared constant** (Issue 1) — prevents future drift between FAB and tab bar
2. **Add bottom padding for FAB clearance** (Issue 2) — prevents content occlusion
3. **Add press animation to FAB** (Issue 3) — matches existing interaction patterns

---

_Generated by UI Design Review. Run `/ui-design:design-review` again after fixes._
