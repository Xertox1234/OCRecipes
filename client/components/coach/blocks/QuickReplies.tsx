import React from "react";
import { ScrollView, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";
import type { QuickReplies as QuickRepliesType } from "@shared/schemas/coach-blocks";

interface Props {
  block: QuickRepliesType;
  // Accepts blockKey so the parent can pass a stable useCallback ref
  // instead of an inline closure (preserves React.memo bail-out).
  onSelect?: (message: string, blockKey?: string) => void;
  blockKey?: string;
  used?: boolean;
}

const QuickReplies = React.memo(function QuickReplies({
  block,
  onSelect,
  blockKey,
  used,
}: Props) {
  const { theme } = useTheme();
  if (used) return null;
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
          onPress={() => onSelect?.(option.message, blockKey)}
          hitSlop={{ top: 7, bottom: 7 }}
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
});

export default QuickReplies;

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
