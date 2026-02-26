// Mock react-native-reanimated for component render tests.
// Returns static values so components render without native animation runtime.
import React from "react";

export const useSharedValue = (init: number) => ({ value: init });
export const useAnimatedStyle = (fn: () => Record<string, unknown>) => fn();
export const withSpring = (val: number) => val;
export const withTiming = (val: number) => val;
export const withRepeat = (val: number) => val;
export const withDelay = (_delay: number, val: number) => val;
export const withSequence = (...vals: number[]) => vals[vals.length - 1];
export const cancelAnimation = () => {};
export const interpolate = (val: number) => val;
export const useReducedMotion = () => false;
export const runOnJS = (fn: (...args: unknown[]) => unknown) => fn;
export const runOnUI = (fn: (...args: unknown[]) => unknown) => fn;
export const useAnimatedRef = () => ({ current: null });
export const useDerivedValue = (fn: () => unknown) => ({ value: fn() });

// Easing functions (used by animations.ts)
const identity = (v: number) => v;
export const Easing = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  poly: () => identity,
  sin: identity,
  circle: identity,
  exp: identity,
  elastic: () => identity,
  back: () => identity,
  bounce: identity,
  bezier: () => identity,
  in: (_fn: (v: number) => number) => identity,
  out: (_fn: (v: number) => number) => identity,
  inOut: (_fn: (v: number) => number) => identity,
};

// Type exports used as interfaces by animations.ts
export type WithSpringConfig = Record<string, unknown>;
export type WithTimingConfig = Record<string, unknown>;

// Layout animations — return undefined so they're ignored
export const FadeIn = { delay: () => FadeIn, duration: () => FadeIn };
export const FadeInDown = {
  delay: () => FadeInDown,
  duration: () => FadeInDown,
};
export const FadeOut = { delay: () => FadeOut, duration: () => FadeOut };
export const FadeInUp = { delay: () => FadeInUp, duration: () => FadeInUp };
export const SlideInRight = {
  delay: () => SlideInRight,
  duration: () => SlideInRight,
};
export const SlideOutRight = {
  delay: () => SlideOutRight,
  duration: () => SlideOutRight,
};
export const LinearTransition = { duration: () => LinearTransition };

/** Map RN accessibility props to DOM aria attributes, stripping unknown DOM props. */
function mapA11yProps(props: Record<string, unknown>) {
  const {
    accessible: _accessible,
    accessibilityRole,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
    accessibilityValue: _av,
    entering: _entering,
    exiting: _exiting,
    layout: _layout,
    testID,
    ...domSafe
  } = props;
  return {
    ...domSafe,
    ...(testID ? { "data-testid": testID } : {}),
    ...(accessibilityRole ? { role: accessibilityRole as string } : {}),
    ...(accessibilityLabel
      ? { "aria-label": accessibilityLabel as string }
      : {}),
    ...(accessibilityHint ? { "aria-hint": accessibilityHint as string } : {}),
    ...((accessibilityState as Record<string, unknown> | undefined)?.disabled !=
      null && {
      "aria-disabled": (accessibilityState as Record<string, unknown>).disabled,
    }),
    ...((accessibilityState as Record<string, unknown> | undefined)?.selected !=
      null && {
      "aria-selected": (accessibilityState as Record<string, unknown>).selected,
    }),
    ...((accessibilityState as Record<string, unknown> | undefined)?.busy !=
      null && {
      "aria-busy": (accessibilityState as Record<string, unknown>).busy,
    }),
  };
}

/** Helper — wraps component so Animated.View etc. render as normal elements. */
function createAnimatedComponent(
  Component: React.ComponentType<Record<string, unknown>>,
) {
  const Wrapper = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => React.createElement(Component, { ...props, ref }),
  );
  Wrapper.displayName = `Animated(${(Component as { displayName?: string }).displayName || "Component"})`;
  return Wrapper;
}

/** Animated namespace */
const AnimatedView = React.forwardRef<unknown, Record<string, unknown>>(
  ({ children, ...rest }, ref) =>
    React.createElement("div", { ...mapA11yProps(rest), ref }, children),
);
AnimatedView.displayName = "Animated.View";

const AnimatedText = React.forwardRef<unknown, Record<string, unknown>>(
  ({ children, ...rest }, ref) =>
    React.createElement("span", { ...mapA11yProps(rest), ref }, children),
);
AnimatedText.displayName = "Animated.Text";

const Animated = {
  View: AnimatedView,
  Text: AnimatedText,
  createAnimatedComponent,
};

export default Animated;
