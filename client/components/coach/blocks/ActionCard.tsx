import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: ActionCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function ActionCard({ block, onAction }: Props) {
  const { theme } = useTheme();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={false}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {block.subtitle}
        </Text>
      </View>
      <Pressable
        style={[styles.button, { backgroundColor: theme.link }]}
        onPress={() => onAction?.(block.action as Record<string, unknown>)}
        accessibilityRole="button"
        accessibilityLabel={block.actionLabel}
      >
        <Text style={styles.buttonText}>{block.actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: { flex: 1, marginRight: 12 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  button: {
    minHeight: 44,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" }, // hardcoded
});
