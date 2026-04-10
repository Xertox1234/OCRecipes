import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { SuggestionList as SuggestionListType } from "@shared/schemas/coach-blocks";

interface Props {
  block: SuggestionListType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function SuggestionList({ block, onAction }: Props) {
  const { theme } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      {block.items.map((item, i) => (
        <Pressable
          key={i}
          style={[
            styles.item,
            i < block.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
          ]}
          onPress={() => item.action && onAction?.(item.action as Record<string, unknown>)}
          disabled={!item.action}
          accessibilityRole={item.action ? "button" : "text"}
          accessibilityLabel={`${item.title}. ${item.subtitle}`}
        >
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: theme.text }]}>{item.title}</Text>
            <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>{item.subtitle}</Text>
          </View>
          {item.action && (
            <Text style={[styles.arrow, { color: theme.link }]}>{"\u2192"}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, marginTop: 8, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", padding: 10 },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: 13, fontWeight: "600" },
  itemSubtitle: { fontSize: 11, marginTop: 2 },
  arrow: { fontSize: 12 },
});
