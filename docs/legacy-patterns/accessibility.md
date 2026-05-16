# Accessibility Patterns

## MUST CHECK

Before writing any React Native screen or component, verify all of these:

- [ ] All `fullScreenModal` and `modal` screens have `accessibilityViewIsModal={true}` on the inner focusable container
- [ ] Decorative icons inside labeled `Pressable`s have `accessible={false}`
- [ ] Every `disabled` Pressable sets both `disabled={true}` **and** `accessibilityState={{ disabled: true }}` — TalkBack ignores the prop alone
- [ ] Error messages use `accessibilityLiveRegion="assertive"` (not `"polite"`) via `<InlineError>`, not `Alert.alert()`
- [ ] Async state changes (success, error, limit-reached) call `AccessibilityInfo.announceForAccessibility()` on iOS
- [ ] Radio buttons use `accessibilityState={{ selected: bool }}` not `{{ checked: bool }}`
- [ ] Radio chip rows have a `role="radiogroup"` wrapper `View`
- [ ] Progress bars have `accessibilityRole="progressbar"` + `accessibilityValue={{ min, max, now }}`
- [ ] Decorative emoji are wrapped in `<Text accessible={false}>`
- [ ] `accessibilityLiveRegion` is always paired with `AccessibilityInfo.announceForAccessibility()` (the former is Android-only)
- [ ] Badges purely decorative inside a labelled parent have `accessible={false}` on the badge
- [ ] Touch targets are ≥ 44pt; use `hitSlop` for small controls
- [ ] `<FlatList>` groups of checkboxes/radios have a group role wrapper
- [ ] SVG child elements (`<G>`, `<Circle>`, `<Text>`) never carry accessibility props — put the summary label on the parent `View`

---

### Parent Label Prefix for Decorative Child Elements

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
        accessible={false}
      >
        <Feather name="repeat-2" size={12} />
        <Text>Remixed</Text>
      </View>
    )}
  </View>
</Pressable>
```

**When to use:** Decorative badges in card/button components (remix badge, lock icon, allergen dot), status indicators that are visual-only (not tappable).

**When NOT to use:** Interactive badges that are themselves tappable; informational text that provides different meaning than the parent.

---

### Accessibility Props Pattern

Provide semantic accessibility information for screen readers (VoiceOver on iOS, TalkBack on Android). This is essential for WCAG 2.1 Level AA compliance.

#### Core Accessibility Props

```typescript
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

```typescript
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

**Why combine title and description:** Screen reader users hear full context in one announcement.

#### Radio Pattern (Single-Select Lists)

Use `accessibilityRole="radio"` with `selected` state (not `checked`) — `checked` maps to checkbox semantics on TalkBack.

```typescript
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

#### Icon-Only Button Pattern

Icon buttons without visible text MUST have an `accessibilityLabel`. Use state-aware labels for toggles:

```typescript
// Toggle button — label reflects current state AND what activation does
<Pressable
  onPress={() => setTorch(!torch)}
  accessibilityLabel={torch ? "Turn off flashlight" : "Turn on flashlight"}
  accessibilityRole="button"
  accessibilityState={{ checked: torch }}
>
  <Feather name={torch ? "zap" : "zap-off"} size={24} />
</Pressable>
```

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

Icons inside a `Pressable` that serve only as visual decoration must be marked `accessible={false}`. Without this, VoiceOver announces each icon as a separate focusable element.

```typescript
// ✅ Good: Decorative icons hidden from screen readers
<Pressable
  onPress={handlePress}
  accessibilityLabel="GLP-1 Companion"
  accessibilityRole="button"
>
  <Feather name="activity" size={20} color={theme.text} accessible={false} />
  <ThemedText>GLP-1 Companion</ThemedText>
  <Feather name="chevron-right" size={16} color={theme.textSecondary} accessible={false} />
</Pressable>
```

**Mark `accessible={false}` on:** leading icons in settings rows, trailing chevrons, lock badge icons, status icons next to descriptive text, decorative emoji/image inside a labeled container.

**Do NOT mark `accessible={false}` on:** icon-only buttons with no visible text; icons that convey information not present in the text label.

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

#### List Item Navigation Pattern

