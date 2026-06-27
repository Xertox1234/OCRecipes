import { useCallback, useEffect, useRef } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";
import { clampDrawerHeight } from "@/components/home/inline-drawer-utils";

/**
 * Encapsulates animated expand/collapse height logic for a section.
 *
 * Always uses explicit height values — never removes the height property
 * from the animated style, since Reanimated doesn't reliably recalculate
 * native layout when animated properties are removed.
 *
 * - Expand: animates 0 → measured content height
 * - Collapse: animates measured content height → 0
 * - First render: snaps to correct height after first onLayout measurement
 */
export function useCollapsibleHeight(
  isExpanded: boolean,
  reducedMotion: boolean,
  maxHeight?: number,
) {
  const contentHeight = useSharedValue(0);
  const animatedHeight = useSharedValue(0);
  const hasMeasured = useRef(false);

  const onContentLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const raw = e.nativeEvent.layout.height;
      if (raw === 0) return; // Ignore zero-height measurements
      const measured = clampDrawerHeight(raw, maxHeight);
      contentHeight.value = measured;
      if (!hasMeasured.current) {
        hasMeasured.current = true;
        animatedHeight.value = isExpanded ? measured : 0;
      } else if (isExpanded) {
        animatedHeight.value = measured;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [isExpanded, maxHeight],
  );

  useEffect(() => {
    if (!hasMeasured.current) return;

    if (reducedMotion) {
      animatedHeight.value = isExpanded ? contentHeight.value : 0;
    } else if (isExpanded) {
      animatedHeight.value = withTiming(
        contentHeight.value,
        expandTimingConfig,
      );
    } else {
      animatedHeight.value = withTiming(0, collapseTimingConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
  }, [isExpanded, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value,
  }));

  return { animatedStyle, onContentLayout };
}
