import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { NutriScoreChip } from "@/components/NutriScoreChip";
import type { NutriScoreGrade } from "@/components/nutri-score-chip-utils";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { BADGE_SEVERITY_FILL_OPACITY } from "@/components/badge-severity-visuals";
import {
  bandTagText,
  bandVisuals,
  composeNutrientRowLabel,
  NUTRIENT_ROWS,
} from "./NutritionPanel-utils";
import { standoutCopy } from "./NutritionSummaryCard-utils";
import type { Standout } from "@shared/lib/nutrition-bands";

/**
 * The rendered and spoken forms of this strip's "g" unit — both sourced from
 * the panel's own NUTRIENT_ROWS rather than re-typed here, so neither can
 * drift if the panel's spelling ever changes. NUTRIENT_ROWS has no `carbs`
 * entry and its `fat` entry is labelled "Total fat" (this strip needs "Fat"),
 * so the three macro rows below are built locally rather than reusing the
 * registry wholesale for one macro and not the others — only these two unit
 * strings are shared; `key`/`sourceKey`/`zone`/`group` on each local row are
 * inert padding required to satisfy the exported `NutrientRow` type (only
 * `label` and `spokenUnit` are read by `composeNutrientRowLabel`) and are NOT
 * authoritative for banding — protein/fat are genuinely "banded" in
 * NUTRIENT_ROWS itself; here they're deliberately "unbanded" because this
 * strip never bands them.
 */
const GRAMS_UNIT = NUTRIENT_ROWS.protein.unit;
const GRAMS_SPOKEN_UNIT = NUTRIENT_ROWS.protein.spokenUnit;

interface NutritionSummaryCardProps {
  standouts: Standout[];
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  servingContextLabel?: string;
  nutriScoreGrade?: NutriScoreGrade;
  reducedMotion?: boolean;
}

/**
 * The verdict card: Nutri-Score ring, up to two promoted standout rows (from
 * `pickStandouts`), and the fixed Calories/Protein/Carbs/Fat strip. Sits at
 * the top of the nutrition detail screen.
 *
 * The ring (D3): the grade is only available on the scan path, and it
 * inherits `NutriScoreChip`'s own accessibility reasoning verbatim — a
 * collapsed `accessible` subtree announces only the group's label, and the
 * grade letter is not in it. This component never wraps its content in a
 * whole-card `accessible` group, so the ring's own testID'd wrapper carries
 * no `aria-label` from an ancestor; `NutriScoreChip` supplies its own
 * `accessibilityLabel` on its own root node exactly as it does in
 * `FlagSections` today.
 */