```typescript
<Pressable
  onPress={() => onPress(item)}
  accessibilityLabel={`${item.productName}${item.brandName ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
  accessibilityRole="button"
>
  <Text>{item.productName}</Text>
  <Text>{item.brandName}</Text>
  <Text>{item.calories} cal</Text>
</Pressable>
```

**Include "Tap to view details"** to inform users that activation navigates somewhere rather than performing an immediate action.

---

### Touch Target Size Pattern

Ensure interactive elements meet the minimum touch target size of 44×44 points (WCAG 2.1 AA).

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

**Calculating hitSlop:** If your touchable is 24pt, add 10pt on each side: `(24 + 10 + 10) = 44pt`.

---

### Accessibility Grouping Pattern

Group related elements so screen readers announce them together:

```typescript
// Card announced as single unit
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

**When to use:** Cards or list items with multiple text elements; complex components that should be announced as one unit.

**When NOT to use:** When child elements are independently interactive.

---

### Radio/Checkbox Group Container Pattern

Wrap radio lists in a `role="radiogroup"` container so screen readers understand mutual exclusivity:

```typescript
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
```

---

### Dynamic Accessibility Announcements

Announce important state changes that aren't reflected in focus:

```typescript
import { AccessibilityInfo } from "react-native";

const handleBarcodeScanned = async (barcode: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  AccessibilityInfo.announceForAccessibility("Barcode scanned successfully");
};

const handleError = (message: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  AccessibilityInfo.announceForAccessibility(`Error: ${message}`);
};
```

**When to use:** Success/error states after async operations; content updates not caused by user navigation; timer-based notifications.

---

### useAccessibility Hook Pattern

Centralize accessibility detection — provides reduced motion and screen reader status:

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
    return () => subscription.remove();
  }, []);

  return {
    reducedMotion: reducedMotion ?? false,
    screenReaderEnabled,
  };
}
```

---

### Accessibility-Aware Haptics Pattern

Disable haptics when reduced motion is preferred:

```typescript
export function useHaptics() {
  const { reducedMotion } = useAccessibility();

  const impact = useCallback(
    (style = Haptics.ImpactFeedbackStyle.Medium) => {
      if (!reducedMotion) Haptics.impactAsync(style);
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (!reducedMotion) Haptics.notificationAsync(type);
    },
    [reducedMotion],
  );

  return { impact, notification, disabled: reducedMotion };
}
```

---

### Reduced Motion Animation Pattern

| Animation type                | Reduced motion approach                             |
| ----------------------------- | --------------------------------------------------- |
| Entrance (`entering` prop)    | Pass `undefined`                                    |
| Press (scale on tap)          | Skip `withSpring` call                              |
| Continuous (`withRepeat(-1)`) | Set static value + `cancelAnimation` + early return |

```typescript
// Entrance animation
const enteringAnimation = reducedMotion
  ? undefined
  : FadeInDown.delay(index * 50).duration(300);

// Continuous/looping animation — must actively cancel
useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(cornerOpacity);
    cornerOpacity.value = 0.8; // static fallback
    return;
  }
  cornerOpacity.value = withRepeat(
    withSequence(
      withTiming(1, { duration: 1000 }),
      withTiming(0.6, { duration: 1000 }),
    ),
    -1,
    true,
  );
}, [reducedMotion]);
```

**Key:** Simply returning early from an effect doesn't stop an already-running `withRepeat`. Call `cancelAnimation()` explicitly, then reset the shared value to its rest state.

Use plain `else` (not `else if`) for the cancel branch — `else if (phase !== X)` creates a dead zone when the start condition has multiple guards (see LEARNINGS.md "else if gap" pattern).

---

### Skeleton Loader Accessibility

Hide skeletons from the accessibility tree and announce loading explicitly:

```typescript
// Hide placeholder content from screen readers
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

// Announce loading so VoiceOver users aren't left in silence
function MySkeleton() {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);
  return (
    <View accessibilityElementsHidden>
      <SkeletonBox width="80%" height={20} />
    </View>
  );
}
```

---

### Dynamic Loading State Labels

Update `accessibilityLabel` during async operations:

```typescript
<Button
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

---

### Slider Live SR Feedback Pattern

`@react-native-community/slider` only fires `onSlidingComplete` by default — `accessibilityValue.now` stays stale during drag. Fix with local state driven by `onValueChange`:

```typescript
const [livePrepTime, setLivePrepTime] = useState(filters.maxPrepTime ?? 0);

useEffect(() => {
  setLivePrepTime(filters.maxPrepTime ?? 0);
}, [filters.maxPrepTime]);

<Slider
  value={filters.maxPrepTime ?? 0}
  onValueChange={(val) => setLivePrepTime(val)}
  onSlidingComplete={(val) => {
    setLivePrepTime(val);
    onFiltersChange({ ...filters, maxPrepTime: val > 0 ? val : undefined });
  }}
  accessibilityValue={{
    min: 0, max: 120,
    now: livePrepTime,
    text: livePrepTime > 0 ? `${livePrepTime} minutes` : "Any prep time",
  }}
/>
```

