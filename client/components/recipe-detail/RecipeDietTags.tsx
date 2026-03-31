import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface RecipeDietTagsProps {
  tags: string[];
}

export function RecipeDietTags({ tags }: RecipeDietTagsProps) {
  return (
    <View style={styles.tagRow}>
      {tags.map((tag) => (
        <TagPill key={tag} tag={tag} />
      ))}
    </View>
  );
}

function TagPill({ tag }: { tag: string }) {
  const { theme } = useTheme();

  return (
    <View
      style={[styles.tag, { backgroundColor: withOpacity(theme.link, 0.1) }]}
    >
      <ThemedText style={[styles.tagText, { color: theme.link }]}>
        {tag}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  tag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.tag,
  },
  tagText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
