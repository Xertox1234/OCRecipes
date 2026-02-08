import React from "react";
import { View, StyleSheet } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { NutritionData } from "@/hooks/useRecipeForm";

interface NutritionSheetProps {
  data: NutritionData;
  onChange: (data: NutritionData) => void;
}

function NutritionField({
  label,
  unit,
  value,
  onChangeText,
  accessibilityLabel,
  theme,
}: {
  label: string;
  unit: string;
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
      <BottomSheetTextInput
        style={[
          styles.input,
          {
            backgroundColor: withOpacity(theme.text, 0.04),
            color: theme.text,
            borderColor: withOpacity(theme.text, 0.1),
          },
        ]}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/[^0-9.]/g, ""))}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={accessibilityLabel}
      />
      <ThemedText style={[styles.unit, { color: theme.textSecondary }]}>
        {unit}
      </ThemedText>
    </View>
  );
}

function NutritionSheetInner({ data, onChange }: NutritionSheetProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        <NutritionField
          label="Calories"
          unit="kcal"
          value={data.calories}
          onChangeText={(v) => onChange({ ...data, calories: v })}
          accessibilityLabel="Calories per serving"
          theme={theme}
        />
        <NutritionField
          label="Protein"
          unit="g"
          value={data.protein}
          onChangeText={(v) => onChange({ ...data, protein: v })}
          accessibilityLabel="Protein per serving in grams"
          theme={theme}
        />
        <NutritionField
          label="Carbs"
          unit="g"
          value={data.carbs}
          onChangeText={(v) => onChange({ ...data, carbs: v })}
          accessibilityLabel="Carbs per serving in grams"
          theme={theme}
        />
        <NutritionField
          label="Fat"
          unit="g"
          value={data.fat}
          onChangeText={(v) => onChange({ ...data, fat: v })}
          accessibilityLabel="Fat per serving in grams"
          theme={theme}
        />
      </View>
    </View>
  );
}

export const NutritionSheet = React.memo(NutritionSheetInner);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  field: {
    width: "47%",
    gap: Spacing.xs,
  },
  label: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 20,
    fontFamily: FontFamily.semiBold,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    textAlign: "center",
  },
  unit: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    textAlign: "center",
  },
});
