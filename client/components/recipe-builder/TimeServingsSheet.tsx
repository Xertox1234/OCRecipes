import React, { useCallback } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { TimeServingsData } from "@/hooks/useRecipeForm";

interface TimeServingsSheetProps {
  data: TimeServingsData;
  onChange: (data: TimeServingsData) => void;
}

function TimeServingsSheetInner({ data, onChange }: TimeServingsSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const inputStyle = [
    styles.input,
    {
      backgroundColor: withOpacity(theme.text, 0.04),
      color: theme.text,
      borderColor: withOpacity(theme.text, 0.1),
    },
  ];

  const handleServingsChange = useCallback(
    (delta: number) => {
      haptics.selection();
      const next = Math.max(1, Math.min(99, data.servings + delta));
      onChange({ ...data, servings: next });
    },
    [data, onChange, haptics],
  );

  return (
    <View style={styles.container}>
      {/* Servings */}
      <View style={styles.field}>
        <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
          Servings
        </ThemedText>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => handleServingsChange(-1)}
            style={[
              styles.stepperButton,
              { borderColor: withOpacity(theme.text, 0.1) },
            ]}
            disabled={data.servings <= 1}
            accessibilityRole="button"
            accessibilityLabel="Decrease servings"
          >
            <Feather
              name="minus"
              size={18}
              color={
                data.servings <= 1 ? withOpacity(theme.text, 0.2) : theme.text
              }
            />
          </Pressable>
          <ThemedText
            style={[styles.stepperValue, { color: theme.text }]}
            accessibilityRole="adjustable"
            accessibilityValue={{
              min: 1,
              max: 99,
              now: data.servings,
              text: `${data.servings} servings`,
            }}
          >
            {data.servings}
          </ThemedText>
          <Pressable
            onPress={() => handleServingsChange(1)}
            style={[
              styles.stepperButton,
              { borderColor: withOpacity(theme.text, 0.1) },
            ]}
            disabled={data.servings >= 99}
            accessibilityRole="button"
            accessibilityLabel="Increase servings"
          >
            <Feather
              name="plus"
              size={18}
              color={
                data.servings >= 99 ? withOpacity(theme.text, 0.2) : theme.text
              }
            />
          </Pressable>
        </View>
      </View>

      {/* Prep & Cook Time */}
      <View style={styles.timeRow}>
        <View style={styles.timeField}>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            Prep time
          </ThemedText>
          <View style={styles.timeInputWrapper}>
            <BottomSheetTextInput
              style={inputStyle}
              value={data.prepTime}
              onChangeText={(v) =>
                onChange({ ...data, prepTime: v.replace(/[^0-9]/g, "") })
              }
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Prep time in minutes"
            />
            <ThemedText style={[styles.suffix, { color: theme.textSecondary }]}>
              min
            </ThemedText>
          </View>
        </View>
        <View style={styles.timeField}>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            Cook time
          </ThemedText>
          <View style={styles.timeInputWrapper}>
            <BottomSheetTextInput
              style={inputStyle}
              value={data.cookTime}
              onChangeText={(v) =>
                onChange({ ...data, cookTime: v.replace(/[^0-9]/g, "") })
              }
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Cook time in minutes"
            />
            <ThemedText style={[styles.suffix, { color: theme.textSecondary }]}>
              min
            </ThemedText>
          </View>
        </View>
      </View>
    </View>
  );
}

export const TimeServingsSheet = React.memo(TimeServingsSheetInner);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.xl,
  },
  field: {
    gap: Spacing.sm,
  },
  label: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    fontSize: 20,
    fontFamily: FontFamily.semiBold,
    minWidth: 40,
    textAlign: "center",
  },
  timeRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  timeField: {
    flex: 1,
    gap: Spacing.sm,
  },
  timeInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
  },
  suffix: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
});
