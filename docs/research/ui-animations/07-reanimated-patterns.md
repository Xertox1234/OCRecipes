# 07 — React Native / Reanimated 4 patterns

Reanimated 4 is the animation library for React Native that actually runs on
the UI thread. Reanimated 1 (legacy) is gone. Reanimated 2 and 3 introduced
worklets, shared values, and the modern hook-based API. Reanimated 4
(2024+) adds CSS animations support, refined Layout animations, and
improved type ergonomics.

OCRecipes uses Reanimated `~4.1.1` and Gesture Handler `~2.28.0`. This file
is the mental model and a snippet library that matches house conventions.

## The mental model in five concepts

### 1. Shared values

A shared value is a special box holding a number (or other JSON-serializable
value) that lives on both the JS thread and the UI thread. You read and
write it from either thread; the library keeps them in sync.

```ts
const scale = useSharedValue(1);
// Read on JS side: scale.value
// Read on UI thread (inside a worklet): scale.value
```

Mutating `scale.value` from a worklet is instant. Mutating it from JS is
also fine, but the change crosses the thread boundary.

You can mutate directly:

```ts
scale.value = 1.4;
```

Or mutate through an animation:

```ts
scale.value = withSpring(1.4);
scale.value = withTiming(1.4, { duration: 300 });
```

When you write `withSpring(target)`, Reanimated drives `scale.value` from
its current value to `target` over time, on the UI thread, with the spring
physics.

### 2. Worklets

A function that runs on the UI thread. Identified by:

- A `'worklet'` directive at the top of the function body, OR
- Being passed to a Reanimated hook that runs its argument as a worklet
  (`useAnimatedStyle`, `useAnimatedScrollHandler`, `useAnimatedReaction`,
  Gesture Handler callbacks).

Inside a worklet, you can read/write shared values, call `withSpring`,
call `runOnJS` to bounce back to JS. You can't call regular JS functions
that aren't worklets (you'll get a runtime error).

### 3. Animated styles

The bridge between shared values and view styles:

```ts
const animatedStyle = useAnimatedStyle(() => {
  // This body runs as a worklet, every frame, on the UI thread.
  return {
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  };
});

return <Animated.View style={[styles.box, animatedStyle]} />;
```

The view's style updates every frame on the UI thread without ever waking
the JS thread. This is why Reanimated animations are smooth.

### 4. Gesture Handler integration

Gesture Handler 2 is the gesture library that pairs with Reanimated.
Gesture handlers can directly drive shared values:

```ts
const translateX = useSharedValue(0);

const pan = Gesture.Pan()
  .onUpdate((e) => {
    'worklet';
    translateX.value = e.translationX;
  })
  .onEnd(() => {
    'worklet';
    translateX.value = withSpring(0);
  });

return (
  <GestureDetector gesture={pan}>
    <Animated.View style={[..., useAnimatedStyle(() => ({
      transform: [{ translateX: translateX.value }]
    }))]} />
  </GestureDetector>
);
```

Gestures and animations live on the UI thread together. No JS thread
involvement during the gesture.

### 5. Layout animations

Reanimated provides entering/exiting/layout animations that automatically
animate views when they're added, removed, or repositioned:

```ts
import Animated, { FadeIn, FadeOut, Layout } from "react-native-reanimated";

<Animated.View
  entering={FadeIn.duration(300).springify()}
  exiting={FadeOut.duration(200)}
  layout={Layout.springify()}
/>
```

This is what `SpeedDial.tsx` uses for staggered mini-FAB appearance.

## The snippet library

Every snippet here uses OCRecipes conventions. Theme imports, animation
config imports, accessibility handling, type discipline.

### Snippet 1: Press feedback (any tappable)

```tsx
import { Pressable, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { pressSpringConfig } from "@/constants/animations";

interface PressableScaleProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function PressableScale({
  onPress,
  children,
  style,
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.96, pressSpringConfig);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, pressSpringConfig);
      }}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
```

When to use: any tappable element where the default Pressable opacity
feedback isn't enough. Don't apply this to every Pressable in the app —
reserve for the ones the user will interact with most (primary CTAs, card
tap targets).

### Snippet 2: Success pop

The project already exports this via `useSuccessPop`. Reuse:

