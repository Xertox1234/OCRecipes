import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { foodCounts } from "@shared/lib/coach-write-card-math";
import type {
  FoodCardEdits,
  FoodCardPayload,
  WriteCardDay,
  WriteCardMealType,
} from "@shared/schemas/coach-write-cards";
import { CardStepper } from "./CardStepper";
import { rowDivider } from "./WriteCardShell";
import { dayChipLabel, mealChipLabel } from "./write-card-utils";

const MEALS: WriteCardMealType[] = ["breakfast", "lunch", "dinner", "snack"];
const DAYS: WriteCardDay[] = ["today", "yesterday"];

interface Props {
  payload: FoodCardPayload;
  edits: FoodCardEdits;
  onEdit: (e: FoodCardEdits) => void;
}

/** The food card's controls: a stepper per item, then day and meal chips. */
export function FoodWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const counts = foodCounts(payload, edits);
  const meal = edits.mealType ?? payload.mealType;
  const day = edits.day ?? payload.day;

  return (
    <View>
      {payload.items.map((item, i) => (
        <View
          key={`${item.name}-${i}`}
          style={[
            styles.row,
            i < payload.items.length - 1 && rowDivider(theme.border),
          ]}
        >
          <View style={styles.itemText}>
            <ThemedText type="body">{item.name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {Math.round(item.perUnit.calories)} cal per {item.unitLabel}
            </ThemedText>
          </View>
          <CardStepper
            value={counts[i]}
            name={item.name}
            onChange={(n) => {
              const next = [...counts];
              next[i] = n;
              onEdit({ ...edits, counts: next });
            }}
          />
        </View>
      ))}
      <View style={styles.chips} accessibilityRole="radiogroup">
        {DAYS.map((d) => (
          <Chip
            key={d}
            label={dayChipLabel(d)}
            variant="outline"
            accessibilityRole="radio"
            selected={day === d}
            onPress={() => onEdit({ ...edits, day: d })}
          />
        ))}
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {MEALS.map((m) => (
          <Chip
            key={m}
            label={mealChipLabel(m)}
            variant="outline"
            accessibilityRole="radio"
            selected={meal === m}
            onPress={() => onEdit({ ...edits, mealType: m })}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  itemText: { flex: 1 },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
});