export function NutritionSummaryCard({
  standouts,
  calories,
  protein,
  carbs,
  fat,
  servingContextLabel,
  nutriScoreGrade,
  reducedMotion,
}: NutritionSummaryCardProps) {
  const { theme, isDark } = useTheme();

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInUp.delay(200).duration(400)}
      style={styles.summaryCard}
    >
      <Card elevation={1} style={{ backgroundColor: theme.surface }}>
        {nutriScoreGrade ? (
          <View testID="nutri-score-ring" style={styles.nutriScoreRing}>
            <NutriScoreChip grade={nutriScoreGrade} />
          </View>
        ) : null}

        {/* Only the scan flow populates the serving state this caption is
            derived from — saved items store already-scaled totals, so a
            "Per …" claim there would misdescribe the numbers. The caller
            gates this the same way the screen's calorie card did:
            `servingContextLabel` supplied only when appropriate. */}
        {servingContextLabel ? (
          <ThemedText
            type="caption"
            style={[styles.heroContext, { color: theme.textSecondary }]}
          >
            Per {servingContextLabel}
          </ThemedText>
        ) : null}

        <View
          style={styles.calorieRow}
          accessible
          accessibilityRole="header"
          accessibilityLabel={
            calories !== undefined
              ? `${Math.round(calories)} kcal`
              : "not recorded"
          }
        >
          <ThemedText
            style={[styles.calorieValue, { color: theme.calorieAccent }]}
          >
            {calories !== undefined ? Math.round(calories) : "—"}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            kcal
          </ThemedText>
        </View>

        {standouts.length > 0 ? (
          <View style={styles.standoutList}>
            {standouts.map((standout) => (
              <StandoutRow
                key={`${standout.group}-${standout.nutrient}`}
                standout={standout}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.macroTiles}>
          {(
            [
              {
                label: "Protein",
                value: protein,
                color: theme.proteinAccent,
                // The composeNutrientRowLabel input shape — not a new
                // registry, just this call's required argument. All three
                // rows are local (rather than reusing NUTRIENT_ROWS.protein
                // for this one and not the other two) since NUTRIENT_ROWS
                // has no `carbs` entry and labels `fat` "Total fat".
                row: {
                  key: "protein",
                  sourceKey: "protein",
                  label: "Protein",
                  unit: GRAMS_UNIT,
                  spokenUnit: GRAMS_SPOKEN_UNIT,
                  zone: "unbanded",
                  group: "none",
                },
              },
              {
                label: "Carbs",
                value: carbs,
                color: theme.carbsAccent,
                row: {
                  key: "carbs",
                  sourceKey: "carbs",
                  label: "Carbs",
                  unit: GRAMS_UNIT,
                  spokenUnit: GRAMS_SPOKEN_UNIT,
                  zone: "unbanded",
                  group: "none",
                },
              },
              {
                label: "Fat",
                value: fat,
                color: theme.fatAccent,
                row: {
                  key: "fat",
                  sourceKey: "fat",
                  label: "Fat",
                  unit: GRAMS_UNIT,
                  spokenUnit: GRAMS_SPOKEN_UNIT,
                  zone: "unbanded",
                  group: "none",
                },
              },
            ] as const
          ).map((macro) => {
            // Round once — composeNutrientRowLabel's formatValue rounds to
            // one decimal, which is a no-op on an already-rounded integer,
            // so the spoken and printed figures can never disagree (see
            // docs/solutions/logic-errors/field-parallel-objects-diverge-on-the-fallback-path-2026-08-04.md).
            const displayValue =
              macro.value !== undefined ? Math.round(macro.value) : undefined;

            return (
              <View
                key={macro.label}
                accessible
                accessibilityLabel={composeNutrientRowLabel({
                  row: macro.row,
                  value: displayValue,
                  tag: null,
                })}
                style={[
                  styles.macroTile,
                  {
                    backgroundColor: isDark
                      ? theme.backgroundTertiary
                      : theme.backgroundSecondary,
                  },
                ]}
              >
                {/* textSecondary fails AA (4.31:1) on the light-mode tile
                    fill (backgroundSecondary) — use full text there; the
                    dark tile passes with textSecondary. */}
                <ThemedText
                  style={[
                    styles.macroTileLabel,
                    { color: isDark ? theme.textSecondary : theme.text },
                  ]}
                >
                  {macro.label}
                </ThemedText>
                <ThemedText
                  style={[styles.macroTileValue, { color: macro.color }]}
                >
                  {displayValue !== undefined ? displayValue : "—"}
                  <ThemedText
                    style={[
                      styles.macroTileUnit,
                      { color: isDark ? theme.textSecondary : theme.text },
                    ]}
                  >
                    {" "}
                    g
                  </ThemedText>
                </ThemedText>
              </View>
            );
          })}
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * One promoted standout row: dot + text + pill, the same treatment
 * `NutritionPanel`'s rows use, with `standoutCopy` supplying the text. The
 * pill's tag word is redundant with `standoutCopy`'s own wording ("High in
 * sugar" already says "High"), so — mirroring `NutritionPanel`'s pill — it
 * is excluded from the a11y tree rather than re-announced; the row's single
 * `ThemedText` is the whole of what a screen reader hears.
 */
function StandoutRow({ standout }: { standout: Standout }) {
  const { theme } = useTheme();
  const tag = bandTagText(standout);
  const visuals = bandVisuals(standout);

  return (
    <View style={styles.standoutRow}>
      <View style={styles.dotColumn}>
        {visuals ? (
          <View
            testID={`standout-indicator-${standout.nutrient}`}
            accessible={false}
            importantForAccessibility="no"
            accessibilityElementsHidden
            aria-hidden
            style={[styles.dot, { backgroundColor: theme[visuals.colorKey] }]}
          />
        ) : null}
      </View>

      <ThemedText type="body" style={styles.standoutText}>
        {standoutCopy(standout)}
      </ThemedText>

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
  // card's own frame instead of below it.
  summaryCard: {
    marginBottom: Spacing["2xl"],
  },
  nutriScoreRing: {
    alignSelf: "flex-end",
    marginBottom: Spacing.xs,
  },
  heroContext: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  calorieRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  calorieValue: {
    fontSize: 40,
    lineHeight: 44,
    fontFamily: FontFamily.bold,
  },
  standoutList: {
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  standoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
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
  standoutText: {
    flex: 1,
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
  macroTiles: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  macroTile: {
    flex: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
  },
  macroTileLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  macroTileValue: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 2,
  },
  macroTileUnit: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
  },
});
