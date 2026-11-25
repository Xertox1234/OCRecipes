import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import type { HandsFreePhase } from "@/hooks/useHandsFree";
import { handsFreeStatus } from "@/components/coach/hands-free-utils";

interface Props {
  phase: HandsFreePhase;
  onStop: () => void;
}

/**
 * Shown above the message box while hands-free runs: where the loop is, and
 * a Stop button that is always there (the mic button is not, once a
 * transcript fills the box).
 */
export default function CoachHandsFreeBar({ phase, onStop }: Props) {
  const { theme } = useTheme();
  const status = handsFreeStatus(phase);
  if (!status) return null;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.backgroundSecondary,
          borderTopColor: theme.border,
        },
      ]}
    >
      <Ionicons
        name="headset"
        size={18}
        color={theme.link}
        accessible={false}
      />
      <View style={styles.text} accessible accessibilityRole="text">
        <Text style={[styles.title, { color: theme.text }]}>Hands-free</Text>
        <Text style={[styles.status, { color: theme.textSecondary }]}>
          {status}
        </Text>
      </View>
      <Pressable
        onPress={onStop}
        style={[styles.stop, { borderColor: theme.border }]}
        accessibilityRole="button"
        accessibilityLabel="Stop hands-free"
      >
        <Text style={[styles.stopText, { color: theme.text }]}>Stop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  text: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
  },
  title: {
    ...Typography.small,
    fontWeight: "600",
  },
  status: {
    ...Typography.small,
  },
  stop: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: Spacing.md,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stopText: {
    ...Typography.small,
    fontWeight: "600",
  },
});
