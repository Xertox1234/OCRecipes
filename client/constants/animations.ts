import {
  WithSpringConfig,
  WithTimingConfig,
  Easing,
} from "react-native-reanimated";

/**
 * Shared animation configurations for consistent UI interactions.
 */

/** Spring configuration for press feedback animations */
export const pressSpringConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

/** Timing configuration for expand animations */
export const expandTimingConfig: WithTimingConfig = {
  duration: 300,
  easing: Easing.out(Easing.cubic),
};

/** Timing configuration for collapse animations */
export const collapseTimingConfig: WithTimingConfig = {
  duration: 250,
  easing: Easing.in(Easing.cubic),
};

/** Timing configuration for content reveal after expand */
export const contentRevealTimingConfig: WithTimingConfig = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
};

/** Spring configuration for toast entry animation */
export const toastSpringConfig: WithSpringConfig = {
  damping: 20,
  mass: 0.4,
  stiffness: 200,
};

/** Timing configuration for toast exit animation */
export const toastExitTimingConfig: WithTimingConfig = {
  duration: 200,
  easing: Easing.in(Easing.cubic),
};

/** Timing configuration for input focus transitions (border color, floating label) */
export const focusTimingConfig: WithTimingConfig = {
  duration: 160,
  easing: Easing.out(Easing.cubic),
};

/** Spring configuration for tab icon focus pop — allows overshoot for playful bounce */
export const tabIconPopConfig: WithSpringConfig = {
  damping: 12,
  mass: 0.4,
  stiffness: 200,
  overshootClamping: false,
};

/** Pixels threshold to trigger swipe action */
export const swipeActionThreshold = 80;

/** Milliseconds between mini-FAB stagger appearances */
export const speedDialStaggerDelay = 50;

/** Pixels threshold to trigger date strip week change */
export const dateStripSwipeThreshold = 50;

/** Spring configuration for the date strip settling back after a swipe */
export const dateStripSnapBackSpringConfig: WithSpringConfig = {
  damping: 20,
  stiffness: 200,
};

/** Spring parameters for banner entrances (toast, offline banner), applied
 *  through a layout-animation builder's `.damping()` / `.stiffness()`. */
export const bannerEntrySpring = {
  damping: 20,
  stiffness: 200,
} as const;

/** Spring parameters for the speed-dial mini-FAB entrances (builder API). */
export const speedDialEntrySpring = {
  damping: 16,
  stiffness: 180,
} as const;

/** Spring for the step pill's check overshooting and settling back */
export const stepCheckSpringConfig: WithSpringConfig = { damping: 10 };

/** Spring for the scan reticle corners settling after the lock snap */
export const reticleSettleSpringConfig: WithSpringConfig = { damping: 12 };

/** Spring parameters for chat bubble entrances. Layout-animation builders
 *  take these through `.damping()` / `.stiffness()`, not a config object. */
export const chatBubbleEntrySpring = {
  damping: 18,
  stiffness: 150,
} as const;

/** Spring configuration for success pop animations (favourite, confirm) —
 *  allows overshoot for a snappy bounce feel */
export const successPopConfig: WithSpringConfig = {
  damping: 12,
  mass: 0.3,
  stiffness: 200,
  overshootClamping: false,
};
