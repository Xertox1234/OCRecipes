import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import { NutriScoreChip } from "@/components/NutriScoreChip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  partitionScanFlags,
  headsUpSummaryLabel,
} from "@/screens/nutrition-detail-flags-utils";
import type { ScanFlag } from "@shared/types/scan-flags";

interface FlagSectionsProps {
  flags: ScanFlag[];
  reducedMotion?: boolean;
}

/**
 * "For you" (personal/allergen) and "Heads up" (universal + Nutri-Score).
 *
 * Owns the partition and the six-flag cap deliberately: ONE array must feed
 * both the announced group label and the rendered badges, and keeping the
 * slice in the same file as both consumers is what stops them desyncing.
 *
 * SLICE 2c will narrow this to non-scalar flags only, once NutritionPanel
 * exists to render the sugar / saturated-fat / sodium rows. Narrowing it
 * before then deletes those badges with nothing in their place. When that
 * change lands, "nutrient" must STAY in UNIVERSAL_KINDS — partitionScanFlags
 * warn-and-drops unmodelled kinds, so removing it there swallows the flags
 * rather than relocating them.
 */
export function FlagSections({ flags, reducedMotion }: FlagSectionsProps) {
  const { theme } = useTheme();

  const partition = partitionScanFlags(flags);
  const universalToShow = partition.universal.slice(0, 6);

  return (
    <>
      {partition.personal.length > 0 ? (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(450).duration(400)
          }
          style={styles.additionalNutrients}
        >
          <ThemedText type="h4" style={styles.sectionTitle}>
            For you
          </ThemedText>
          <View style={{ gap: Spacing.sm }}>
            {partition.personal.map((f) => (
              <ScanFlagBadge key={f.id} flag={f} />
            ))}
          </View>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Informational only — not medical advice.
          </ThemedText>
        </Animated.View>
      ) : null}

      {partition.universal.length > 0 || partition.nutriScore ? (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(475).duration(400)
          }
          style={styles.additionalNutrients}
        >
          <ThemedText type="h4" style={styles.sectionTitle}>
            Heads up
          </ThemedText>
          <View style={{ gap: Spacing.sm }}>
            {/* The Nutri-Score chip renders OUTSIDE this wrapper — an
                accessible={true} group collapses its subtree into a
                single VoiceOver/TalkBack node using only this label, so
                anything nested inside that isn't reflected in
                headsUpSummaryLabel's text (the grade letter isn't) would
                be silently dropped from the announcement. The badges'
                titles ARE all in the composed label, so only they are
                grouped here. */}
            {partition.universal.length > 0 ? (
              <View
                accessible={true}
                accessibilityLabel={headsUpSummaryLabel(universalToShow)}
                style={{ gap: Spacing.sm }}
              >
                {universalToShow.map((f) => (
                  <ScanFlagBadge key={f.id} flag={f} />
                ))}
              </View>
            ) : null}
            {partition.nutriScore?.grade ? (
              <NutriScoreChip grade={partition.nutriScore.grade} />
            ) : null}
          </View>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Informational only — not medical advice.
          </ThemedText>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // Verbatim copies. The screen keeps its own — the Additional Nutrients card
  // still uses both, until 2c deletes it.
  additionalNutrients: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
});
