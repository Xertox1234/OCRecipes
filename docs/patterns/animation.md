# Animation Patterns

### Shared Animation Configuration

Define animation configs in a central location for consistency:

```typescript
// client/constants/animations.ts
import {
  WithSpringConfig,
  WithTimingConfig,
  Easing,
} from "react-native-reanimated";

// Spring configs for press feedback
export const pressSpringConfig: WithSpringConfig = {
  damping: 15,
  stiffness: 150,
};

// Timing configs for expand/collapse animations
export const expandTimingConfig: WithTimingConfig = {
  duration: 300,
  easing: Easing.out(Easing.cubic),
};

export const collapseTimingConfig: WithTimingConfig = {
  duration: 250,
  easing: Easing.in(Easing.cubic),
};

export const contentRevealTimingConfig: WithTimingConfig = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
};
```

**Usage:**

```typescript
import { pressSpringConfig, expandTimingConfig } from "@/constants/animations";

const handlePressIn = () => {
  scale.value = withSpring(0.98, pressSpringConfig);
};

const handleExpand = () => {
  height.value = withTiming(200, expandTimingConfig);
};
```

**Why:** Consistent animation feel across the app. Changing parameters in one place updates all related animations.

**Intent-specific configs:** Different animation intents need different spring parameters. `pressSpringConfig` uses `overshootClamping: true` because a pressed button should never bounce larger than its resting size. But a "pop" effect (scale up then settle) relies on natural spring overshoot for a lively feel — use a separate config with `overshootClamping: false`.

```typescript
// Press feedback — clamp overshoot (button should not grow when pressed)
export const pressSpringConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
};

// Pop effect — allow overshoot (bounce makes it feel alive)
export const tabIconPopConfig: WithSpringConfig = {
  damping: 12,
  mass: 0.4,
  stiffness: 200,
  overshootClamping: false,
};
```

### Pop-Then-Settle with `withSequence`

For a "pop" effect where an element scales up briefly then returns to rest (e.g. tab icon focus, badge count change, favorite heart), use `withSequence` + `withDelay` to keep the entire animation on the UI thread. Never use `setTimeout` to chain Reanimated animations — it crosses the JS bridge and is subject to thread contention.

```typescript
import { withSequence, withDelay, withSpring } from "react-native-reanimated";
import { tabIconPopConfig } from "@/constants/animations";

// Good: entire chain runs on the UI thread
useEffect(() => {
  if (focused && !reducedMotion) {
    scale.value = withSequence(
      withSpring(1.18, tabIconPopConfig), // pop up
      withDelay(100, withSpring(1, tabIconPopConfig)), // settle back
    );
  } else {
    scale.value = 1;
  }
}, [focused, reducedMotion, scale]);
```

```typescript
// Bad: setTimeout crosses the JS bridge
useEffect(() => {
  if (focused && !reducedMotion) {
    scale.value = withSpring(1.18, tabIconPopConfig);
    const timer = setTimeout(() => {
      scale.value = withSpring(1, tabIconPopConfig); // ❌ JS thread dependency
    }, 150);
    return () => clearTimeout(timer);
  }
  scale.value = 1;
}, [focused, reducedMotion, scale]);
```

**When to use:** One-shot "pop" feedback when a state becomes active — tab focus, item favorited, badge count increment, selection confirmation.

**When NOT to use:** Continuous press feedback (use single `withSpring` to 0.98/1 on pressIn/pressOut) or repeating pulses (use `withRepeat`).

**Key elements:**

1. **`withSequence`** — composes multiple animations into a single UI-thread chain
2. **`withDelay`** — adds a pause between the pop and the settle, letting the user perceive the peak
3. **`overshootClamping: false`** — allows the spring to slightly exceed the target for a natural bounce
4. **`reducedMotion` guard** — snap directly to rest state (no animation)

**References:**

- `client/navigation/MainTabNavigator.tsx` — `AnimatedTabIcon` pop on tab focus
- `client/constants/animations.ts` — `tabIconPopConfig`

