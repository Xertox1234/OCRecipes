import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput as RNTextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

interface ServingOption {
  label: string;
  grams: number;
}

interface ServingControlsProps {
  servingOptions: ServingOption[];
  servingSizeGrams: number | null;
  setServingSizeGrams: (grams: number) => void;
  servingQuantity: number;
  setServingQuantity: (quantity: number) => void;
  showCustomInput: boolean;
  setShowCustomInput: (show: boolean) => void;
  customGramsInput: string;
  setCustomGramsInput: (input: string) => void;
  recalculateNutrition: (grams: number, quantity: number) => void;
}

export const ServingControls = React.memo(function ServingControls({
  servingOptions,
  servingSizeGrams,
  setServingSizeGrams,
  servingQuantity,
  setServingQuantity,
  showCustomInput,
  setShowCustomInput,
  customGramsInput,
  setCustomGramsInput,
  recalculateNutrition,
}: ServingControlsProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  return (
    <Card elevation={1} style={styles.servingCard}>
      {/* Serving Size */}
      <View style={styles.servingSection}>
        <ThemedText
          type="small"
          style={[styles.servingSectionLabel, { color: theme.textSecondary }]}
        >
          Serving Size
        </ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.servingChips}
        >
          {servingOptions.map((opt) => {
            const isActive =
              !showCustomInput &&
              servingSizeGrams !== null &&
              Math.abs(servingSizeGrams - opt.grams) < 0.1;
            return (
              <Pressable
                key={opt.grams}
                style={({ pressed }) => [
                  styles.servingChip,
                  {
                    backgroundColor: isActive
                      ? theme.link
                      : withOpacity(theme.text, 0.06),
                  },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => {
                  setShowCustomInput(false);
                  setServingSizeGrams(opt.grams);
                  recalculateNutrition(opt.grams, servingQuantity);
                  haptics.selection();
                }}
                accessibilityLabel={`Set serving to ${opt.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <ThemedText
                  type="small"
                  style={{
                    color: isActive ? theme.buttonText : theme.text,
                    fontWeight: isActive ? "600" : "400",
                  }}
                >
                  {opt.label}
                </ThemedText>
              </Pressable>
            );
          })}
          {/* Custom option */}
          <Pressable
            style={({ pressed }) => [
              styles.servingChip,
              {
                backgroundColor: showCustomInput
                  ? theme.link
                  : withOpacity(theme.text, 0.06),
              },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              setShowCustomInput(true);
              haptics.selection();
            }}
            accessibilityLabel="Enter custom serving size"
            accessibilityRole="button"
            accessibilityState={{ selected: showCustomInput }}
          >
            <ThemedText
              type="small"
              style={{
                color: showCustomInput ? theme.buttonText : theme.text,
                fontWeight: showCustomInput ? "600" : "400",
              }}
            >
              Custom
            </ThemedText>
          </Pressable>
        </ScrollView>

        {showCustomInput ? (
          <View style={styles.customInputRow}>
            <RNTextInput
              style={[
                styles.customInput,
                {
                  color: theme.text,
                  backgroundColor: withOpacity(theme.text, 0.06),
                  borderColor: theme.border,
                },
              ]}
              value={customGramsInput}
              onChangeText={setCustomGramsInput}
              onEndEditing={() => {
                const parsed = parseFloat(customGramsInput);
                if (parsed > 0 && isFinite(parsed)) {
                  setServingSizeGrams(parsed);
                  recalculateNutrition(parsed, servingQuantity);
                }
              }}
              placeholder="grams"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              returnKeyType="done"
              accessibilityLabel="Custom serving size in grams"
            />
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              g
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Divider */}
      <View
        style={[styles.servingDivider, { backgroundColor: theme.border }]}
      />

      {/* Servings quantity */}
      <View style={styles.quantityRow}>
        <ThemedText
          type="small"
          style={[styles.servingSectionLabel, { color: theme.textSecondary }]}
        >
          Servings
        </ThemedText>
        <View style={styles.quantityStepper}>
          <Pressable
            style={({ pressed }) => [
              styles.stepperButton,
              { backgroundColor: withOpacity(theme.text, 0.08) },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              const next = Math.max(0.5, servingQuantity - 0.5);
              setServingQuantity(next);
              if (servingSizeGrams) {
                recalculateNutrition(servingSizeGrams, next);
              }
              haptics.selection();
            }}
            accessibilityLabel="Decrease serving quantity"
            accessibilityRole="button"
          >
            <Feather name="minus" size={18} color={theme.text} />
          </Pressable>
          <ThemedText type="h4" style={styles.quantityValue}>
            {servingQuantity % 1 === 0
              ? servingQuantity
              : servingQuantity.toFixed(1)}
          </ThemedText>
          <Pressable
            style={({ pressed }) => [
              styles.stepperButton,
              { backgroundColor: withOpacity(theme.text, 0.08) },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              const next = servingQuantity + 0.5;
              setServingQuantity(next);
              if (servingSizeGrams) {
                recalculateNutrition(servingSizeGrams, next);
              }
              haptics.selection();
            }}
            accessibilityLabel="Increase serving quantity"
            accessibilityRole="button"
          >
            <Feather name="plus" size={18} color={theme.text} />
          </Pressable>
        </View>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  servingCard: {
    padding: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  servingSection: {
    marginBottom: Spacing.sm,
  },
  servingSectionLabel: {
    fontWeight: "500",
    marginBottom: Spacing.sm,
  },
  servingChips: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  servingChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
    minHeight: 44,
  },
  customInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  customInput: {
    flex: 1,
    height: 40,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  servingDivider: {
    height: 1,
    marginVertical: Spacing.sm,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quantityStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityValue: {
    minWidth: 32,
    textAlign: "center",
  },
});
