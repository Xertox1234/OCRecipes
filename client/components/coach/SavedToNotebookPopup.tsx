import { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { UnseenSave } from "@/hooks/useNotebookSaves";

interface Props {
  saves: UnseenSave[];
  onUndo: () => void;
  /** Distance from the screen top to just under the thread bar. */
  top: number;
}

/**
 * "Saved to your notebook · Undo" (visible memory R2, approved mockup B):
 * a small popup under the Coach thread bar's Notebook icon. It never takes
 * focus or covers the composer. It has no timer (WCAG 2.2.1): the screen
 * confirms the memory on the user's next action — the next message sent, or
 * leaving the screen.
 */
export default function SavedToNotebookPopup({ saves, onUndo, top }: Props) {
  const { theme } = useTheme();

  useEffect(() => {
    if (saves.length === 0) return;
    // Queued: the popup appears as a reply ends, and an unqueued iOS
    // announcement would cut off the reply's own.
    AccessibilityInfo.announceForAccessibilityWithOptions(
      `Saved to your notebook: ${saves.map((s) => `${s.content}.`).join(" ")}`,
      { queue: true },
    );
    // `saves` is a new array only when a new batch arrives.
  }, [saves]);

  if (saves.length === 0) return null;

  return (
    <View
      testID="saved-to-notebook-popup"
      style={[styles.popup, { top, backgroundColor: theme.text }]}
      pointerEvents="box-none"
    >
      <ThemedText type="caption" style={{ color: theme.backgroundSecondary }}>
        Saved to your notebook
      </ThemedText>
      {saves.map((s) => (
        <ThemedText
          key={s.id}
          type="small"
          style={[styles.item, { color: theme.backgroundDefault }]}
        >
          {s.content}
        </ThemedText>
      ))}
      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        accessibilityLabel="Undo"
        style={styles.undo}
        hitSlop={8}
      >
        <ThemedText
          type="small"
          // High-contrast on the inverted popup in both themes; weight and
          // underline set it apart from the saved text.
          style={[styles.undoText, { color: theme.backgroundDefault }]}
        >
          Undo
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  popup: {
    position: "absolute",
    right: Spacing.md,
    maxWidth: 260,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    zIndex: 10,
    elevation: 6,
  },
  item: { fontFamily: FontFamily.semiBold, marginTop: 2 },
  undo: {
    alignSelf: "flex-end",
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  undoText: {
    fontFamily: FontFamily.semiBold,
    textDecorationLine: "underline",
  },
});
