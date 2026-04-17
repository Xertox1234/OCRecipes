import React, { useCallback } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet } from "react-native";
import type { NutritionData } from "@/hooks/useRecipeForm";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface NutritionStepProps {
  nutrition: NutritionData;
  setNutrition: (data: NutritionData) => void;
}

type NutrientColorKey =
  | "calorieAccent"
  | "proteinAccent"
  | "carbsAccent"
  | "fatAccent";

interface NutrientField {
  key: keyof NutritionData;
  label: string;
  unit: string;
  colorKey: NutrientColorKey;
}

const FIELDS: NutrientField[] = [
  {
    key: "calories",
    label: "CALORIES",
    unit: "kcal",
    colorKey: "calorieAccent",
  },
  {
    key: "protein",
    label: "PROTEIN",
    unit: "grams",
    colorKey: "proteinAccent",
  },
  {
    key: "carbs",
    label: "CARBS",
    unit: "grams",
    colorKey: "carbsAccent",
  },
  {
    key: "fat",
    label: "FAT",
    unit: "grams",
    colorKey: "fatAccent",
  },
];

function sanitizeNumericInput(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

export default function NutritionStep({
  nutrition,
  setNutrition,
}: NutritionStepProps) {
  const { theme } = useTheme();

  const handleChange = useCallback(
    (key: keyof NutritionData, raw: string) => {
      const sanitized = sanitizeNumericInput(raw);
      setNutrition({ ...nutrition, [key]: sanitized });
    },
    [nutrition, setNutrition],
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.grid}>
        {FIELDS.map((field) => (
          <View
            key={field.key}
            style={[
              styles.cell,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.border, 0.5),
              },
            ]}
          >
            <Text style={[styles.cellLabel, { color: theme[field.colorKey] }]}>
              {field.label}
            </Text>
            <TextInput
              style={[styles.cellInput, { color: theme.text }]}
              value={nutrition[field.key]}
              onChangeText={(text) => handleChange(field.key, text)}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              textAlign="center"
              maxLength={7}
              accessibilityLabel={`${field.label.toLowerCase()} per serving`}
              accessibilityHint={`Enter ${field.label.toLowerCase()} in ${field.unit}`}
            />
            <Text style={[styles.unitText, { color: theme.textSecondary }]}>
              {field.unit}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingBottom: Spacing.xl,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  cell: {
    width: "47%",
    borderRadius: BorderRadius.xs,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  cellLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
    textAlign: "center",
  },
  cellInput: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    textAlign: "center",
    width: "100%",
    paddingVertical: Spacing.sm,
  },
  unitText: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    marginTop: 2,
    textAlign: "center",
  },
});