### Expandable Card with Lazy-Loaded Content

For cards that expand to show additional content fetched on-demand:

```typescript
type CardState = "collapsed" | "loading" | "expanded";

function ExpandableCard({ itemId }: { itemId: number }) {
  const { reducedMotion } = useAccessibility();
  const [cardState, setCardState] = useState<CardState>("collapsed");
  const animatedHeight = useSharedValue(0);

  // Fetch content only when expanded
  const { data, error } = useQuery({
    queryKey: [`/api/items/${itemId}/details`],
    enabled: cardState === "loading" || cardState === "expanded",
    staleTime: 30 * 60 * 1000, // Cache for 30 minutes
  });

  // Transition to expanded when data arrives
  useEffect(() => {
    if (cardState === "loading" && data) {
      setCardState("expanded");
    }
  }, [cardState, data]);

  // Collapse on error
  useEffect(() => {
    if (cardState === "loading" && error) {
      setCardState("collapsed");
    }
  }, [cardState, error]);

  const handlePress = useCallback(() => {
    if (cardState === "collapsed") {
      setCardState("loading");
      if (!reducedMotion) {
        animatedHeight.value = withTiming(200, expandTimingConfig);
      }
    } else if (cardState === "expanded") {
      setCardState("collapsed");
      if (!reducedMotion) {
        animatedHeight.value = withTiming(0, collapseTimingConfig);
      }
    }
    // Don't toggle while loading
  }, [cardState, reducedMotion, animatedHeight]);

  // ...render with animated height
}
```

**When to use:**

- Cards with "show more" content that requires API fetch
- Recipe/activity suggestions with detailed instructions
- List items that expand to show full details

**Key elements:**

- Three-state machine: `collapsed` → `loading` → `expanded`
- TanStack Query's `enabled` flag for on-demand fetching
- Longer `staleTime` since content is deterministic once generated
- Animated height respecting reduced motion

### Extracted Content for Animation Branches

When the same content appears in both animated and non-animated (reduced motion) code paths, extract it into a separate component to avoid duplication:

```typescript
// Good: Shared content extracted
interface ExpandedContentProps {
  isLoading: boolean;
  data: ContentData | undefined;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function ExpandedContent({ isLoading, data, onLayout }: ExpandedContentProps) {
  if (isLoading) {
    return (
      <View accessibilityLabel="Loading content" accessibilityRole="progressbar">
        <ActivityIndicator />
      </View>
    );
  }

  if (data) {
    return (
      <View onLayout={onLayout}>
        <Text>{data.content}</Text>
      </View>
    );
  }

  return null;
}

// Usage - same content, different wrappers
{reducedMotion ? (
  (isLoading || isExpanded) && (
    <View>
      <ExpandedContent isLoading={isLoading} data={data} onLayout={handleLayout} />
    </View>
  )
) : (
  <Animated.View style={animatedStyle}>
    <ExpandedContent isLoading={isLoading} data={data} onLayout={handleLayout} />
  </Animated.View>
)}
```

```typescript
// Bad: Duplicated content in both branches
{reducedMotion ? (
  (isLoading || isExpanded) && (
    <View>
      {isLoading ? (
        <ActivityIndicator /> // Duplicated
      ) : data ? (
        <Text>{data.content}</Text> // Duplicated
      ) : null}
    </View>
  )
) : (
  <Animated.View style={animatedStyle}>
    {isLoading ? (
      <ActivityIndicator /> // Duplicated
    ) : data ? (
      <Text>{data.content}</Text> // Duplicated
    ) : null}
  </Animated.View>
)}
```

**Why:** Reduces maintenance burden - changes to content structure only need to be made in one place.

**When to use:** Any component with conditional animation that wraps the same content in `Animated.View` vs regular `View`.

### Circular Progress with Animated SVG Arc

When building a circular timer or progress indicator, use `react-native-svg` for the circle geometry and Reanimated's `useAnimatedProps` to animate the `strokeDashoffset`. This avoids re-rendering the entire component on each progress tick.

