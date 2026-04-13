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

/** Spring configuration for success pop animations (favourite, confirm) —
 *  allows overshoot for a snappy bounce feel */
export const successPopConfig: WithSpringConfig = {
  damping: 12,
  mass: 0.3,
  stiffness: 200,
  overshootClamping: false,
};

/** Timing configuration for the fade-out phase of a success flash */
export const successFlashConfig: WithTimingConfig = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
};
