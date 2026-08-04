import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { ScanFlag, NutrientKind } from "@shared/types/scan-flags";

interface FlagSectionsProps {
  /** "For you" — the caller's `partitionScanFlags(flags).personal`. */
  personal: ScanFlag[];
  /** "Heads up" — the caller's `partitionScanFlags(flags).universal`. */
  universal: ScanFlag[];
  reducedMotion?: boolean;
}

/**
 * The three scalar nutrients `NutritionPanel` now bands, so a badge repeating
 * the same judgement would double-warn.
 *
 * Filtering on the `nutrient` FIELD, not on `kind`: the caffeine flag also
 * ships as `kind: "nutrient"` (server/services/universal-flags.ts:151-169),
 * and the panel's caffeine row is unbanded — value only — so it does not
 * carry the "High in caffeine" warning. A kind-based filter would delete it
 * silently.
 *
 * "nutrient" stays in UNIVERSAL_KINDS in nutrition-detail-flags-utils.ts:
 * `partitionScanFlags` warn-and-drops unmodelled kinds, so removing it there
 * would swallow these flags rather than relocate them. The narrowing belongs
 * at the RENDER step, which is here.
 */
const PANEL_OWNED_NUTRIENTS = new Set<NutrientKind>([
  "sugar",
  "saturated_fat",
  "sodium",
]);

/**
 * "For you" (personal/allergen) and "Heads up" (the universal flags the
 * nutrient panel does not already band).
 *
 * Takes the two partitions rather than raw `flags`: the screen partitions once
 * and feeds the Nutri-Score grade to `NutritionSummaryCard`, so partitioning
 * again here would be a second source of truth for the same split.
 *
 * Owns the six-flag cap. The cap used to have a second consumer — a composed
 * group label that had to name exactly the badges that rendered — which is why
 * it lives here rather than at the call site. That label is gone (see the
 * comment on the badge list below), so the cap now has one consumer and means
 * simply "render at most six".
 */
export function FlagSections({
  personal,
  universal,
  reducedMotion,
}: FlagSectionsProps) {
  const { theme } = useTheme();

  const universalToShow = universal
    .filter((f) => !(f.nutrient && PANEL_OWNED_NUTRIENTS.has(f.nutrient)))
    .slice(0, 6);

  return (
    <>
      {personal.length > 0 ? (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(400).duration(400)
          }
          style={styles.flagSection}
        >
          <ThemedText type="h4" style={styles.sectionTitle}>
            For you
          </ThemedText>
          <View style={{ gap: Spacing.sm }}>
            {personal.map((f) => (
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

      {/* Gated on what SURVIVES the filter, not on `universal.length`: a
          product whose only universal flags are the panel-owned three would
          otherwise render a "Heads up" heading over an empty list. */}
      {universalToShow.length > 0 ? (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(450).duration(400)
          }
          style={styles.flagSection}
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
                Nutri-Score chip — now rendered by NutritionSummaryCard —
                keeps its own node for free wherever it lives, rather than
                by being carefully kept outside a wrapper. */}
            {universalToShow.map((f) => (
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
    </>
  );
}

const styles = StyleSheet.create({
  flagSection: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
});
