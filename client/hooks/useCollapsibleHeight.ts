import { useCallback, useEffect, useRef } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { collapseTimingConfig } from "@/constants/animations";

/**
 * Encapsulates animated expand/collapse height logic for a section.
 *
 * - Expand: instant (sets height to -1 = auto)
 * - Collapse: animates measured content height → 0
 * - First render: no animation, just sets the correct state
 */
export function useCollapsibleHeight(
  isExpanded: boolean,
  reducedMotion: boolean,
) {
  const contentHeight = useSharedValue(0);
  const animatedHeight = useSharedValue(isExpanded ? -1 : 0); // -1 = auto
  const isFirstRender = useRef(true);

  const onContentLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const measured = e.nativeEvent.layout.height;
      contentHeight.value = measured;
      if (isFirstRender.current) {
        isFirstRender.current = false;
        if (isExpanded) {
          animatedHeight.value = -1; // auto
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [isExpanded],
  );

  useEffect(() => {
    if (isFirstRender.current) return;

    if (reducedMotion) {
      animatedHeight.value = isExpanded ? -1 : 0;
    } else if (isExpanded) {
      // Instant expand — set to auto immediately
      animatedHeight.value = -1;
    } else {
      // Snap to measured height first (from auto), then animate to 0
      animatedHeight.value = contentHeight.value;
      animatedHeight.value = withTiming(0, collapseTimingConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
  }, [isExpanded, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    if (animatedHeight.value === -1) {
      return { overflow: "visible" as const };
    }
    return {
      height: animatedHeight.value,
      overflow: "hidden" as const,
    };
  });

  return { animatedStyle, onContentLayout };
}