```tsx
import { useSuccessPop } from "@/hooks/useSuccessAnimation";
import Animated from "react-native-reanimated";

function FavoriteButton() {
  const { trigger, animatedStyle } = useSuccessPop(1.4);

  return (
    <Pressable onPress={trigger}>
      <Animated.View style={animatedStyle}>
        <HeartIcon />
      </Animated.View>
    </Pressable>
  );
}
```

### Snippet 3: Shimmer skeleton

```tsx
import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Colors, BorderRadius } from "@/constants/theme";

interface SkeletonProps {
  width: number;
  height: number;
}

export function Skeleton({ width, height }: SkeletonProps) {
  const { reducedMotion } = useAccessibility();
  const translateX = useSharedValue(-width);

  useEffect(() => {
    if (reducedMotion) return;
    translateX.value = withRepeat(
      withTiming(width, {
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
      }),
      -1, // infinite
      false,
    );
    return () => {
      cancelAnimation(translateX);
    };
  }, [reducedMotion, translateX, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={[styles.container, { width, height }]}>
      {!reducedMotion && (
        <Animated.View style={[styles.shimmer, { width }, animatedStyle]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  shimmer: {
    height: "100%",
    backgroundColor: Colors.light.backgroundTertiary,
    opacity: 0.6,
  },
});
```

When to use: any loading state expected to take 150–2000 ms. Set the
dimensions to match the eventual content shape.

### Snippet 4: Staggered list entrance

```tsx
import Animated, { FadeInDown } from "react-native-reanimated";
import { speedDialStaggerDelay } from "@/constants/animations";

interface ItemProps {
  index: number;
  item: { id: string; name: string };
}

function ListItem({ index, item }: ItemProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * speedDialStaggerDelay)
        .duration(300)
        .springify()
        .damping(15)
        .stiffness(150)}
    >
      <Text>{item.name}</Text>
    </Animated.View>
  );
}
```

When to use: first render of a list of 2–6 items. Disable the stagger past
6 items (set delay to 0) — it starts feeling slow.

Note: layout animations under `reducedMotion` are _automatically_ skipped
by Reanimated 4 when the OS preference is on. You don't need to check
manually.

### Snippet 5: Swipe-to-dismiss

The project's Toast component already implements this. Reference for
similar surfaces:

```tsx
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { swipeActionThreshold } from "@/constants/animations";

interface SwipeToDismissProps {
  onDismiss: () => void;
  children: React.ReactNode;
}

export function SwipeToDismiss({ onDismiss, children }: SwipeToDismissProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      "worklet";
      translateX.value = event.translationX;
      // Fade out as the user drags further
      opacity.value = Math.max(0.3, 1 - Math.abs(event.translationX) / 200);
    })
    .onEnd((event) => {
      "worklet";
      if (Math.abs(event.translationX) > swipeActionThreshold) {
        // Past threshold — fly off-screen and dismiss
        translateX.value = withTiming(event.translationX > 0 ? 400 : -400, {
          duration: 200,
        });
        opacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(onDismiss)();
        });
      } else {
        // Under threshold — spring back
        translateX.value = withSpring(0);
        opacity.value = withSpring(1);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
```

When to use: dismissible cards (toast, banner), list rows where a swipe
should remove. Provide a tap-to-close button as well for accessibility.

### Snippet 6: Scroll-driven header

```tsx
import {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import Animated from "react-native-reanimated";

const HEADER_MAX = 200;
const HEADER_MIN = 80;

function ScrollScreen() {
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
    },
  });

  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(
      scrollY.value,
      [0, HEADER_MAX - HEADER_MIN],
      [HEADER_MAX, HEADER_MIN],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <>
      <Animated.View style={[styles.header, headerStyle]} />
      <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16}>
        {/* content */}
      </Animated.ScrollView>
    </>
  );
}
```

When to use: long content screens where the header is overhead. Set the
header's animated height with `interpolate` and `Extrapolation.CLAMP` so
the value pins at the min/max.

Caveat: animating `height` is a layout change, slightly more expensive
than transforms. Alternative: keep the header fixed height and animate
its content's opacity/transform instead.

### Snippet 7: Number ticker

