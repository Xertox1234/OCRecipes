import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";

interface Props {
  label: string;
  detail?: string;
  /** A short word before the label (the pantry card's action). */
  tag?: string;
  checked: boolean;
  onToggle: () => void;
}

/** A tick row for a write card: the whole row is the 44pt+ checkbox. */
export function CardCheckRow({ label, detail, tag, checked, onToggle }: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  return (
    <PressableScale
      onPress={() => {
        haptics.selection();
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={[tag, label, detail].filter(Boolean).join(", ")}
      accessibilityState={{ checked }}
      style={styles.row}
    >
      <Feather
        name={checked ? "check-square" : "square"}
        size={20}
        color={checked ? theme.link : theme.textSecondary}
      />
      {tag ? (
        <ThemedText
          type="caption"
          style={[styles.tag, { color: theme.textSecondary }]}
        >
          {tag}
        </ThemedText>
      ) : null}
      <View style={styles.text}>
        <ThemedText
          type="body"
          style={!checked ? { color: theme.textSecondary } : undefined}
        >
          {label}
        </ThemedText>
      </View>
      {detail ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {detail}
        </ThemedText>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Wide enough for "Remove", so the names line up down the card.
  tag: { minWidth: 56 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 44,
    paddingVertical: Spacing.xs,
  },
  text: { flex: 1 },
});
