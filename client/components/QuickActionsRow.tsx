import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";

interface QuickAction {
  icon: string;
  label: string;
  onPress: () => void;
}

interface QuickActionsRowProps {
  actions: QuickAction[];
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function QuickActionPill({
  action,
  index,
  reducedMotion,
}: {
  action: QuickAction;
  index: number;
  reducedMotion: boolean;
}) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const entering = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 60).duration(300);

  return (
    <Animated.View entering={entering}>
      <AnimatedPressable
        onPress={action.onPress}
        onPressIn={() => {
          if (!reducedMotion) {
            scale.value = withSpring(0.95, pressSpringConfig);
          }
        }}
        onPressOut={() => {
          if (!reducedMotion) {
            scale.value = withSpring(1, pressSpringConfig);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        style={[
          styles.pill,
          animatedStyle,
          { backgroundColor: withOpacity(theme.link, 0.1) },
        ]}
      >
        <Feather
          name={action.icon as keyof typeof Feather.glyphMap}
          size={16}
          color={theme.link}
          accessible={false}
        />
        <ThemedText
          type="small"
          style={[styles.pillLabel, { color: theme.link }]}
          numberOfLines={1}
        >
          {action.label}
        </ThemedText>
      </AnimatedPressable>
    </Animated.View>
  );
}

export function QuickActionsRow({ actions }: QuickActionsRowProps) {
  const { reducedMotion } = useAccessibility();

  return (
    <View style={styles.container} accessibilityRole="toolbar">
      {actions.map((action, index) => (
        <QuickActionPill
          key={action.label}
          action={action}
          index={index}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
    minHeight: 44,
  },
  pillLabel: {
    fontFamily: FontFamily.medium,
  },
});