```typescript
// client/components/FastingTimer.tsx
import Svg, { Circle } from "react-native-svg";
import Animated, { useSharedValue, useAnimatedProps, withTiming } from "react-native-reanimated";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const FastingTimer = React.memo(function FastingTimer({
  elapsedMinutes, targetHours, size = 240,
}: FastingTimerProps) {
  const { reducedMotion } = useAccessibility();

  const targetMinutes = targetHours * 60;
  const progress = Math.min(elapsedMinutes / targetMinutes, 1);
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const animatedProgress = useSharedValue(0);

  useEffect(() => {
    animatedProgress.value = reducedMotion
      ? progress
      : withTiming(progress, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [progress, reducedMotion, animatedProgress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animatedProgress.value),
  }));

  return (
    <View style={{ width: size, height: size }} accessibilityRole="timer">
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle cx={center} cy={center} r={radius}
          stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        {/* Animated progress arc */}
        <AnimatedCircle cx={center} cy={center} r={radius}
          stroke={progressColor} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`} />
      </Svg>
      {/* Center text overlay with absoluteFill */}
      <View style={StyleSheet.absoluteFillObject}>
        <ThemedText>{timeDisplay}</ThemedText>
      </View>
    </View>
  );
});
```

**Key elements:**

1. **`Animated.createAnimatedComponent(Circle)`** — wraps SVG Circle for Reanimated prop animation
2. **`strokeDasharray` + `strokeDashoffset`** — the SVG technique for drawing partial arcs. Set `strokeDasharray` to the full circumference, then offset to hide the remaining portion
3. **`transform: rotate(-90)`** — rotates the arc to start from 12 o'clock (SVG arcs start at 3 o'clock by default)
4. **`accessibilityRole="timer"`** — tells screen readers this is a timer element
5. **Respect `reducedMotion`** — skip animation and set progress directly when the user prefers reduced motion
6. **Center overlay with `absoluteFillObject`** — time text is positioned absolutely over the SVG for centering

**When to use:** Circular progress indicators, countdown timers, activity rings, score displays.

**When NOT to use:** Linear progress bars (use `Animated.View` width instead) or simple percentage displays.

**Reference:** `client/components/FastingTimer.tsx`

### Animated List Items with Independent Shared Values

When rendering a `.map()` of items that each need their own Reanimated animation (e.g. progress bars, fade-ins), extract a child component. Each component instance gets its own `useSharedValue` through React's component model. Keeping `useSharedValue` inside a `.map()` callback violates the rules of hooks.

```typescript
// ❌ BAD — hooks inside .map()
{macros.map((macro) => {
  const width = useSharedValue(0); // Rules of hooks violation
  return <Animated.View style={{ width }} />;
})}

