import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing } from "@/constants/theme";
import type {
  PlanCardEdits,
  PlanCardPayload,
} from "@shared/schemas/coach-write-cards";
import { CardCheckRow } from "./CardCheckRow";
import { rowDivider } from "./WriteCardShell";
import { mealChipLabel, planDayLabel } from "./write-card-utils";

interface Props {
  payload: PlanCardPayload;
  edits: PlanCardEdits;
  onEdit: (e: PlanCardEdits) => void;
}

const SHOPPING_LABEL = "Also add the shopping to my grocery list";

/**
 * The plan card's controls: a row per day with Swap (two or three
 * alternatives, picked in place) and Remove, then the optional shopping tick.
 */
export function PlanWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const [openRow, setOpenRow] = useState<number | null>(null);
  const n = payload.rows.length;
  const removed = payload.rows.map((_, i) => edits.removed?.[i] ?? false);
  const chosen = payload.rows.map((_, i) => edits.chosen?.[i] ?? null);

  const setRemoved = (i: number, value: boolean) => {
    const next = [...removed];
    next[i] = value;
    if (openRow === i) setOpenRow(null);
    onEdit({ ...edits, removed: next });
  };
  const choose = (i: number, alt: number | null) => {
    const next = [...chosen];
    next[i] = alt;
    haptics.selection();
    setOpenRow(null);
    onEdit({ ...edits, chosen: next });
  };

  return (
    <View>
      {payload.rows.map((row, i) => {
        const pick = chosen[i];
        const recipe =
          pick != null && row.alternatives[pick]
            ? row.alternatives[pick]
            : row.recipe;
        const day = `${planDayLabel(row.plannedDate)} · ${mealChipLabel(row.mealType)}`;
        const options = [row.recipe, ...row.alternatives];
        return (
          <View
            key={`${row.plannedDate}-${row.mealType}-${i}`}
            style={[styles.row, i < n - 1 && rowDivider(theme.border)]}
          >
            <View style={removed[i] ? styles.removed : undefined}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {day}
              </ThemedText>
              <ThemedText type="body">{recipe.title}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {recipe.calories} cal · {recipe.protein} g protein
              </ThemedText>
              {row.alreadyPlanned ? (
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  {`Already planned: ${row.alreadyPlanned}`}
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.actions}>
              {removed[i] ? (
                <Button
                  variant="ghost"
                  onPress={() => setRemoved(i, false)}
                  accessibilityLabel={`Add back ${recipe.title}`}
                >
                  Add back
                </Button>
              ) : (
                <>
                  {row.alternatives.length > 0 ? (
                    <Button
                      variant="ghost"
                      onPress={() => setOpenRow(openRow === i ? null : i)}
                      accessibilityLabel={`Swap ${recipe.title}`}
                    >
                      Swap
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onPress={() => setRemoved(i, true)}
                    accessibilityLabel={`Remove ${recipe.title}`}
                  >
                    Remove
                  </Button>
                </>
              )}
            </View>
            {openRow === i && !removed[i] ? (
              <Animated.View
                entering={reducedMotion ? undefined : FadeIn}
                style={styles.picker}
                accessibilityRole="radiogroup"
              >
                {options.map((o, oi) => {
                  const altIndex = oi === 0 ? null : oi - 1;
                  return (
                    <Chip
                      key={`${o.source}-${o.id}`}
                      label={`${o.title}, ${o.calories} cal`}
                      variant="outline"
                      accessibilityRole="radio"
                      selected={pick === altIndex}
                      onPress={() => choose(i, altIndex)}
                    />
                  );
                })}
              </Animated.View>
            ) : null}
          </View>
        );
      })}
      {payload.shoppingListId !== null ? (
        <CardCheckRow
          label={SHOPPING_LABEL}
          checked={edits.addShopping ?? false}
          onToggle={() =>
            onEdit({ ...edits, addShopping: !(edits.addShopping ?? false) })
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: Spacing.sm },
  removed: { opacity: 0.45 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.xs,
  },
  picker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});
