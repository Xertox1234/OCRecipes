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
            {/* The Nutri-Score chip renders OUTSIDE this wrapper. On
                iOS, accessible={true} collapses the subtree into a
                single VoiceOver node speaking only this label, so
                anything nested inside that headsUpSummaryLabel does not
                name (the grade letter does not) is silently dropped.
                The badges' titles ARE all in the composed label, so
                only they are grouped here.

                ANDROID DOES NOT COLLAPSE — device-verified 2026-08-04
                by diffing `uiautomator dump` on the emulator: the
                wrapper AND all three badges stay focusable=true, so
                "Heads up" is 4 TalkBack stops against 1 VoiceOver stop.
                The chip's placement is still correct (it is what iOS
                needs, and Android is indifferent to it), but never rely
                on this wrapper to HIDE anything on Android.

                Direction for 2c, which is the opposite of what this
                grouping assumes: each badge's own label is strictly
                more informative than the summary — "High in sugar.
                Above the FSA guideline for sugar." vs. "High in sugar"
                — so iOS is the platform losing information, and the
                fix is more likely "drop the group" than "collapse
                Android to match iOS". See
                todos/P2-2026-08-04-heads-up-accessible-group-diverges-ios-android.md */}
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
