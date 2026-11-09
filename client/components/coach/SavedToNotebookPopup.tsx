import { useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { UnseenSave } from "@/hooks/useNotebookSaves";

/** Long enough to read two short lines and reach Undo. */
const AUTO_CONFIRM_MS = 6000;

interface Props {
  saves: UnseenSave[];
  /** Closed on its own: the user saw it and kept it. */
  onConfirm: () => void;
  onUndo: () => void;
}

/**
 * "Saved to your notebook · Undo" (visible memory R2, approved mockup B):
 * a small popup under the Coach thread bar's Notebook icon. It never takes
 * focus or covers the composer; closing on its own confirms the memory.
 */
export default function SavedToNotebookPopup({
  saves,
  onConfirm,
  onUndo,
}: Props) {
  const { theme } = useTheme();
  const done = useRef(false);

  useEffect(() => {
    if (saves.length === 0) return;
    done.current = false;
    AccessibilityInfo.announceForAccessibility(
      `Saved to your notebook: ${saves.map((s) => `${s.content}.`).join(" ")}`,
    );
    const timer = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      onConfirm();
    }, AUTO_CONFIRM_MS);
    return () => clearTimeout(timer);
    // `saves` is a new array only when a new batch arrives, and `onConfirm`
    // changes with it — so this re-arms per batch, not per render.
  }, [saves, onConfirm]);

  if (saves.length === 0) return null;

  return (
    <View
      style={[styles.popup, { backgroundColor: theme.text }]}
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
        onPress={() => {
          done.current = true;
          onUndo();
        }}
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
    top: 52,
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