// ✅ GOOD — extract component, each instance owns its shared value
function MacroProgressBar({ macro }: { macro: MacroInfo }) {
  const animatedWidth = useSharedValue(0);
  const progress = macro.goal > 0
    ? Math.min(macro.current / macro.goal, 1)
    : 0;

  useEffect(() => {
    animatedWidth.value = reducedMotion
      ? progress
      : withTiming(progress, {
          duration: 800,
          easing: Easing.out(Easing.cubic),
        });
  }, [progress, reducedMotion, animatedWidth]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${animatedWidth.value * 100}%`,
  }));

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, fillStyle]} />
    </View>
  );
}

// Parent renders normally:
{macros.map((m) => <MacroProgressBar key={m.label} macro={m} />)}
```

**When to use:** Any list of animated items — progress bars, staggered card entries, animated counters.

**Reference:** `client/screens/DailyNutritionDetailScreen.tsx` (`MacroProgressBar`)

### Volume-Reactive Animation for Active State Indicators

When a component has an "active" state driven by a continuous value (e.g. microphone volume), map the value to a scale factor using `withTiming` for smooth transitions. Cancel the animation cleanly when the state becomes inactive. Extract the mapping function to a shared utility (`client/lib/volume-scale.ts`) to avoid duplication.

```typescript
// client/lib/volume-scale.ts
export const VOLUME_SILENT = -2;

export function volumeToScale(vol: number, maxScale: number): number {
  "worklet";
  const clamped = Math.max(-2, Math.min(10, vol));
  return 1.0 + ((clamped + 2) / 12) * maxScale;
}

// client/components/VoiceLogButton.tsx
import { volumeToScale } from "@/lib/volume-scale";

const scale = useSharedValue(1);

React.useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(scale);
    scale.value = 1;
    return;
  }
  if (isListening) {
    // Scale reactively to volume: 1.0 at silent, 1.2 at max volume
    scale.value = withTiming(volumeToScale(volume, 0.2), { duration: 100 });
  } else {
    cancelAnimation(scale);
    scale.value = withTiming(1, { duration: 200 });
  }
}, [isListening, volume, scale, reducedMotion]);
```

**Key elements:**

1. **`volumeToScale(vol, maxScale)`** — shared worklet maps volume (-2..10) to scale (1.0..1.0+maxScale)
2. **`cancelAnimation(scale)`** — stops the current animation before starting a new one to prevent conflicts
3. **Fast `withTiming` (100ms)** — keeps the scale responsive to rapid volume changes
4. **Quick settle on deactivation** — `withTiming(1, { duration: 200 })` returns to rest quickly
5. **`reducedMotion` guard** — skip all scale animation when reduced motion is enabled

**When to use:** Microphone volume indicators, audio level meters, any continuous-value-driven animation.

**For fixed pulsing** (syncing, processing without a continuous value), use `withRepeat` + `withTiming` instead:

```typescript
scale.value = withRepeat(withTiming(1.15, { duration: 600 }), -1, true);
```

**When NOT to use:** Loading spinners (use `ActivityIndicator` instead) or one-shot entrance animations (use `entering` prop).

**References:**

- `client/components/VoiceLogButton.tsx` — volume-reactive mic button (maxScale 0.2)
- `client/components/InlineMicButton.tsx` — volume-reactive inline mic (maxScale 0.3)
- `client/lib/volume-scale.ts` — shared volume-to-scale utility
- `client/components/ChatBubble.tsx` — typing indicator pulse (withRepeat)
- `client/screens/ScanScreen.tsx` — scan active pulse (withRepeat)

### Layout Animation Chained API (Not WithSpringConfig)

Reanimated v4 layout animations (`FadeInUp`, `SlideInRight`, etc.) use a **chained builder API** — they do NOT accept `WithSpringConfig` objects. Do not extract their spring parameters into shared config objects.

```typescript
// Bad: Layout animations can't use WithSpringConfig objects
import { pressSpringConfig } from "@/constants/animations";
const entering = SlideInRight.springify(pressSpringConfig); // ❌ Won't work

// Good: Chain modifiers directly on the layout animation
const entering = SlideInRight.springify().damping(18).stiffness(150);

// Good: Use WithSpringConfig for imperative animations only
scale.value = withSpring(1, pressSpringConfig); // ✅ withSpring accepts config objects
```

**When to use:** Any time you're configuring layout entrance/exit animations (`entering`, `exiting` props).

**When NOT to use:** Imperative animations via `withSpring()` / `withTiming()` — those accept config objects and should use shared constants from `animations.ts`.

**Why:** Layout animations return builder objects with fluent methods (`.springify()`, `.damping()`, `.duration()`). Creating `WithSpringConfig` objects for them produces dead code that TypeScript won't catch.

**References:**

- `client/components/ChatBubble.tsx` — `SlideInRight.springify().damping(18).stiffness(150)`
- `client/components/Toast.tsx` — `SlideInUp.springify().damping(20).stiffness(200)`

## Interaction Patterns

### Navigator-Level Safe Area Ownership

Apply safe area insets at the **navigator level**, not in individual screens. This prevents double-inset bugs when a navigator wraps multiple screens.

```typescript
// Good: Navigator owns insets.top
function OnboardingStack() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <ProgressBar />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* screens don't apply insets.top */}
      </Stack.Navigator>
    </View>
  );
}

// In each screen — only add content padding, not safe area
<ScrollView contentContainerStyle={{ paddingTop: Spacing["3xl"] }}>
```

```typescript
// Bad: Both navigator AND screen apply insets.top
// Navigator:
<View style={{ paddingTop: insets.top }}> ...
// Screen:
<ScrollView contentContainerStyle={{ paddingTop: insets.top + Spacing["3xl"] }}>
// Result: 2× safe area padding
```

**When to use:** Custom navigators that wrap screens in a shared container (onboarding flows, wizards, tab navigators with custom headers).

**When NOT to use:** Screens under `headerShown: true` navigators — React Navigation handles the header inset automatically.

**References:**

- `client/navigation/OnboardingNavigator.tsx` — owns `insets.top` for all 6 onboarding screens

### Gesture Interaction with Reduced Motion Component Fallback

When a component's primary interaction is gesture-based (swipe, drag, pan), provide a **structurally different fallback** with visible action buttons when reduced motion is enabled — don't just skip the animation and hide the actions.

```typescript
function SwipeableRow({ children, rightAction, leftAction }: Props) {
  const { reducedMotion } = useAccessibility();

  // Reduced motion: render inline action buttons (visible, tappable)
  if (reducedMotion) {
    const hasActions = leftAction || rightAction;
    if (!hasActions) return <View>{children}</View>;

    return (
      <View>
        {children}
        <ReducedMotionActions leftAction={leftAction} rightAction={rightAction} />
      </View>
    );
  }

  // Full interaction: gesture-driven swipeable with animations
  return (
    <ReanimatedSwipeable ...>
      {children}
    </ReanimatedSwipeable>
  );
}
```

The `ReducedMotionActions` component renders small pill buttons with the action's icon, label, color, and `accessibilityRole="button"`. Buttons must meet the 44pt minimum touch target (`minHeight: 44`).

**When to use:** Components where the gesture IS the feature (swipe-to-delete, drag-to-reorder, swipe navigation). The gesture wrapper adds complexity and native gesture recognizers that serve no purpose when motion is reduced.

**When NOT to use:** Simple press animations or entrance animations — use the existing `reducedMotion ? undefined : animation` guard pattern instead.

**Key principle:** Ensure all actions reachable via gesture are also reachable via visible buttons. Never hide actions behind a gesture with no fallback — screen reader users and motion-sensitive users must have an equivalent path.

**References:**

- `client/components/SwipeableRow.tsx` — inline `ReducedMotionActions` buttons
- `client/components/DraggableList.tsx` — tap-to-activate reorder with chevron buttons (no drag gesture)

### Toast Context with Single-Toast Replacement

For global toast/snackbar notifications, use a context provider with a **single-toast replacement strategy** — each new toast replaces the previous one instead of stacking.

```typescript
function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  // Replace (not append) — prevents toast pile-up from rapid actions
  const show = useCallback((message: string, variant: ToastVariant) => {
    const id = nextId.current++;
    setToasts([{ id, message, variant }]);
  }, []);

  // Stable dismiss — no per-id closure needed with single toast
  const dismiss = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      {toasts.length > 0 && (
        <Toast
          key={toasts[0].id}
          message={toasts[0].message}
          variant={toasts[0].variant}
          onDismiss={dismiss}
        />
      )}
    </ToastContext.Provider>
  );
}
```

**When to use:** App-wide toast/snackbar systems where only the most recent message matters.

**When NOT to use:** Notification centers where users need to see multiple messages (use a queue with max visible count instead).

**Key details:**

1. **`setToasts([newItem])` not `setToasts(prev => [...prev, newItem])`** — prevents stacking
2. **Stable `dismiss` callback** — `useCallback(() => setToasts([]), [])` avoids creating closures per toast ID
3. **`key={toasts[0].id}`** forces React to unmount/remount on replacement, triggering the entrance animation
4. **Place `<ToastProvider>` inside `ThemeProvider`** — toasts need theme context for colors

**References:**

- `client/context/ToastContext.tsx` — provider implementation
- `client/components/Toast.tsx` — animated toast with swipe-to-dismiss and auto-dismiss

### Trigger-Once Success Animation Hooks

For brief, non-blocking visual feedback on user actions (food logged, item favorited, barcode scanned), use a hook that returns `{ trigger, animatedStyle }`. The parent calls `trigger()` and applies `animatedStyle` — no state management needed.

Two variants:

**Flash** — brief opacity pulse on a background overlay (e.g., green flash on scan success):

```typescript
// client/hooks/useSuccessAnimation.ts
export function useSuccessFlash(color: string, duration = 300) {
  const opacity = useSharedValue(0);
  const reduced = useReducedMotion();

  const trigger = useCallback(() => {
    if (reduced) return;
    opacity.value = withSequence(
      withTiming(0.15, { duration: duration / 2 }),
      withTiming(0, { duration: duration / 2 }),
    );
  }, [reduced, duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: color,
    opacity: opacity.value,
  }));

  return { trigger, animatedStyle };
}
```

**Pop** — scale bounce on an icon (e.g., heart icon on favourite):

```typescript
export function useSuccessPop(maxScale = 1.4) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const trigger = useCallback(() => {
    if (reduced) return;
    scale.value = withSequence(
      withSpring(maxScale, successPopConfig),
      withSpring(1, successPopConfig),
    );
  }, [reduced, maxScale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { trigger, animatedStyle };
}
```

**Key elements:**

1. **`trigger` is stable** — memoized with `useCallback`, safe as an effect dependency
2. **GPU-bound** — only `opacity` and `transform` properties, no layout recalculation
3. **≤300ms duration** — fast enough to not block interaction
4. **`reducedMotion` guard** — `trigger()` is a no-op when reduced motion is active
5. **Parent applies style** — `<Animated.View style={[styles.overlay, animatedStyle]} />`

**When to use:** Inline success feedback on the triggering element (scan reticle, favourite button, log confirmation). Use _instead of_ distant toasts for actions where spatial feedback matters.

**When NOT to use:** Error feedback (use Toast), multi-step confirmation flows, or animations that should persist (use state-driven animation instead).

**References:**

- `client/hooks/useSuccessAnimation.ts` — `useSuccessFlash`, `useSuccessPop`
- `client/constants/animations.ts` — `successPopConfig`, `successFlashConfig`
- `client/components/AnimatedCheckmark.tsx` — self-drawing SVG checkmark (SVG `strokeDashoffset` variant)
- `client/screens/ScanScreen.tsx` — green flash on barcode scan
- `client/components/RecipeActionBar.tsx` — heart pop on favourite

### Scroll-Linked Collapsing Headers

For screens with large headers that consume vertical space, collapse them based on scroll position using `useAnimatedScrollHandler`. Unlike tap-driven expand/collapse (see "Collapsible Section" pattern), this is driven continuously by scroll offset.

```typescript
// client/hooks/useScrollLinkedHeader.ts
export function useScrollLinkedHeader(threshold = 100) {
  const scrollY = useSharedValue(0);
  const reduced = useReducedMotion();
  const [isBarVisible, setIsBarVisible] = useState(false);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      // Sync JS-side state for pointerEvents toggling
      runOnJS(setIsBarVisible)(event.contentOffset.y > threshold * 0.8);
    },
  });

  const headerStyle = useAnimatedStyle(() => {
    if (reduced) return {}; // Stay fully expanded
    return {
      height: interpolate(
        scrollY.value,
        [0, threshold],
        [EXPANDED_HEIGHT, 0],
        Extrapolation.CLAMP,
      ),
      opacity: interpolate(
        scrollY.value,
        [0, threshold * 0.6],
        [1, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  const barStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0 };
    return {
      opacity: interpolate(
        scrollY.value,
        [threshold * 0.6, threshold],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
  });

  return { scrollHandler, headerStyle, barStyle, isBarVisible };
}
```

**Usage in a screen:**

```tsx
const { scrollHandler, headerStyle, barStyle, isBarVisible } =
  useScrollLinkedHeader(120);

<View>
  {/* Collapsed bar — always rendered, opacity-driven */}
  <Animated.View
    style={[styles.collapsedBar, barStyle]}
    pointerEvents={isBarVisible ? "auto" : "none"}
  >
    <CalorieSummaryCompact />
  </Animated.View>

  <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16}>
    {/* Expandable header — collapses as user scrolls */}
    <Animated.View style={headerStyle}>
      <DailySummaryHeader />
    </Animated.View>

    {/* Main content */}
    <ContentList />
  </Animated.ScrollView>
</View>;
```

**Key elements:**

1. **`scrollEventThrottle={16}`** — 60fps scroll event delivery (required for smooth animation)
2. **`Extrapolation.CLAMP`** — prevents over-collapse or negative values
3. **`runOnJS(setIsBarVisible)`** — bridges UI thread scroll offset to JS thread for `pointerEvents`
4. **`pointerEvents="none"`** — prevents invisible collapsed bar from intercepting touches
5. **Two-phase opacity** — header fades out before full collapse, bar fades in after partial collapse, avoiding a "gap" where neither is visible
6. **`reducedMotion`** — header stays fully expanded, bar stays hidden

**When to use:** Screens with large fixed headers where content scrolls vertically (Home, Profile, Recipe Browser).

**When NOT to use:** Screens with horizontal scroll (swipe conflicts), screens with very short content (nothing to scroll), or screens where the header contains interactive controls that must always be visible.

**References:**

- `client/hooks/useScrollLinkedHeader.ts` — reusable hook
- `client/screens/HomeScreen.tsx` — DailySummaryHeader collapse
- `client/screens/ProfileScreen.tsx` — ProfileCard collapse
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — filter chip collapse

---

## Gate `runOnJS` on Shared-Value Transitions, Not on Every Frame

`useAnimatedScrollHandler.onScroll` fires at 60Hz during scroll. Calling
`runOnJS(setState)(value)` unconditionally inside the worklet bridges to
the JS thread every frame, causing unnecessary re-renders of the owning
component (and all children).

```typescript
// ❌ Bad: runOnJS fires every scroll frame, even when the value didn't change
const scrollHandler = useAnimatedScrollHandler({
  onScroll: (event) => {
    scrollY.value = event.contentOffset.y;
    const barShouldBeVisible = event.contentOffset.y > threshold;
    runOnJS(updateBarVisibility)(barShouldBeVisible);
  },
});
```

```typescript
// ✅ Good: track the last-reported value on the UI thread; only cross the
// bridge when it transitions
const lastBarVisible = useSharedValue(false);

const scrollHandler = useAnimatedScrollHandler({
  onScroll: (event) => {
    scrollY.value = event.contentOffset.y;
    const barShouldBeVisible = event.contentOffset.y > threshold;
    if (barShouldBeVisible !== lastBarVisible.value) {
      lastBarVisible.value = barShouldBeVisible;
      runOnJS(updateBarVisibility)(barShouldBeVisible);
    }
  },
});
```

**Why:** The `useSharedValue` comparison happens entirely on the UI thread
— no JS bridge crossing. Only the transition (boolean flip, bucket change,
threshold crossing) warrants a JS re-render. For a boolean that flips at
most a few times per scroll gesture, this drops JS bridge traffic from
60Hz to 2–3 events total.

**When to apply:** Any `runOnJS` inside a Reanimated scroll/gesture/
animated handler where the value derived on the UI thread is a discrete
state (boolean, bucket, category) rather than a continuous animated value.
For continuous values, prefer driving animation entirely via
`useAnimatedStyle` without ever touching JS state.

**Origin:** 2026-04-17 audit H14 — `useScrollLinkedHeader` was firing
`runOnJS(updateBarVisibility)` on every `onScroll`, causing 60Hz JS-thread
re-renders of `ProfileScreen` / `RecipeBrowserScreen` during scroll.
