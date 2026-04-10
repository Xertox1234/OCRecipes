import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { MealPlanCard as MealPlanCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: MealPlanCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function MealPlanCard({ block, onAction }: Props) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]} role="group" accessibilityLabel={`Meal plan: ${block.title}`}>
      <Pressable onPress={() => setExpanded(!expanded)} style={styles.header} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse meal plan" : "Expand meal plan"}>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <Text style={{ color: theme.textSecondary }}>{expanded ? "\u25B2" : "\u25BC"}</Text>
      </Pressable>

      {expanded && block.days.map((day, di) => (
        <View key={di} style={styles.day}>
          <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>{day.label}</Text>
          {day.meals.map((meal, mi) => (
            <View key={mi} style={styles.meal}>
              <Text style={[styles.mealType, { color: theme.textSecondary }]}>{meal.type}</Text>
              <Text style={[styles.mealTitle, { color: theme.text }]}>{meal.title}</Text>
              <Text style={[styles.mealMeta, { color: theme.textSecondary }]}>
                {meal.calories} cal {"\u00B7"} {meal.protein}g P
              </Text>
            </View>
          ))}
          <View style={[styles.totals, { borderTopColor: theme.border }]}>
            <Text style={[styles.totalsText, { color: theme.text }]}>
              Total: {day.totals.calories} cal {"\u00B7"} {day.totals.protein}g protein
            </Text>
          </View>
        </View>
      ))}

      {expanded && (
        <Pressable
          style={[styles.addBtn, { backgroundColor: theme.link }]}
          onPress={() => onAction?.({ type: "add_meal_plan", plan: block.days })}
          accessibilityRole="button"
          accessibilityLabel="Add to meal plan"
        >
          <Text style={styles.addBtnText}>Add to Meal Plan</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, marginTop: 8, overflow: "hidden" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12 },
  title: { fontSize: 14, fontWeight: "600" },
  day: { paddingHorizontal: 12, paddingBottom: 8 },
  dayLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  meal: { paddingVertical: 4 },
  mealType: { fontSize: 10, textTransform: "capitalize" },
  mealTitle: { fontSize: 13, fontWeight: "500" },
  mealMeta: { fontSize: 11 },
  totals: { borderTopWidth: 1, paddingTop: 6, marginTop: 4 },
  totalsText: { fontSize: 12, fontWeight: "600" },
  addBtn: { margin: 12, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  addBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
});
