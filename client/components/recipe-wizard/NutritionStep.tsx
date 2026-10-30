import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type TextInput as RNTextInput,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import type { NutritionData } from "@/hooks/useRecipeForm";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { sanitizeNumericInput } from "./nutrition-step-utils";

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

// One grid box: its own focus state, so the ring follows the rounded cell
// (caption, value and unit) rather than boxing the number inside it.
function NutritionCell({
  field,
  value,
  onChange,
  inputRef,
  onNext,
}: {
  field: NutrientField;
  value: string;
  onChange: (key: keyof NutritionData, raw: string) => void;
  inputRef: React.Ref<RNTextInput>;
  /** Moves to the next box; omitted on the last one, whose key says Done. */
  onNext?: () => void;
}) {
  const { theme } = useTheme();
  const cellFocus = useFieldFocus();

  return (
    <FocusField
      focus={cellFocus}
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
      <FocusTextInput
        ref={inputRef}
        focusRing={false}
        onFocus={cellFocus.onFocus}
        onBlur={cellFocus.onBlur}
        style={[styles.cellInput, { color: theme.text }]}
        value={value}
        onChangeText={(text) => onChange(field.key, text)}
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        // Where the keyboard shows a Return key (Android, hardware
        // keyboards), Next moves to the next box.
        returnKeyType={onNext ? "next" : "done"}
        submitBehavior={onNext ? "submit" : "blurAndSubmit"}
        onSubmitEditing={onNext}
        textAlign="center"
        maxLength={7}
        accessibilityLabel={`${field.label.toLowerCase()} per serving`}
        accessibilityHint={`Enter ${field.label.toLowerCase()} in ${field.unit}`}
      />
      <Text style={[styles.unitText, { color: theme.textSecondary }]}>
        {field.unit}
      </Text>
    </FocusField>
  );
}

export default function NutritionStep({
  nutrition,
  setNutrition,
}: NutritionStepProps) {
  const inputs = useRef<(RNTextInput | null)[]>([]);
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
        {FIELDS.map((field, i) => (
          <NutritionCell
            key={field.key}
            field={field}
            value={nutrition[field.key]}
            onChange={handleChange}
            inputRef={(el) => {
              inputs.current[i] = el;
            }}
            onNext={
              i < FIELDS.length - 1
                ? () => inputs.current[i + 1]?.focus()
                : undefined
            }
          />
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
