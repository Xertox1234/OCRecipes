import React, { useState, useCallback } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";

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
import type { MacroDelta } from "@shared/types/cook-session";

interface InlineSubstitutionProps {
  substitute: string;
  reason: string;
  ratio: string;
  macroDelta: MacroDelta;
  confidence: number;
}

/**
 * Expandable substitution suggestion row shown below a flagged ingredient.
 * Collapsed state shows substitute name; expanded shows ratio, reason, macros.
 */
export const InlineSubstitution = React.memo(function InlineSubstitution({
  substitute,
  reason,
  ratio,
  macroDelta,
  confidence,
}: InlineSubstitutionProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const [expanded, setExpanded] = useState(false);
  const scale = useSharedValue(1);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const handlePressIn = () => {
    if (!reducedMotion) {
      scale.value = withSpring(0.97, pressSpringConfig);
    }
  };
  const handlePressOut = () => {
    if (!reducedMotion) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const hasMacros =
    macroDelta.calories !== 0 ||
    macroDelta.protein !== 0 ||
    macroDelta.carbs !== 0 ||
    macroDelta.fat !== 0;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={toggle}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityLabel={`Substitute: ${substitute}. ${expanded ? "Tap to collapse" : "Tap for details"}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={[
          styles.container,
          { backgroundColor: withOpacity(theme.success, 0.06) },
        ]}
      >
        {/* Header row */}
        <View style={styles.headerRow}>
          <Feather
            name="repeat"
            size={12}
            color={theme.success}
            accessible={false}
          />
          <ThemedText
            type="small"
            style={[styles.substituteName, { color: theme.success }]}
            numberOfLines={expanded ? undefined : 1}
          >
            {substitute}
          </ThemedText>
          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={theme.textSecondary}
            accessible={false}
          />
        </View>

        {/* Expanded details */}
        {expanded && (
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(200)}
            exiting={reducedMotion ? undefined : FadeOut.duration(150)}
            style={styles.details}
          >
            {/* Ratio */}
            <View style={styles.detailRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Ratio:
              </ThemedText>
              <ThemedText type="caption" style={styles.detailValue}>
                {ratio}
              </ThemedText>
            </View>

            {/* Reason */}
            <ThemedText
              type="caption"
              style={[styles.reason, { color: theme.textSecondary }]}
            >
              {reason}
            </ThemedText>

            {/* Macro delta */}
            {hasMacros && (
              <View style={styles.macroRow}>
                {macroDelta.calories !== 0 && (
                  <MacroChip
                    label="cal"
                    value={macroDelta.calories}
                    color={theme.calorieAccent}
                  />
                )}
                {macroDelta.protein !== 0 && (
                  <MacroChip
                    label="pro"
                    value={macroDelta.protein}
                    color={theme.proteinAccent}
                  />
                )}
                {macroDelta.carbs !== 0 && (
                  <MacroChip
                    label="carb"
                    value={macroDelta.carbs}
                    color={theme.carbsAccent}
                  />
                )}
                {macroDelta.fat !== 0 && (
                  <MacroChip
                    label="fat"
                    value={macroDelta.fat}
                    color={theme.fatAccent}
                  />
                )}
              </View>
            )}

            {/* Confidence */}
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
            >
              Confidence: {Math.round(confidence * 100)}%
            </ThemedText>
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
});

const MacroChip = React.memo(function MacroChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const prefix = value > 0 ? "+" : "";
  return (
    <View
      style={[styles.macroChip, { backgroundColor: withOpacity(color, 0.1) }]}
    >
      <ThemedText
        type="caption"
        style={{ color, fontFamily: FontFamily.semiBold }}
      >
        {prefix}
        {value} {label}
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginTop: Spacing.xs,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  substituteName: {
    flex: 1,
    fontFamily: FontFamily.medium,
  },
  details: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  detailRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  detailValue: {
    fontFamily: FontFamily.medium,
    flex: 1,
  },
  reason: {
    lineHeight: 18,
  },
  macroRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  macroChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
});
