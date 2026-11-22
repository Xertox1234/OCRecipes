import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import { stackCardRow } from "./write-card-utils";

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
  // At the accessibility text sizes the tag, name and amount stack beside
  // the box; side by side they left the name one letter wide.
  const stacked = stackCardRow(useWindowDimensions().fontScale);
  const tagText = tag ? (
    <ThemedText
      type="caption"
      style={[!stacked && styles.tag, { color: theme.textSecondary }]}
    >
      {tag}
    </ThemedText>
  ) : null;
  const detailText = detail ? (
    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
      {detail}
    </ThemedText>
  ) : null;
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
      {stacked ? null : tagText}
      <View style={styles.text}>
        {stacked ? tagText : null}
        <ThemedText
          type="body"
          style={!checked ? { color: theme.textSecondary } : undefined}
        >
          {label}
        </ThemedText>
        {stacked ? detailText : null}
      </View>
      {stacked ? null : detailText}
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
