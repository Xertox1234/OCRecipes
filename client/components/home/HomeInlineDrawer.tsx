import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { Spacing, withOpacity } from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";

interface HomeInlineDrawerProps {
  icon: string;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  maxHeight: number;
  isLocked?: boolean;
  children: React.ReactNode;
}

export const HomeInlineDrawer = React.forwardRef<
  React.ComponentRef<typeof Animated.View>,
  HomeInlineDrawerProps
>(function HomeInlineDrawer(
  { icon, label, isOpen, onToggle, maxHeight, isLocked, children },
  ref,
) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isOpen,
    reducedMotion,
    maxHeight,
  );

  const chevronRotation = useSharedValue(0);
  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = isOpen;
    if (reducedMotion) {
      chevronRotation.value = isOpen ? 90 : 0;
    } else {
      chevronRotation.value = withTiming(
        isOpen ? 90 : 0,
        isOpen ? expandTimingConfig : collapseTimingConfig,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is a stable ref
  }, [isOpen, reducedMotion]);

  useEffect(
    () => () => cancelAnimation(chevronRotation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  return (
    <Animated.View ref={ref}>
      <Pressable
        onPress={() => {
          haptics.impact(Haptics.ImpactFeedbackStyle.Light);
          onToggle();
        }}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={`Double tap to ${isOpen ? "collapse" : "expand"} ${label}`}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: withOpacity(theme.link, 0.1) },
          ]}
        >
          <Feather
            name={icon as keyof typeof Feather.glyphMap}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </View>
        <ThemedText type="body" style={styles.label}>
          {label}
        </ThemedText>
        {isLocked ? (
          <Feather
            name="lock"
            size={14}
            color={theme.textSecondary}
            accessible={false}
          />
        ) : (
          <Animated.View style={chevronStyle}>
            <Feather
              name="chevron-right"
              size={16}
              color={theme.textSecondary}
              accessible={false}
            />
          </Animated.View>
        )}
      </Pressable>

      <Animated.View style={[animatedStyle, styles.clip]}>
        <View
          style={styles.body}
          onLayout={onContentLayout}
          importantForAccessibility={isOpen ? "yes" : "no-hide-descendants"}
          aria-hidden={!isOpen}
        >
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 48,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  label: { flex: 1 },
  clip: { overflow: "hidden" },
  body: {
    position: "absolute",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
});
