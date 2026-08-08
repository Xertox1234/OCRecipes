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
      entering={reducedMotion ? undefined : FadeInUp.delay(300).duration(400)}
      style={styles.panel}
    >
      <Card>
        {bandedRows.map((data) => (
          <NutrientRow key={data.row.key} data={data} />
        ))}
        {bandedRows.length > 0 && unbandedRows.length > 0 ? (
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
        ) : null}
        {unbandedRows.map((data) => (
          <NutrientRow key={data.row.key} data={data} quiet />
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
  quiet = false,
}: {
  data: PanelRowData;
  quiet?: boolean;
}) {
  const { theme } = useTheme();
  const { row, displayValue, band } = data;
  // The dot and pill require BOTH a resolvable band AND a recorded value.
  // An unresolvable/absent band (`band === null`, or `bandTagText`/
  // `bandVisuals` returning null for an "unknown" band) renders neither —
  // never a fabricated colour. Gating on `band` alone would also let a row
  // with `displayValue: undefined` but a resolvable `band` show a coloured
  // indicator next to a value cell that reads "Not recorded" — a
  // visible/spoken split, since `composeNutrientRowLabel` already drops the
  // tag whenever `value === undefined`. Gate on `displayValue`, not
  // `hasValue`: `hasValue` reads the band SOURCE's raw value
  // (`validatedData.per100g` on the scan path), a different object from
  // `displayValue` (`nutrition`) — see nutrition-band-source.ts's own
  // docblock — so it would not suppress the indicator in exactly the
  // divergent case this guards against.
  const tag = band && displayValue !== undefined ? bandTagText(band) : null;
  const visuals = band && displayValue !== undefined ? bandVisuals(band) : null;
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
  // On the component's OWN root — the same Animated.View that carries the
  // entrance — matching ProductHero / CapturedPhotos / VerificationPanel,
  // which each own their separation from the next section rather than being
  // spaced by the screen. An inner wrapper would put the margin inside the
  // Card's own frame instead of below it.
  panel: {
    marginBottom: Spacing["2xl"],
  },
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