The `useEffect` sync prevents stale SR text after external resets (e.g. a "Reset filters" button).

---

### Stepper +/− Button accessibilityValue Pattern

```typescript
<Pressable
  onPress={() => handleChange(-1)}
  disabled={atMin}
  accessibilityRole="button"
  accessibilityLabel="Decrease servings"
  accessibilityValue={{ now: servings, min: MIN_SERVINGS, max: MAX_SERVINGS, text: `${servings} servings` }}
>
  <Feather name="minus" />
</Pressable>

{/* Hide decorative counter — value is already on the buttons */}
<Text accessibilityElementsHidden importantForAccessibility="no">
  {servings}
</Text>

<Pressable
  onPress={() => handleChange(1)}
  accessibilityRole="button"
  accessibilityLabel="Increase servings"
  accessibilityValue={{ now: servings, min: MIN_SERVINGS, max: MAX_SERVINGS, text: `${servings} servings` }}
>
  <Feather name="plus" />
</Pressable>
```

**Cross-platform hiding:** `accessibilityElementsHidden` covers iOS VoiceOver; `importantForAccessibility="no"` covers Android TalkBack. Do NOT use `aria-hidden` — it is a web HTML attribute silently ignored in React Native.

---

### Modal Focus Trapping

Add `accessibilityViewIsModal` to the inner container of all modal and `fullScreenModal` screens:

```typescript
// React Native Modal
<Modal visible={visible} transparent animationType="slide">
  <View style={styles.overlay}>
    <KeyboardAvoidingView
      accessibilityViewIsModal
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* modal content */}
    </KeyboardAvoidingView>
  </View>
</Modal>

// React Navigation fullScreenModal — apply to root container of the screen component
<View style={styles.container} accessibilityViewIsModal>
  {/* screen content */}
</View>
```

**BottomSheetModal portal caveat:** `BottomSheetModal` renders via a portal outside the normal component tree. Place portal-rendered modal components **inside** the `accessibilityViewIsModal` container, not as siblings — VoiceOver cannot reach a portal that is outside the modal boundary.

---

### Inline Validation Errors

Use `<InlineError>` for form validation instead of `Alert.alert()`:

```typescript
import { InlineError } from "@/components/InlineError";

const [error, setError] = useState<string | null>(null);

const handleSubmit = () => {
  if (isNaN(value) || value <= 0) {
    setError("Please enter a valid value.");
    return;
  }
  setError(null);
};

<TextInput onChangeText={(text) => { setValue(text); if (error) setError(null); }} />
<InlineError message={error} style={{ marginTop: Spacing.sm }} />
```

**Why:** Inline errors are visible alongside the input, carry `accessibilityRole="alert"`, and don't block interaction like `Alert.alert()` does.

---

### Cross-Platform Live Region Announcements

`accessibilityLiveRegion` is Android-only. Always pair with `AccessibilityInfo.announceForAccessibility()` for iOS:

```typescript
// Android: live region announces automatically
<View accessibilityLiveRegion="polite">
  <ThemedText>{statusText}</ThemedText>
</View>

// iOS: explicit announcement via useEffect
useEffect(() => {
  if (isScanning) AccessibilityInfo.announceForAccessibility("Scanning");
}, [isScanning]);
```

**Announce ALL outcomes — both success AND error:**

```typescript
// ❌ BAD — screen reader users never hear success
useEffect(() => {
  if (error)
    AccessibilityInfo.announceForAccessibility("Save failed: " + error);
}, [error]);

// ✅ GOOD
useEffect(() => {
  if (error) {
    AccessibilityInfo.announceForAccessibility("Save failed: " + error);
  } else if (saveSucceeded) {
    AccessibilityInfo.announceForAccessibility("Recipe saved");
  }
}, [error, saveSucceeded]);
```

**Avoid re-firing on unrelated re-renders:** Use a prev-value ref (see "Ref Guard for One-Shot Effects" below) to fire announcements only on state transitions, not every re-render.

**`accessibilityLiveRegion` on frequently-updating content:** Do not use `"polite"` on a view that updates every few seconds (e.g. a countdown timer) — it produces constant TalkBack interruptions. Use `AccessibilityInfo.announceForAccessibility()` triggered on discrete state transitions instead.

---

### Input Error States with `aria-invalid`

Use `aria-invalid` (not `accessibilityState={{ invalid: true }}`) to mark inputs in an error state — `invalid` is not in `AccessibilityState`'s type union:

