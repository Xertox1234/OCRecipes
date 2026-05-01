import React from "react";
import { StyleSheet, Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { getEmptyStateDefaults } from "./empty-state-utils";
import type { EmptyStateVariant } from "./empty-state-utils";

interface EmptyStateProps {
  variant: EmptyStateVariant;
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

export function EmptyState({
  variant,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const defaults = getEmptyStateDefaults(variant);

  const entering = reducedMotion ? undefined : FadeInUp.duration(300);

  return (
    <Animated.View
      entering={entering}
      style={styles.container}
      accessibilityLabel={`${title}. ${description}`}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: withOpacity(theme.text, 0.06) },
        ]}
      >
        <Feather
          name={icon as keyof typeof Feather.glyphMap}
          size={defaults.iconSize}
          color={withOpacity(theme.text, defaults.iconOpacity)}
          accessible={false}
        />
      </View>
      <ThemedText type="h4" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.description, { color: theme.textSecondary }]}
      >
        {description}
      </ThemedText>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: theme.link,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <ThemedText
            type="body"
            style={[styles.actionText, { color: theme.buttonText }]}
          >
            {actionLabel}
          </ThemedText>
        </Pressable>
      )}
      {secondaryLabel && onSecondaryAction && (
        <Pressable
          onPress={onSecondaryAction}
          accessibilityRole="button"
          accessibilityLabel={secondaryLabel}
          style={styles.secondaryAction}
        >
          <ThemedText
            type="small"
            style={[styles.secondaryText, { color: theme.link }]}
          >
            {secondaryLabel}
          </ThemedText>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  description: {
    textAlign: "center",
    maxWidth: 280,
  },
  actionButton: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.button,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  actionText: {
    fontFamily: FontFamily.semiBold,
  },
  secondaryAction: {
    marginTop: Spacing.md,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  secondaryText: {
    fontFamily: FontFamily.medium,
  },
});
