import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import type {
  FinderButton,
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import {
  FINDER_BUTTON_LABELS,
  formatItemMeta,
  itemAccessibilityLabel,
  noticeText,
  resultsAnnouncement,
  resultsHeader,
} from "./recipe-finder-utils";

export interface RecipeResultsListProps {
  block: RecipeResultsBlock;
  /** Only the latest finder message's buttons are live (spec §4). */
  isActive: boolean;
  lockedButtons?: FinderButton[];
  onButton: (button: FinderButton) => void;
  onOpenItem: (item: FinderItem) => void;
}

const THUMB = 48;
const NO_LOCKS: FinderButton[] = [];

export const RecipeResultsList = React.memo(function RecipeResultsList({
  block,
  isActive,
  lockedButtons = NO_LOCKS,
  onButton,
  onOpenItem,
}: RecipeResultsListProps) {
  const { theme } = useTheme();
  // No live region covers the list's arrival, so announce on both platforms,
  // once per flow, and only for the live (latest) list.
  const announcedFlowRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive || announcedFlowRef.current === block.flow.flowId) return;
    announcedFlowRef.current = block.flow.flowId;
    AccessibilityInfo.announceForAccessibility(resultsAnnouncement(block));
  }, [isActive, block]);

  const header = resultsHeader(block.source);
  const notice = noticeText(block.notice, block.source);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      <ThemedText style={styles.header} accessibilityRole="header">
        {header}
      </ThemedText>
      {notice ? (
        <ThemedText style={[styles.notice, { color: theme.textSecondary }]}>
          {notice}
        </ThemedText>
      ) : null}
      {block.items.length > 0 ? (
        <View accessibilityRole="list" accessibilityLabel={header}>
          {block.items.map((item) => {
            const meta = formatItemMeta(item);
            return (
              <Pressable
                key={`${item.source}:${item.id}`}
                onPress={() => onOpenItem(item)}
                accessibilityRole="button"
                accessibilityLabel={itemAccessibilityLabel(item)}
                style={styles.row}
              >
                {item.imageUrl ? (
                  <FallbackImage
                    source={{ uri: item.imageUrl }}
                    style={styles.thumb}
                    fallbackIcon="book-open"
                    fallbackIconSize={20}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    testID="finder-thumb-placeholder"
                    style={[
                      styles.thumb,
                      styles.placeholder,
                      { backgroundColor: withOpacity(theme.link, 0.1) },
                    ]}
                  >
                    <Feather
                      name="book-open"
                      size={20}
                      color={theme.link}
                      accessible={false}
                    />
                  </View>
                )}
                <View style={styles.rowText}>
                  <ThemedText numberOfLines={2} style={styles.title}>
                    {item.title}
                  </ThemedText>
                  {meta ? (
                    <ThemedText
                      style={[styles.meta, { color: theme.textSecondary }]}
                    >
                      {meta}
                    </ThemedText>
                  ) : null}
                </View>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={theme.textSecondary}
                  accessible={false}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {block.actions.length > 0 ? (
        <View style={styles.buttons}>
          {block.actions.map((button) => {
            const label = FINDER_BUTTON_LABELS[button];
            const locked = lockedButtons.includes(button);
            const filled = button === "generate";
            const fg = filled ? theme.buttonText : theme.link;
            return (
              <Pressable
                key={button}
                onPress={() => onButton(button)}
                disabled={!isActive}
                accessibilityRole="button"
                accessibilityLabel={
                  locked ? `${label}. Premium feature` : label
                }
                accessibilityState={{ disabled: !isActive }}
                style={[
                  styles.button,
                  filled
                    ? { backgroundColor: theme.accentSolid }
                    : { borderWidth: 1, borderColor: theme.link },
                  !isActive && styles.inactive,
                ]}
              >
                {locked ? (
                  <Feather
                    name="lock"
                    size={14}
                    color={fg}
                    accessible={false}
                  />
                ) : null}
                <ThemedText style={[styles.buttonText, { color: fg }]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  header: { fontSize: 14, fontWeight: "600" },
  notice: { fontSize: 13 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: BorderRadius.xs },
  placeholder: { alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  title: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  buttonText: { fontSize: 14, fontWeight: "600" },
  inactive: { opacity: 0.45 },
});
