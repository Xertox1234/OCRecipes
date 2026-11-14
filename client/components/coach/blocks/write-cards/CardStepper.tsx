import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { BorderRadius } from "@/constants/theme";

interface Props {
  value: number;
  /** What is counted, for screen readers ("Large eggs"). */
  name: string;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

/**
 * − value + for a write card row. One adjustable control for screen readers
 * (swipe up/down), two buttons for touch — each a real 44pt box around a
 * 32pt circle (no hitSlop: see touch-targets.test.tsx); each step ticks a
 * selection haptic, and the ends do nothing rather than wrap.
 */
export function CardStepper({
  value,
  name,
  min = 0,
  max = 20,
  onChange,
}: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const step = (delta: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next === value) return;
    haptics.selection();
    onChange(next);
  };
  const button = (delta: 1 | -1) => (
    <PressableScale
      onPress={() => step(delta)}
      disabled={delta < 0 ? value <= min : value >= max}
      accessibilityRole="button"
      accessibilityLabel={`${delta < 0 ? "Fewer" : "More"} ${name}`}
      style={styles.target}
    >
      <View style={[styles.button, { borderColor: theme.border }]}>
        <Feather
          name={delta < 0 ? "minus" : "plus"}
          size={16}
          color={theme.link}
        />
      </View>
    </PressableScale>
  );
  return (
    <View
      style={styles.row}
      accessibilityRole="adjustable"
      accessibilityLabel={name}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) =>
        step(e.nativeEvent.actionName === "increment" ? 1 : -1)
      }
    >
      {button(-1)}
      <ThemedText type="body" style={styles.value}>
        {value}
      </ThemedText>
      {button(1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  target: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  value: { minWidth: 20, textAlign: "center" },
});
