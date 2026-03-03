import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  cancelAnimation,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius } from "@/constants/theme";

interface SkeletonBoxProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A single skeleton placeholder box with shimmer animation.
 */
export function SkeletonBox({
  width = "100%",
  height = 16,
  borderRadius = 4,
  style,
}: SkeletonBoxProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const shimmerValue = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      shimmerValue.value = 0.5;
      return;
    }

    shimmerValue.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(shimmerValue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shimmerValue is a stable ref from useSharedValue that never changes identity
  }, [reducedMotion]);

  const shimmerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      shimmerValue.value,
      [0, 0.5, 1],
      [0.3, 0.7, 0.3],
    );
    return { opacity };
  });

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: theme.backgroundSecondary,
        },
        shimmerStyle,
        style,
      ]}
    />
  );
}

interface SkeletonItemProps {
  /** Index for staggered opacity effect */
  index?: number;
  /** Custom content layout */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A skeleton list item with image and text placeholders.
 * Default layout matches common list item patterns.
 */
export function SkeletonItem({
  index = 0,
  children,
  style,
}: SkeletonItemProps) {
  const { theme } = useTheme();

  const defaultContent = (
    <>
      <SkeletonBox width={56} height={56} borderRadius={BorderRadius.xs} />
      <View style={styles.skeletonText}>
        <SkeletonBox width="70%" height={16} />
        <SkeletonBox width="40%" height={16} />
      </View>
    </>
  );

  return (
    <View
      style={[
        styles.skeletonItem,
        { backgroundColor: theme.backgroundDefault },
        { opacity: 1 - index * 0.1 },
        style,
      ]}
      accessibilityLabel="Loading..."
    >
      {children || defaultContent}
    </View>
  );
}

interface SkeletonListProps {
  /** Number of skeleton items to render */
  count?: number;
  /** Custom item renderer */
  renderItem?: (index: number) => React.ReactNode;
}

/**
 * A skeleton loading list with multiple items.
 */
export function SkeletonList({ count = 5, renderItem }: SkeletonListProps) {
  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: count }, (_, i) =>
        renderItem ? (
          <React.Fragment key={i}>{renderItem(i)}</React.Fragment>
        ) : (
          <SkeletonItem key={i} index={i} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonContainer: {
    gap: Spacing.md,
  },
  skeletonItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius["2xl"],
    gap: Spacing.md,
  },
  skeletonText: {
    flex: 1,
    gap: Spacing.sm,
  },
});
