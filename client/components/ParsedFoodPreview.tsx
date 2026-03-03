import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { formatMacroLine } from "./parsed-food-preview-utils";
import type { ParsedFoodItem } from "@/hooks/useFoodParse";

interface ParsedFoodPreviewProps {
  items: ParsedFoodItem[];
  onRemoveItem: (index: number) => void;
  onLogAll: () => void;
  isLogging: boolean;
}

export const ParsedFoodPreview = React.memo(function ParsedFoodPreview({
  items,
  onRemoveItem,
  onLogAll,
  isLogging,
}: ParsedFoodPreviewProps) {
  const { theme } = useTheme();

  if (items.length === 0) return null;

  return (
    <Card elevation={1} style={styles.container}>
      <ThemedText type="h4" style={styles.title}>
        Parsed Items
      </ThemedText>
      {items.map((item, index) => (
        <View
          key={index}
          style={[styles.itemRow, { borderBottomColor: theme.border }]}
        >
          <View style={styles.itemInfo}>
            <ThemedText style={styles.itemName}>
              {item.quantity} {item.unit} {item.name}
            </ThemedText>
            {item.calories != null && (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {formatMacroLine(
                  item.calories,
                  item.protein,
                  item.carbs,
                  item.fat,
                )}
              </ThemedText>
            )}
          </View>
          <Pressable
            onPress={() => onRemoveItem(index)}
            accessibilityLabel={`Remove ${item.name}`}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.removeButton}
          >
            <Feather name="x" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={onLogAll}
        disabled={isLogging}
        accessibilityLabel="Log all parsed items"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.logAllButton,
          {
            backgroundColor: theme.link,
            opacity: pressed || isLogging ? 0.7 : 1,
          },
        ]}
      >
        <Feather name="check" size={18} color={theme.buttonText} />
        <ThemedText style={[styles.logAllText, { color: theme.buttonText }]}>
          Log All ({items.length})
        </ThemedText>
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  title: {
    marginBottom: Spacing.sm,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  itemInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  itemName: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
    textTransform: "capitalize",
  },
  removeButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  logAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    height: 44,
    borderRadius: BorderRadius.xs,
    marginTop: Spacing.md,
  },
  logAllText: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
});
