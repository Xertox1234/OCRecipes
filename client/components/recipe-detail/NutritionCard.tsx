import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

export interface NutritionData {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

function NutritionRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.nutritionRow}>
      <View style={[styles.nutritionDot, { backgroundColor: color }]} />
      <ThemedText style={styles.nutritionLabel}>{label}</ThemedText>
      <ThemedText
        style={[styles.nutritionValue, { color: theme.textSecondary }]}
      >
        {value}
      </ThemedText>
    </View>
  );
}

export function NutritionCard({ nutrition }: { nutrition: NutritionData }) {
  const { theme } = useTheme();

  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>Nutrition per serving</ThemedText>
      <View
        style={[
          styles.nutritionCard,
          { backgroundColor: withOpacity(theme.text, 0.04) },
        ]}
      >
        <NutritionRow
          label="Calories"
          value={`${Math.round(nutrition.calories)} kcal`}
          color={theme.calorieAccent}
        />
        {nutrition.protein != null && (
          <NutritionRow
            label="Protein"
            value={`${Math.round(nutrition.protein)}g`}
            color={theme.proteinAccent}
          />
        )}
        {nutrition.carbs != null && (
          <NutritionRow
            label="Carbs"
            value={`${Math.round(nutrition.carbs)}g`}
            color={theme.carbsAccent}
          />
        )}
        {nutrition.fat != null && (
          <NutritionRow
            label="Fat"
            value={`${Math.round(nutrition.fat)}g`}
            color={theme.fatAccent}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  nutritionCard: {
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  nutritionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  nutritionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  nutritionLabel: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    flex: 1,
  },
  nutritionValue: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
  },
});
