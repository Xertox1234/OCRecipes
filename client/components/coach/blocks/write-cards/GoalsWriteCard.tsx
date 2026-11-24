import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { goalsValues } from "@shared/lib/coach-write-card-math";
import {
  GOAL_LIMITS,
  type GoalKey,
  type GoalsCardEdits,
  type GoalsCardPayload,
} from "@shared/schemas/coach-write-cards";
import { stepFormNumber } from "../form-utils";
import { CardStepper } from "./CardStepper";

interface Props {
  payload: GoalsCardPayload;
  edits: GoalsCardEdits;
  onEdit: (e: GoalsCardEdits) => void;
}

const LABEL: Record<GoalKey, string> = {
  calories: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
};

const amount = (key: GoalKey, value: number) =>
  `${value.toLocaleString("en-US")} ${key === "calories" ? "cal" : "g"}`;

/**
 * The goals card's controls (Coach roadmap T1): one − / + row per daily goal
 * the Coach proposed, with the goal as it is now underneath. The bounds are
 * the server's too (GOAL_LIMITS); it checks them again at save.
 */
export function GoalsWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const values = goalsValues(payload, edits);

  return (
    <View>
      {payload.rows.map((row, i) => (
        <View key={row.key} style={styles.row}>
          <View style={styles.text}>
            <ThemedText type="body">{LABEL[row.key]}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {row.current === null
                ? "Not set yet"
                : `Now ${amount(row.key, row.current)}`}
            </ThemedText>
          </View>
          <CardStepper
            name={LABEL[row.key]}
            value={values[i]}
            min={GOAL_LIMITS[row.key].min}
            max={GOAL_LIMITS[row.key].max}
            next={(v, delta) => stepFormNumber(GOAL_LIMITS[row.key], v, delta)}
            display={amount(row.key, values[i])}
            onChange={(next) => {
              const nextValues = [...values];
              nextValues[i] = next;
              onEdit({ ...edits, values: nextValues });
            }}
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