```tsx
import { useEffect } from "react";
import { TextInput } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from "react-native-reanimated";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface TickerProps {
  value: number;
  duration?: number;
}

export function NumberTicker({ value, duration = 600 }: TickerProps) {
  const animatedValue = useSharedValue(0);

  useEffect(() => {
    animatedValue.value = withTiming(value, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [value, duration, animatedValue]);

  const animatedProps = useAnimatedProps(() => {
    return {
      text: Math.round(animatedValue.value).toString(),
      defaultValue: Math.round(animatedValue.value).toString(),
    } as any;
  });

  return (
    <AnimatedTextInput
      editable={false}
      animatedProps={animatedProps}
      // styling via props
    />
  );
}
```

Why `AnimatedTextInput`? Because `Text` doesn't accept animated props for
its content. The trick: an `editable={false}` TextInput renders identically
to Text but can be driven via animated props.

When to use: counts that should "tick up" — daily calories logged, protein
totals, streak counter, etc. Don't use for static numbers; only on the
moment of update.

### Snippet 8: Modal entrance / exit (built-in)

For modals registered via React Navigation, the entrance/exit is the OS
default (`slide_from_bottom` on `presentation: "modal"` or
`"fullScreenModal"`). You don't write code for this — you write nav
options.

```tsx
<Stack.Screen
  name="MyModal"
  component={MyModalScreen}
  options={{
    presentation: "modal",
    animation: reducedMotion ? "none" : "slide_from_bottom",
    gestureEnabled: true,
  }}
/>
```

Note the `animation: reducedMotion ? "none" : "slide_from_bottom"` pattern
— OCRecipes' existing modals use this for the reducedMotion fallback.

### Snippet 9: Layout animation on a list item change

```tsx
import Animated, { Layout, FadeIn, FadeOut } from "react-native-reanimated";

function TaskItem({ task }: { task: Task }) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      layout={Layout.springify()}
    >
      {/* content */}
    </Animated.View>
  );
}
```

When the parent list reorders, the surviving items animate to their new
positions via `layout={Layout.springify()}`. Removed items animate out via
`exiting={FadeOut}`. New items animate in via `entering={FadeIn}`.

This is the cheapest way to add reorder animations to a `FlatList`-style
list — you just put these props on the row and Reanimated handles the rest.

### Snippet 10: Conditional animation depending on reducedMotion

```tsx
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    // Skip animation, snap to end state
    rotation.value = 360;
    return;
  }
  rotation.value = withRepeat(
    withTiming(360, { duration: 2000, easing: Easing.linear }),
    -1,
  );
  return () => {
    cancelAnimation(rotation);
  };
}, [reducedMotion, rotation]);
```

The pattern: check reducedMotion early, snap to end state, return. Otherwise
start the animation and provide a cleanup.

## Common pitfalls

### Forgetting `'worklet'` in gesture callbacks

Gesture Handler 2 callbacks run as worklets. Forgetting the directive
won't always error immediately — it'll error when you try to use a
worklet-only API inside.

### Capturing React state in a worklet

```ts
// BAD
const [count, setCount] = useState(0);
const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ translateX: count }], // Captures count at definition time
}));
```

Solution: convert to a shared value, or use `useDerivedValue`.

### Mutating a shared value's `.value` from inside an animated style callback

```ts
// BAD — infinite loop potential
const animatedStyle = useAnimatedStyle(() => {
  scale.value = scale.value + 1;
  return { ... };
});
```

`useAnimatedStyle` should be pure — read shared values, return a style.
Mutation belongs in event handlers, `useDerivedValue`, or
`useAnimatedReaction`.

### Forgetting to cancel infinite repeats

`withRepeat(..., -1)` runs forever until the component unmounts. Add
`cancelAnimation(sharedValue)` in `useEffect` cleanup. Otherwise: memory
leak, frame drops on backgrounded screens.

### Mixing legacy `Animated.Value` with Reanimated `useSharedValue`

These are different systems. They don't interop. Pick one per component —
Reanimated for anything new.

## When to NOT use Reanimated

Some animations are simpler with built-in tools:

- **`Pressable`'s built-in pressed state** for trivial press feedback. The
  Reanimated approach is more controllable, but the built-in is one line.
- **`LayoutAnimation` (React Native core)** for simple list animations
  where you don't need fine control. Lighter weight than Reanimated's
  `Layout` API.
- **React Navigation's built-in transition options** for screen-to-screen
  motion. Don't reinvent.
- **CSS-style animations on web targets** if you happen to be running RN
  Web (not OCRecipes' case, but worth noting).

If a built-in works, use it. Reach for Reanimated when you need worklet
performance, gesture-driven motion, or fine choreography control.
