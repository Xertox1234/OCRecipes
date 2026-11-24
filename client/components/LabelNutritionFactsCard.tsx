import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { scaleByServings, type NutrientRow } from "@/lib/label-analysis-utils";

interface LabelNutritionFactsCardProps {
  macroRows: NutrientRow[];
  microRows: NutrientRow[];
  servings: number;
  dataSource: "local" | "ai" | null;
  showMicros: boolean;
  onToggleMicros: () => void;
}

/** The "Nutrition Facts" table of LabelAnalysisScreen. */
export function LabelNutritionFactsCard({
  macroRows,
  microRows,
  servings,
  dataSource,
  showMicros,
  onToggleMicros,
}: LabelNutritionFactsCardProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  return (
    <Card elevation={1} style={styles.nutritionCard}>
      <View style={styles.nutritionTitleRow}>
        <ThemedText type="h3">Nutrition Facts</ThemedText>
        {dataSource === "local" && (
          <View
            style={[
              styles.sourceBadge,
              { backgroundColor: withOpacity(theme.info, 0.12) },
            ]}
          >
            <Feather name="smartphone" size={12} color={theme.info} />
            <ThemedText
              type="small"
              style={{ color: theme.badgeInfoText, fontWeight: "600" }}
            >
              Scanned locally
            </ThemedText>
          </View>
        )}
      </View>
      <View style={[styles.dividerThick, { backgroundColor: theme.text }]} />

      {macroRows.map((row, index) => {
        const scaledValue = scaleByServings(row.value, servings, 1);
        return (
          <Animated.View
            key={row.label}
            entering={
              reducedMotion
                ? undefined
                : FadeInUp.delay(index * 30).duration(250)
            }
          >
            <View
              style={[
                styles.nutrientRow,
                row.bold && styles.nutrientRowBold,
                { borderBottomColor: withOpacity(theme.text, 0.1) },
              ]}
            >
              <ThemedText
                type="body"
                style={[
                  row.indented && styles.indented,
                  row.bold && { fontWeight: "700" },
                ]}
              >
                {row.label}
              </ThemedText>
              <ThemedText
                type="body"
                style={row.bold ? { fontWeight: "700" } : undefined}
              >
                {scaledValue != null ? `${scaledValue}${row.unit}` : "—"}
              </ThemedText>
            </View>
          </Animated.View>
        );
      })}

      {/* Micronutrients (collapsible) */}
      {microRows.some((r) => r.value != null) && (
        <>
          <Pressable
            onPress={onToggleMicros}
            accessibilityRole="button"
            accessibilityLabel={
              showMicros
                ? "Hide vitamins and minerals"
                : "Show vitamins and minerals"
            }
            style={[
              styles.microToggle,
              { borderBottomColor: withOpacity(theme.text, 0.1) },
            ]}
          >
            <ThemedText
              type="body"
              style={{ color: theme.link, fontWeight: "600" }}
            >
              Vitamins & Minerals
            </ThemedText>
            <Feather
              name={showMicros ? "chevron-up" : "chevron-down"}
              size={18}
              color={theme.link}
            />
          </Pressable>

          {showMicros &&
            microRows.map((row) => {
              const scaledValue = scaleByServings(row.value, servings, 1);
              return (
                <View
                  key={row.label}
                  style={[
                    styles.nutrientRow,
                    {
                      borderBottomColor: withOpacity(theme.text, 0.1),
                    },
                  ]}
                >
                  <ThemedText type="body">{row.label}</ThemedText>
                  <ThemedText type="body">
                    {scaledValue != null ? `${scaledValue}${row.unit}` : "—"}
                  </ThemedText>
                </View>
              );
            })}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  nutritionCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  nutritionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sourceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  dividerThick: {
    height: 3,
    marginBottom: Spacing.sm,
  },
  nutrientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nutrientRowBold: {
    borderBottomWidth: 1,
  },
  indented: {
    paddingLeft: Spacing.lg,
  },
  microToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
