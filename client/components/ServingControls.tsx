import React from "react";
import { StyleSheet, View, ScrollView, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing } from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";

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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function StepperButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: "minus" | "plus";
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[
        styles.stepperButton,
        { backgroundColor: theme.backgroundSecondary },
        animatedStyle,
      ]}
      onPressIn={() => {
        if (!reducedMotion) {
          scale.value = withSpring(0.95, pressSpringConfig);
        }
      }}
      onPressOut={() => {
        if (!reducedMotion) {
          scale.value = withSpring(1, pressSpringConfig);
        }
      }}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <Feather name={icon} size={18} color={theme.text} accessible={false} />
    </AnimatedPressable>
  );
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
    <View style={styles.container}>
      {/* Serving Size */}
      <View style={styles.servingSection}>
        <ThemedText type="small" style={styles.servingSectionLabel}>
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
              <Chip
                key={opt.grams}
                label={opt.label}
                variant="tab"
                selected={isActive}
                style={styles.servingChip}
                onPress={() => {
                  setShowCustomInput(false);
                  setServingSizeGrams(opt.grams);
                  recalculateNutrition(opt.grams, servingQuantity);
                  haptics.selection();
                }}
                accessibilityLabel={`Set serving to ${opt.label}`}
                accessibilityRole="button"
              />
            );
          })}
          {/* Custom option */}
          <Chip
            label="Custom"
            variant="tab"
            selected={showCustomInput}
            style={styles.servingChip}
            onPress={() => {
              setShowCustomInput(true);
              haptics.selection();
            }}
            accessibilityLabel="Enter custom serving size"
            accessibilityRole="button"
          />
        </ScrollView>

        {showCustomInput ? (
          <View style={styles.customInputRow}>
            <TextInput
              containerStyle={styles.customInput}
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

      {/* Servings quantity */}
      <View style={styles.quantityRow}>
        <ThemedText type="small" style={styles.servingSectionLabel}>
          Servings
        </ThemedText>
        <View style={styles.quantityStepper}>
          <StepperButton
            icon="minus"
            onPress={() => {
              const next = Math.max(0.5, servingQuantity - 0.5);
              setServingQuantity(next);
              if (servingSizeGrams) {
                recalculateNutrition(servingSizeGrams, next);
              }
              haptics.selection();
            }}
            accessibilityLabel="Decrease serving quantity"
          />
          <ThemedText style={styles.quantityValue}>
            {servingQuantity % 1 === 0
              ? servingQuantity
              : servingQuantity.toFixed(1)}
          </ThemedText>
          <StepperButton
            icon="plus"
            onPress={() => {
              const next = servingQuantity + 0.5;
              setServingQuantity(next);
              if (servingSizeGrams) {
                recalculateNutrition(servingSizeGrams, next);
              }
              haptics.selection();
            }}
            accessibilityLabel="Increase serving quantity"
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing["2xl"],
  },
  servingSection: {
    marginBottom: Spacing.xl,
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
    fontSize: 18,
    fontWeight: "600",
    minWidth: 32,
    textAlign: "center",
  },
});
