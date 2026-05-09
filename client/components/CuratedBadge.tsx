import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";

interface CuratedBadgeProps {
  /** When true, show only the star icon without the "Curated" label. */
  compact?: boolean;
}

export function CuratedBadge({ compact = false }: CuratedBadgeProps) {
  const { theme } = useTheme();
  const color = theme.warning;

  return (
    <View
      style={[styles.container, { backgroundColor: withOpacity(color, 0.15) }]}
      accessible
      accessibilityLabel="Curated recipe"
      accessibilityRole="text"
    >
      <Feather
        name="star"
        size={compact ? 10 : 11}
        color={color}
        accessible={false}
      />
      {!compact && (
        <ThemedText style={[styles.label, { color }]}>Curated</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
