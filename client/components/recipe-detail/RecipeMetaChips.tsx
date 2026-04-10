import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ServingStepperChip } from "./ServingStepperChip";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface RecipeMetaChipsProps {
  timeDisplay?: string | null;
  difficulty?: string | null;
  servings?: number | null;
  /** When provided, renders an interactive stepper instead of static servings chip */
  servingCount?: number;
  isAdjusted?: boolean;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onSetServings?: (n: number) => void;
}

export function RecipeMetaChips({
  timeDisplay,
  difficulty,
  servings,
  servingCount,
  isAdjusted,
  onIncrement,
  onDecrement,
  onSetServings,
}: RecipeMetaChipsProps) {
  const { theme } = useTheme();

  const hasStepperProps =
    servingCount != null &&
    onIncrement != null &&
    onDecrement != null &&
    onSetServings != null;

  if (!timeDisplay && !difficulty && !servings && !hasStepperProps) return null;

  return (
    <View style={styles.metaRow}>
      {timeDisplay && (
        <View
          style={[
            styles.metaPill,
            { backgroundColor: withOpacity(theme.text, 0.06) },
          ]}
        >
          <Feather name="clock" size={12} color={theme.textSecondary} />
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {timeDisplay}
          </ThemedText>
        </View>
      )}
      {difficulty && (
        <View
          style={[
            styles.metaPill,
            { backgroundColor: withOpacity(theme.text, 0.06) },
          ]}
        >
          <Feather name="bar-chart-2" size={12} color={theme.textSecondary} />
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {difficulty}
          </ThemedText>
        </View>
      )}
      {hasStepperProps ? (
        <ServingStepperChip
          servingCount={servingCount}
          isAdjusted={isAdjusted ?? false}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          onSetServings={onSetServings}
        />
      ) : (
        servings != null && (
          <View
            style={[
              styles.metaPill,
              { backgroundColor: withOpacity(theme.text, 0.06) },
            ]}
          >
            <Feather name="users" size={12} color={theme.textSecondary} />
            <ThemedText
              style={[styles.metaText, { color: theme.textSecondary }]}
            >
              {servings} servings
            </ThemedText>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  metaText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
