import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import { NutriScoreChip } from "@/components/NutriScoreChip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { partitionScanFlags } from "@/screens/nutrition-detail-flags-utils";
import type { ScanFlag } from "@shared/types/scan-flags";

interface FlagSectionsProps {
  flags: ScanFlag[];
  reducedMotion?: boolean;
}

/**
 * "For you" (personal/allergen) and "Heads up" (universal + Nutri-Score).
 *
 * Owns the partition and the six-flag cap. The cap used to have a second
 * consumer — a composed group label that had to name exactly the badges that
 * rendered — which is why it lives here rather than at the call site. That
 * label is gone (see the comment on the badge list below), so the cap now has
 * one consumer and means simply "render at most six".
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
            {/* NO accessible={true} group wrapper here — deliberate, and
                the reverse of what this section originally shipped with.

                A group wrapper collapses its subtree on iOS into one
                VoiceOver node speaking only the wrapper's label. Each
                badge's own description is strictly RICHER than any
                summary sentence can be — "High in sugar. Above the FSA
                guideline for sugar." against "High in sugar" — and those
                explanations exist nowhere else on the screen. Collapsing
                therefore made every flag's justification unreachable to
                VoiceOver users.

                Android never collapsed at all: device-verified
                2026-08-04 via `uiautomator dump`, where the wrapper AND
                all three badges stayed focusable=true, so TalkBack read
                the summary and then repeated all of it badge by badge.

                Dropping the wrapper fixes both platforms at once — one
                stop per badge, each carrying its full explanation,
                identically on iOS and Android. The "Heads up" heading
                above already supplies the grouping cue, and the
                Nutri-Score chip keeps its own node for free rather than
                by being carefully kept outside a wrapper. */}
            {universalToShow.map((f) => (
              <ScanFlagBadge key={f.id} flag={f} />
            ))}
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
