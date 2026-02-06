import React, { useRef, useCallback } from "react";
import { StyleSheet, View, ActivityIndicator } from "react-native";

import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  PREPARATION_OPTIONS,
  type FoodCategory,
} from "@shared/constants/preparation";

interface PreparationPickerProps {
  category: FoodCategory;
  selectedMethod: string;
  onMethodChange: (method: string) => void;
  isLoading?: boolean;
}

/** Debounce delay for nutrition re-lookup when changing prep method */
const DEBOUNCE_MS = 500;

export function PreparationPicker({
  category,
  selectedMethod,
  onMethodChange,
  isLoading,
}: PreparationPickerProps) {
  const { theme } = useTheme();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = PREPARATION_OPTIONS[category] || PREPARATION_OPTIONS.other;

  const handlePress = useCallback(
    (method: string) => {
      // Clear pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Debounce the callback to prevent rapid re-lookups
      debounceRef.current = setTimeout(() => {
        onMethodChange(method);
      }, DEBOUNCE_MS);
    },
    [onMethodChange],
  );

  return (
    <View
      style={styles.container}
      accessibilityRole="radiogroup"
      accessibilityLabel="Preparation method"
    >
      <View style={styles.chipRow}>
        {options.map((method) => (
          <Chip
            key={method}
            label={method}
            selected={selectedMethod === method}
            onPress={() => handlePress(method)}
            accessibilityLabel={`${method} preparation`}
          />
        ))}
        {isLoading && (
          <ActivityIndicator
            size="small"
            color={theme.link}
            style={styles.loader}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    alignItems: "center",
  },
  loader: {
    marginLeft: Spacing.xs,
  },
});
