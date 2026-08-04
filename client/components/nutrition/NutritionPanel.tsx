import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { roundToOneDecimal } from "@/screens/nutrition-detail-utils";
import { BADGE_SEVERITY_FILL_OPACITY } from "@/components/badge-severity-visuals";
import {
  bandTagText,
  bandVisuals,
  composeNutrientRowLabel,
} from "./NutritionPanel-utils";
import type { PanelRowData } from "./nutrition-band-source";

interface NutritionPanelProps {
  rows: PanelRowData[];
  reducedMotion?: boolean;
}

type Theme = ReturnType<typeof useTheme>["theme"];

/**
 * The nutrient table: banded rows (traffic-light judged) above a divider,
 * unbanded rows (no published standard — trans fat, cholesterol, caffeine)
 * below, in one Card. Renders exactly what `buildPanelRows` (Task 2) decided
 * — this component makes NO band decisions of its own, and never upgrades an
 * unresolvable band into a colour (safety invariant 1).
 *
 * Returns `null` only when there are no rows at all. A row with no value
 * still renders as "Not recorded" — the panel never vanishes just because
 * every row came back unknown, which would read as "nothing to worry about".
 */
export function NutritionPanel({ rows, reducedMotion }: NutritionPanelProps) {
  const { theme } = useTheme();

  if (rows.length === 0) return null;

  const bandedRows = rows.filter((data) => data.row.zone === "banded");
  const unbandedRows = rows.filter((data) => data.row.zone === "unbanded");

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInUp.delay(350).duration(400)}
    >
      <Card>
        {bandedRows.map((data) => (
          <NutrientRow key={data.row.key} data={data} theme={theme} />
        ))}
        {bandedRows.length > 0 && unbandedRows.length > 0 ? (
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
        ) : null}
        {unbandedRows.map((data) => (
          <NutrientRow key={data.row.key} data={data} theme={theme} quiet />
        ))}
      </Card>
    </Animated.View>
  );
}

/**
 * One row. `quiet` (unbanded-zone rows) drops the dot-column reservation
 * entirely and mutes the label — banded-zone rows keep the column even when
 * `visuals` is null (an "unknown" band), so sibling labels in that zone stay
 * aligned regardless of which rows carry a dot.
 */
function NutrientRow({
  data,
  theme,
  quiet = false,
}: {
  data: PanelRowData;
  theme: Theme;
  quiet?: boolean;
}) {
  const { row, displayValue, band } = data;
  // An unresolvable/absent band (`band === null`, or `bandTagText`/`bandVisuals`
  // returning null for an "unknown" band) renders NEITHER a dot nor a pill —
  // never a fabricated colour. Guarded together so TS narrows both from one
  // check before either indexes `theme[visuals.colorKey]`.
  const tag = band ? bandTagText(band) : null;
  const visuals = band ? bandVisuals(band) : null;
  const label = composeNutrientRowLabel({ row, value: displayValue, tag });

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {quiet ? null : (
        <View style={styles.dotColumn}>
          {visuals ? (
            <View
              testID={`band-indicator-${row.key}`}
              accessible={false}
              importantForAccessibility="no"
              accessibilityElementsHidden
              aria-hidden
              style={[styles.dot, { backgroundColor: theme[visuals.colorKey] }]}
            />
          ) : null}
        </View>
      )}

      <ThemedText
        type="body"
        style={[styles.label, quiet ? { color: theme.textSecondary } : null]}
      >
        {row.label}
      </ThemedText>

      <View style={styles.valueCell}>
        {displayValue === undefined ? (
          <>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {"— "}
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Not recorded
            </ThemedText>
          </>
        ) : (
          <ThemedText type="body" style={styles.value}>
            {roundToOneDecimal(displayValue)} {row.unit}
          </ThemedText>
        )}
      </View>

      {tag && visuals ? (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: withOpacity(
                theme[visuals.colorKey],
                BADGE_SEVERITY_FILL_OPACITY,
              ),
            },
          ]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          aria-hidden
        >
          <Feather
            name={visuals.icon}
            size={12}
            color={theme[visuals.colorKey]}
            accessible={false}
          />
          <ThemedText
            type="caption"
            style={[styles.tagText, { color: theme[visuals.colorKey] }]}
          >
            {tag}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  dotColumn: {
    width: 12,
    alignItems: "center",
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    flex: 1,
  },
  valueCell: {
    flexDirection: "row",
  },
  value: {
    fontWeight: "600",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  tagText: {
    fontWeight: "600",
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.xs,
  },
});
