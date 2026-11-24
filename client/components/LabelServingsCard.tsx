import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { servingsCountLabel } from "@/screens/label-analysis-utils";

interface LabelServingsCardProps {
  servingSize: string | null | undefined;
  servings: number;
  onAdjust: (delta: number) => void;
}

/** The serving-size row and servings stepper of LabelAnalysisScreen. */
export function LabelServingsCard({
  servingSize,
  servings,
  onAdjust,
}: LabelServingsCardProps) {
  const { theme } = useTheme();

  return (
    <Card elevation={1} style={styles.servingCard}>
      <View style={styles.servingSizeRow}>
        <ThemedText type="body" style={{ fontWeight: "600" }}>
          Serving Size
        </ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          {servingSize || "—"}
        </ThemedText>
      </View>

      <View style={styles.servingAdjuster}>
        <ThemedText type="body" style={{ fontWeight: "600" }}>
          Servings consumed
        </ThemedText>
        <View style={styles.servingControls}>
          <Pressable
            onPress={() => onAdjust(-0.5)}
            accessibilityLabel="Decrease servings"
            accessibilityRole="button"
            hitSlop={4}
            style={[
              styles.servingButton,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
          >
            <Feather name="minus" size={18} color={theme.link} />
          </Pressable>
          <ThemedText
            type="h3"
            style={styles.servingValue}
            accessibilityLabel={servingsCountLabel(servings)}
          >
            {servings}
          </ThemedText>
          <Pressable
            onPress={() => onAdjust(0.5)}
            accessibilityLabel="Increase servings"
            accessibilityRole="button"
            hitSlop={4}
            style={[
              styles.servingButton,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
          >
            <Feather name="plus" size={18} color={theme.link} />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  servingCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  servingSizeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  servingAdjuster: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  servingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    // RN clips hitSlop to the parent view's bounds — this row had no padding,
    // so it was exactly button-edge-to-button-edge and the +/- buttons'
    // hitSlop={4} had nowhere to expand into on any axis. Padding gives it
    // that room without changing the visible 36x36 button size.
    padding: Spacing.xs,
  },
  servingButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  servingValue: {
    minWidth: 32,
    textAlign: "center",
  },
});
