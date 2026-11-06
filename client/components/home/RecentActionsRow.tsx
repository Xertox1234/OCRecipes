import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
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
import type { HomeAction } from "./action-config";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ICON_ONLY_THRESHOLD = 5;

interface RecentActionsRowProps {
  recentActionIds: string[];
  allActions: HomeAction[];
  onActionPress: (action: HomeAction) => void;
  usageCounts?: Record<string, number>;
}

function RecentActionChip({
  action,
  onPress,
  reducedMotion,
  iconOnly,
}: {
  action: HomeAction;
  onPress: () => void;
  reducedMotion: boolean;
  iconOnly: boolean;
}) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        if (!reducedMotion) {
          scale.set(withSpring(0.95, pressSpringConfig));
        }
      }}
      onPressOut={() => {
        if (!reducedMotion) {
          scale.set(withSpring(1, pressSpringConfig));
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={[
        styles.chip,
        animatedStyle,
        { backgroundColor: withOpacity(theme.link, 0.1) },
      ]}
    >
      <Feather
        name={action.icon as keyof typeof Feather.glyphMap}
        size={iconOnly ? 16 : 14}
        color={theme.link}
        accessible={false}
      />
      {!iconOnly && (
        <ThemedText
          type="small"
          style={[styles.chipLabel, { color: theme.link }]}
          numberOfLines={1}
        >
          {action.label}
        </ThemedText>
      )}
    </AnimatedPressable>
  );
}

export function RecentActionsRow({
  recentActionIds,
  allActions,
  onActionPress,
  usageCounts = {},
}: RecentActionsRowProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  // Resolve action IDs to full action objects
  const resolvedActions = recentActionIds
    .map((id) => allActions.find((a) => a.id === id))
    .filter((a): a is HomeAction => a != null);

  const entering = reducedMotion
    ? undefined
    : FadeInDown.delay(120).duration(400);

  if (resolvedActions.length === 0) {
    return (
      <Animated.View entering={entering} style={styles.hintContainer}>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, textAlign: "center" }}
        >
          Your recent actions will appear here
        </ThemedText>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={entering}>
      <View style={styles.labelRow}>
        <ThemedText
          type="small"
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          Recent
        </ThemedText>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        accessibilityRole="toolbar"
        accessibilityLabel="Recent actions"
      >
        {resolvedActions.map((action) => (
          <RecentActionChip
            key={action.id}
            action={action}
            onPress={() => onActionPress(action)}
            reducedMotion={reducedMotion}
            iconOnly={(usageCounts[action.id] ?? 0) >= ICON_ONLY_THRESHOLD}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hintContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  labelRow: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  sectionLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
    minHeight: 36,
  },
  chipLabel: {
    fontFamily: FontFamily.medium,
  },
});
