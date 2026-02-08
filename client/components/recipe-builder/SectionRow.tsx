import React from "react";
import { Pressable, View, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import type { SectionRowProps } from "./types";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function SectionRowInner({
  icon,
  label,
  summary,
  renderSummary,
  isFilled,
  onPress,
}: SectionRowProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!reducedMotion) {
      scale.value = withSpring(0.98, pressSpringConfig);
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  const handlePress = () => {
    haptics.selection();
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={animatedStyle}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${isFilled ? summary || "has content" : "Tap to add"}`}
      accessibilityHint={`Opens ${label} editor`}
    >
      <View style={[styles.row, { minHeight: 48 }]}>
        <View style={styles.left}>
          <Feather
            name={icon as keyof typeof Feather.glyphMap}
            size={20}
            color={isFilled ? theme.link : theme.textSecondary}
          />
          <ThemedText style={[styles.label, { color: theme.text }]}>
            {label}
          </ThemedText>
        </View>
        <View style={styles.right}>
          {renderSummary ? (
            renderSummary()
          ) : (
            <ThemedText
              style={[
                styles.summary,
                {
                  color: isFilled ? theme.text : theme.textSecondary,
                },
              ]}
              numberOfLines={1}
            >
              {isFilled ? summary : "Tap to add"}
            </ThemedText>
          )}
          <Feather
            name="chevron-right"
            size={16}
            color={withOpacity(theme.text, 0.3)}
          />
        </View>
      </View>
    </AnimatedPressable>
  );
}

export const SectionRow = React.memo(
  SectionRowInner,
  (prev, next) =>
    prev.isFilled === next.isFilled &&
    prev.summary === next.summary &&
    prev.onPress === next.onPress &&
    prev.renderSummary === next.renderSummary,
);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    flexShrink: 0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
    justifyContent: "flex-end",
  },
  label: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
  },
  summary: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    flexShrink: 1,
  },
});
