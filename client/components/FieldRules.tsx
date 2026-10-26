import React, { useEffect, useRef } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";
import {
  collapseTimingConfig,
  expandTimingConfig,
} from "@/constants/animations";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { announceTogether } from "@/lib/announce-together";
import type { FieldRule } from "@/lib/field-rules";

const ICON_SIZE = 14;

interface FieldRulesProps {
  rules: FieldRule[];
  /** Callers pass `rulesVisible(...)` from `@/lib/field-rules`. */
  visible: boolean;
  /** The field has been checked: an unmet circle turns the error colour. */
  checked?: boolean;
  /**
   * The field's own error is showing and already says what is wrong: drop the
   * unmet lines so the same news is never shown or read twice. Met lines stay.
   */
  hideUnmet?: boolean;
}

/**
 * The live checklist under a field with rules (form-fields spec §5.2): a tick
 * for each met rule, an open circle for each unmet one. The icons are hidden
 * from screen readers and each line reads as its label (", done" when met).
 * The only announcement is "<label>, done" when a rule turns met while shown —
 * never on mount, never for a rule going unmet (the field's error says that).
 * No live region, so the announce runs on both platforms.
 *
 * Opens and closes by animating its height (0 ↔ the measured lines), so the
 * content below glides instead of jumping; reduced motion snaps. It takes no
 * space at rest: place it in the same gapless wrapper as its field — its own
 * top padding sits inside the animated height. Closed, it is hidden from
 * screen readers.
 */
export function FieldRules({
  rules,
  visible,
  checked = false,
  hideUnmet = false,
}: FieldRulesProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  // Last seen met state per rule id, tracked whether or not the list is shown
  // so a flip made while hidden is never announced later.
  const prevMet = useRef<Record<string, boolean> | null>(null);
  const contentHeight = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    const prev = prevMet.current;
    prevMet.current = Object.fromEntries(rules.map((r) => [r.id, r.met]));
    if (!prev || !visible) return;
    for (const rule of rules) {
      if (rule.met && prev[rule.id] === false) {
        announceTogether(`${rule.label}, done`);
      }
    }
  }, [rules, visible]);

  // Open or close: glide to the measured lines, or to 0. Reduced motion snaps.
  useEffect(() => {
    const target = visible ? contentHeight.get() : 0;
    if (reducedMotion) {
      height.set(target);
      return;
    }
    height.set(
      withTiming(target, visible ? expandTimingConfig : collapseTimingConfig),
    );
  }, [visible, reducedMotion, contentHeight, height]);

  // A line added or dropped while open (typing, hideUnmet) changes the
  // measured height: glide to it too.
  const onContentLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.height;
    const previous = contentHeight.get();
    contentHeight.set(measured);
    if (!visible) return;
    if (reducedMotion) {
      height.set(measured);
      return;
    }
    height.set(
      withTiming(
        measured,
        measured >= previous ? expandTimingConfig : collapseTimingConfig,
      ),
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({ height: height.get() }));

  const shown = hideUnmet ? rules.filter((r) => r.met) : rules;

  // success / textSecondary / error all pass 4.5:1 on backgroundRoot in both
  // modes (light 5.1 / 4.95 / 4.62, dark 6.47 / 7.6 / 5.6).
  const unmetColor = checked ? theme.error : theme.textSecondary;

  return (
    <Animated.View
      style={[styles.clip, animatedStyle]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      pointerEvents="none"
    >
      <View
        style={[styles.list, shown.length === 0 && styles.empty]}
        onLayout={onContentLayout}
      >
        {shown.map((rule) => {
          const color = rule.met ? theme.success : unmetColor;
          return (
            <View
              key={rule.id}
              accessible
              accessibilityLabel={rule.met ? `${rule.label}, done` : rule.label}
              style={styles.line}
            >
              <Feather
                name={rule.met ? "check" : "circle"}
                size={ICON_SIZE}
                color={color}
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                testID={`field-rule-icon-${rule.id}`}
              />
              <ThemedText type="small" style={{ color }}>
                {rule.label}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  // Absolute so the clip's animated height never squeezes the measurement.
  list: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  // No lines (all hidden by hideUnmet): measure 0, not the bare padding.
  empty: { paddingTop: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
});
