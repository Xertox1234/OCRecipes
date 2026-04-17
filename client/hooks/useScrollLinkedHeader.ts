import { useState, useCallback } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
  runOnJS,
} from "react-native-reanimated";

/**
 * Hook for scroll-linked collapsing headers.
 *
 * Returns an animated style that interpolates header height and opacity
 * between expanded and collapsed states based on scroll offset, plus a
 * scroll handler to attach to an Animated.ScrollView or Animated.FlatList.
 *
 * When `reducedMotion` is true, the header stays fully expanded (no
 * scroll-linked animation).
 *
 * @param expandedHeight - Full header height in pixels
 * @param collapsedHeight - Collapsed header height in pixels (0 for fully hidden)
 * @param collapseThreshold - Scroll offset at which the header is fully collapsed
 * @param reducedMotion - Whether the user prefers reduced motion
 */
export function useScrollLinkedHeader({
  expandedHeight,
  collapsedHeight,
  collapseThreshold,
  reducedMotion,
}: {
  expandedHeight: number;
  collapsedHeight: number;
  collapseThreshold: number;
  reducedMotion: boolean;
}) {
  const scrollY = useSharedValue(0);
  const lastBarVisible = useSharedValue(false);
  const [isBarVisible, setIsBarVisible] = useState(false);

  const updateBarVisibility = useCallback((visible: boolean) => {
    setIsBarVisible(visible);
  }, []);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      // Only cross the UI→JS bridge when the boolean transitions, not every frame
      const barShouldBeVisible =
        event.contentOffset.y > collapseThreshold * 0.5;
      if (barShouldBeVisible !== lastBarVisible.value) {
        lastBarVisible.value = barShouldBeVisible;
        runOnJS(updateBarVisibility)(barShouldBeVisible);
      }
    },
  });

  const headerAnimatedStyle = useAnimatedStyle(() => {
    if (reducedMotion) {
      return {
        height: expandedHeight,
        opacity: 1,
      };
    }

    const height = interpolate(
      scrollY.value,
      [0, collapseThreshold],
      [expandedHeight, collapsedHeight],
      Extrapolation.CLAMP,
    );

    const opacity = interpolate(
      scrollY.value,
      [0, collapseThreshold * 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    );

    return {
      height,
      opacity,
    };
  });

  const collapsedBarAnimatedStyle = useAnimatedStyle(() => {
    if (reducedMotion) {
      return { opacity: 0 };
    }

    const opacity = interpolate(
      scrollY.value,
      [collapseThreshold * 0.5, collapseThreshold],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return { opacity };
  });

  return {
    scrollHandler,
    scrollY,
    headerAnimatedStyle,
    collapsedBarAnimatedStyle,
    /** Whether the collapsed bar is sufficiently visible to receive touches */
    isBarVisible,
  };
}
