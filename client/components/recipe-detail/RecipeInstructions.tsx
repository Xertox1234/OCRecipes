import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

export function RecipeInstructions({
  instructions,
}: {
  instructions: string[];
}) {
  const { theme } = useTheme();

  if (!instructions || instructions.length === 0) return null;

  return (
    <View
      style={styles.section}
      accessibilityRole="list"
      accessibilityLabel={`Instructions, ${instructions.length} steps`}
    >
      <ThemedText
        type="h4"
        style={styles.sectionTitle}
        accessibilityRole="header"
      >
        Instructions
      </ThemedText>
      {instructions.map((step, i) => (
        <View
          key={i}
          style={[
            styles.stepCard,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
          accessible
          accessibilityLabel={`Step ${i + 1} of ${instructions.length}: ${step}`}
        >
          <View
            style={[styles.stepCircle, { backgroundColor: theme.link }]}
            accessible={false}
          >
            <ThemedText style={styles.stepNumber}>{i + 1}</ThemedText>
          </View>
          <ThemedText style={styles.stepText}>{step}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  stepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  stepNumber: {
    color: "#FFFFFF", // hardcoded
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 4,
  },
});
