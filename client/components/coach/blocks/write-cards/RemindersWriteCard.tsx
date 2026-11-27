import React from "react";
import { Platform, StyleSheet, Switch, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, withOpacity } from "@/constants/theme";
import { remindersValues } from "@shared/lib/coach-write-card-math";
import {
  REMINDER_LABELS,
  type RemindersCardEdits,
  type RemindersCardPayload,
} from "@shared/schemas/coach-write-cards";
import { reminderRowText } from "./write-card-utils";

interface Props {
  payload: RemindersCardPayload;
  edits: RemindersCardEdits;
  onEdit: (e: RemindersCardEdits) => void;
}

/**
 * The reminders card's controls (Coach roadmap A3): one switch per reminder
 * type the Coach proposed to change, named and drawn as on the Coach
 * Reminders screen, with how it is now and what Save does underneath (the
 * switch's hint says the same to a screen reader). Nothing changes until
 * the card's Save.
 */
export function RemindersWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const values = remindersValues(payload, edits);

  return (
    <View>
      {payload.changes.map((row, i) => {
        const text = reminderRowText(row.on, values[i]);
        return (
          // Layout only: the Switch is the accessible control, as on the
          // settings screen; its hint carries the caption, so the caption
          // is not a second stop.
          <View key={row.key} style={styles.row}>
            <View
              style={styles.text}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <ThemedText type="body">{REMINDER_LABELS[row.key]}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {text.caption}
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel={REMINDER_LABELS[row.key]}
              accessibilityHint={text.hint}
              value={values[i]}
              onValueChange={(next) => {
                haptics.selection();
                const nextValues = [...values];
                nextValues[i] = next;
                onEdit({ ...edits, on: nextValues });
              }}
              trackColor={{
                false: withOpacity(theme.textSecondary, 0.3),
                true: theme.link,
              }}
              thumbColor={
                Platform.OS === "android" ? "#FFFFFF" : undefined // hardcoded
              }
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    minHeight: 44,
    paddingVertical: Spacing.xs,
  },
  text: { flex: 1 },
});
