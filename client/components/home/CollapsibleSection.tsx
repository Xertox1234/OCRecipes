import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { Spacing, FontFamily } from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";

interface CollapsibleSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  isExpanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const chevronRotation = useSharedValue(isExpanded ? 0 : -90);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isExpanded,
    reducedMotion,
  );

  // Animate chevron rotation
  React.useEffect(() => {
    if (reducedMotion) {
      chevronRotation.value = isExpanded ? 0 : -90;
    } else {
      chevronRotation.value = withTiming(
        isExpanded ? 0 : -90,
        isExpanded ? expandTimingConfig : collapseTimingConfig,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable ref
  }, [isExpanded, reducedMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`${title} section`}
        accessibilityState={{ expanded: isExpanded }}
        accessibilityHint={`Double tap to ${isExpanded ? "collapse" : "expand"} section`}
      >
        <ThemedText type="body" style={styles.title}>
          {title}
        </ThemedText>
        <Animated.View style={chevronStyle}>
          <Feather
            name="chevron-down"
            size={20}
            color={theme.textSecondary}
            accessible={false}
          />
        </Animated.View>
      </Pressable>

      <Animated.View style={animatedStyle}>
        <View onLayout={onContentLayout}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 44,
  },
  title: {
    fontFamily: FontFamily.semiBold,
  },
});
