import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { SuggestionList as SuggestionListType } from "@shared/schemas/coach-blocks";

interface Props {
  block: SuggestionListType;
  onAction?: (action: Record<string, unknown>) => void;
}

const SuggestionList = React.memo(function SuggestionList({
  block,
  onAction,
}: Props) {
  const { theme } = useTheme();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
    >
      {block.items.map((item, i) => {
        const divider = i < block.items.length - 1 && {
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        };
        const label = `${item.title}. ${item.subtitle}`;
        const text = (
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: theme.text }]}>
              {item.title}
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>
              {item.subtitle}
            </Text>
          </View>
        );
        const action = item.action;
        // A row without an action is an information line, not an
        // unavailable control: a disabled button read as "dimmed".
        if (!action) {
          return (
            <View
              key={i}
              style={[styles.item, divider]}
              accessible
              accessibilityLabel={label}
            >
              {text}
            </View>
          );
        }
        return (
          <Pressable
            key={i}
            style={({ pressed }) => [
              styles.item,
              divider,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => onAction?.(action as Record<string, unknown>)}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            {text}
            <Text style={[styles.arrow, { color: theme.link }]}>
              {"\u2192"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

export default SuggestionList;

const styles = StyleSheet.create({
  container: { borderRadius: 12, marginTop: 8, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", padding: 10 },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: 13, fontWeight: "600" },
  itemSubtitle: { fontSize: 11, marginTop: 2 },
  arrow: { fontSize: 12 },
});
