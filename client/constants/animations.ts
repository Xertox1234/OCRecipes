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