```tsx
const { accessibilityHint, error, errorMessage, ...props } = componentProps;

<RNTextInput
  aria-invalid={error ? true : undefined}
  accessibilityHint={
    error && errorMessage
      ? accessibilityHint
        ? `${accessibilityHint}. ${errorMessage}`
        : errorMessage
      : accessibilityHint
  }
  {...props}
/>;
```

**Spread override gotcha:** Destructure `accessibilityHint` out of the rest spread — otherwise `{...props}` will clobber the computed value. See also `docs/patterns/typescript.md` "Prop Shielding in Wrapper Components".

---

### `role` Prop for Unsupported ARIA Roles

When `accessibilityRole` doesn't support a needed value, use the `role` prop (RN 0.73+):

```tsx
// ❌ Bad: "group" is not in accessibilityRole's type union — TS error
<View accessibilityRole="group" accessibilityLabel="Side effects">

// ✅ Good
<View role="group" accessibilityLabel="Side effects">
```

Use for: `"group"`, `"list"`, `"listitem"`, `"form"`. Prefer `accessibilityRole` for roles it already supports (`"button"`, `"radiogroup"`, `"checkbox"`, `"alert"`, etc.).

---

### Cancel Running Animations on `reducedMotion` Change

When `reducedMotion` toggles at runtime, actively cancel running `withRepeat` animations:

```tsx
useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(dot1);
    dot1.value = 0; // Reset to rest position
    return;
  }
  dot1.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
}, [dot1, reducedMotion]);
```

`withRepeat` animations continue on the UI thread even if the effect exits — `cancelAnimation()` is the only way to stop them. Use plain `else`, not `else if`, for the cancel branch (see "else if gap" in LEARNINGS.md).

---

### Ref Guard for One-Shot Effects

When a `useEffect` should fire a side effect exactly once per boolean transition, use a ref to prevent duplicate firings from unrelated dependency changes:

```tsx
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

**When to use:** Showing a toast when a boolean error flag becomes true; one-time analytics events; any `useEffect` where a side effect should fire once per `false → true` transition.

---

### WCAG Color Contrast

Light mode color tokens must maintain ≥ 4.5:1 contrast ratio against white backgrounds (WCAG 2.1 AA):

| Token                           | Value     | Ratio  |
| ------------------------------- | --------- | ------ |
| `textSecondary`                 | `#717171` | ~4.5:1 |
| `success` / `proteinAccent`     | `#008A38` | ~4.6:1 |
| `calorieAccent` / `carbsAccent` | `#C94E1A` | ~4.6:1 |
| `fatAccent`                     | `#8C6800` | ~5.1:1 |

Verify new color tokens at [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) before committing.

---

### SVG Elements Are Invisible to the Accessibility Tree

`react-native-svg` inner elements (`<G>`, `<Line>`, `<Circle>`, `<Text>`) silently ignore `accessible`, `accessibilityLabel`, and `accessibilityRole`. Put the summary label on the wrapping `View`:

```typescript
// ❌ Bad: Props on SVG children are silently ignored
<G accessible accessibilityLabel="12 hour milestone, reached">
  <Line ... />
  <SvgText>12h</SvgText>
</G>

// ✅ Good: Summary on the parent View
<View
  accessibilityLabel={`Timer: ${timeDisplay}. Milestones: 2 of 4 reached`}
  accessibilityRole="timer"
>
  <Svg width={size} height={size}>
    {/* SVG elements are purely visual */}
  </Svg>
</View>
```

---

### Skip-First-Render Guard for Accessibility Announcements in Conditionally-Rendered Components

When a component is conditionally rendered (e.g. only while a stream is active) and announces its own internal state changes, it must skip the initial mount announcement to avoid double-firing with the parent's broader announcement.

```typescript
// ❌ Bad — fires immediately on mount, double-fires with parent
export function CoachStatusRow({ statusText }: { statusText: string }) {
  useEffect(() => {
    if (statusText) AccessibilityInfo.announceForAccessibility(statusText);
  }, [statusText]);
}

// ✅ Good — skips first value; only announces changes after mount
export function CoachStatusRow({ statusText }: { statusText: string }) {
  const prevStatusRef = useRef("");

  useEffect(() => {
    if (
      statusText &&
      prevStatusRef.current !== "" &&
      statusText !== prevStatusRef.current
    ) {
      AccessibilityInfo.announceForAccessibility(statusText);
    }
    prevStatusRef.current = statusText;
  }, [statusText]);
}
```

Because the component unmounts between sessions, `prevStatusRef.current` resets to `""` on each mount — the first value is always skipped, parent covers the initial announcement, and subsequent phase changes are announced normally.

References: `client/components/coach/CoachStatusRow.tsx`, `client/components/coach/CoachChat.tsx`
