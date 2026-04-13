import React from "react";
import { ScrollView, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";
import type { QuickReplies as QuickRepliesType } from "@shared/schemas/coach-blocks";

interface Props {
  block: QuickRepliesType;
  onSelect?: (message: string) => void;
}

export default function QuickReplies({ block, onSelect }: Props) {
  const { theme } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {block.options.map((option, i) => (
        <Pressable
          key={i}
          style={[
            styles.chip,
            {
              backgroundColor: withOpacity(theme.link, 0.15),
              borderColor: withOpacity(theme.link, 0.3),
            },
          ]}
          onPress={() => onSelect?.(option.message)}
          accessibilityRole="button"
          accessibilityLabel={option.label}
        >
          <Text style={[styles.chipText, { color: theme.link }]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  content: { gap: 8, paddingHorizontal: 2 },
  chip: {
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
});
