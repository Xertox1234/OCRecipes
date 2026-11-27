import React from "react";
import { Platform, StyleSheet, Switch, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, withOpacity } from "@/constants/theme";
import { remindersValues } from "@shared/lib/coach-write-card-math";
import {
  REMINDER_LABELS,
  type RemindersCardEdits,
  type RemindersCardPayload,
} from "@shared/schemas/coach-write-cards";

interface Props {
  payload: RemindersCardPayload;
  edits: RemindersCardEdits;
  onEdit: (e: RemindersCardEdits) => void;
}

/**
 * The reminders card's controls (Coach roadmap A3): one switch per reminder
 * type the Coach proposed to change, named and drawn as on the Coach
 * Reminders screen, with how it is now underneath. Nothing changes until
 * the card's Save.
 */
export function RemindersWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const values = remindersValues(payload, edits);

  return (
    <View>
      {payload.changes.map((row, i) => (
        // Layout only: the Switch is the accessible control, as on the
        // settings screen.
        <View key={row.key} style={styles.row}>
          <View style={styles.text}>
            <ThemedText type="body">{REMINDER_LABELS[row.key]}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {/* The card only holds reminders that would change, so each
                  is now the other way from the Coach's proposal. */}
              {row.on ? "Now off" : "Now on"}
            </ThemedText>
          </View>
          <Switch
            accessibilityLabel={REMINDER_LABELS[row.key]}
            value={values[i]}
            onValueChange={(next) => {
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
      ))}
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
