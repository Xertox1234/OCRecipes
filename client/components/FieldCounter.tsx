import React, { useEffect, useRef } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { announceTogether } from "@/lib/announce-together";

/** The longest chat message the server accepts (`content.max(2000)`). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

export type CounterTone = "normal" | "near" | "at";

/** `near` inside the last tenth of the limit, `at` once it is reached. */
export function counterTone(length: number, max: number): CounterTone {
  if (length >= max) return "at";
  if (max - length <= Math.ceil(max * 0.1)) return "near";
  return "normal";
}

interface FieldCounterProps {
  length: number;
  max: number;
  /** Show the count — callers pass the field's focus state. */
  visible: boolean;
  /**
   * Float the counter over the edge of a bar whose layout must not change
   * (a message composer): it rides just above the bar's top edge, right-aligned.
   */
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * `length/max` under a limited field, right-aligned. Its line is always
 * reserved so appearing never shifts the layout. The text is hidden from
 * screen readers; entering `near` and `at` is announced instead, once each.
 */
export function FieldCounter({
  length,
  max,
  visible,
  overlay,
  style,
}: FieldCounterProps) {
  const { theme } = useTheme();
  const tone = counterTone(length, max);
  const prevTone = useRef(tone);

  useEffect(() => {
    const prev = prevTone.current;
    prevTone.current = tone;
    if (!visible || tone === prev) return;
    if (tone === "near") {
      announceTogether(`${max - length} characters left`);
    } else if (tone === "at") {
      announceTogether("Character limit reached");
    }
  }, [tone, visible, length, max]);

  // textSecondary / error pass 4.5:1 in both modes; the plain `warning` token
  // is 2.5:1 on the light page, so the AA-checked badge variant carries it.
  const color =
    tone === "at"
      ? theme.error
      : tone === "near"
        ? theme.badgeWarningText
        : theme.textSecondary;

  return (
    <View
      style={[styles.line, overlay && styles.overlay, style]}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      pointerEvents="none"
    >
      {visible ? (
        <ThemedText type="caption" style={{ color }}>
          {length}/{max}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { minHeight: 20, alignItems: "flex-end", justifyContent: "center" },
  overlay: { position: "absolute", right: Spacing.md, top: -22 },
});
