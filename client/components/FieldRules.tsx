import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
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
 */
export function FieldRules({
  rules,
  visible,
  checked = false,
  hideUnmet = false,
}: FieldRulesProps) {
  const { theme } = useTheme();
  // Last seen met state per rule id, tracked whether or not the list is shown
  // so a flip made while hidden is never announced later.
  const prevMet = useRef<Record<string, boolean> | null>(null);

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

  const shown = hideUnmet ? rules.filter((r) => r.met) : rules;
  if (!visible || shown.length === 0) return null;

  // success / textSecondary / error all pass 4.5:1 on backgroundRoot in both
  // modes (light 5.1 / 4.95 / 4.62, dark 6.47 / 7.6 / 5.6).
  const unmetColor = checked ? theme.error : theme.textSecondary;

  return (
    <View style={styles.list}>
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
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.xs },
  line: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
});
