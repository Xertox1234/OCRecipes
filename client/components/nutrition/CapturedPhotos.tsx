import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface CapturedPhotosProps {
  nutritionImageUri?: string;
  frontImageUri?: string;
  reducedMotion?: boolean;
}

/**
 * Sits directly under the macro block because the nutrition-label
 * capture is the EVIDENCE for the numbers above it — it is what the
 * values were read from, which is more useful next to them than as a
 * hero image at the top.
 *
 * Both are rendered only when present, so a barcode-only scan (the
 * common case, and the one that never opts into the label steps) is
 * byte-identical to before: no heading, no placeholder frames.
 *
 * The heading is deliberately neutral. "Read from your label" would
 * be a false claim whenever `ocrText` is null — a photographed but
 * unreadable panel is exactly the case the log gate exists for, and
 * the photo is still worth showing there as the record of what the
 * user pointed the camera at.
 *
 * PROVISIONAL LAYOUT — Phase 2 of the scan-flow rework moves these
 * into `ProductHero` / `NutritionFactsPanel` and designs the real
 * presentation. The route plumbing, a11y labels and tests above it
 * survive that move; this JSX does not.
 */
export function CapturedPhotos({
  nutritionImageUri,
  frontImageUri,
  reducedMotion,
}: CapturedPhotosProps) {
  const { theme } = useTheme();

  if (!nutritionImageUri && !frontImageUri) return null;

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInUp.delay(250).duration(400)}
      style={styles.capturedPhotos}
    >
      <ThemedText type="h4" style={styles.sectionTitle}>
        Your photos
      </ThemedText>
      <View style={styles.capturedPhotoRow}>
        {/* The label lives on the GROUP, not on the image.
            RN's `Image` gates on `accessible={props.alt !== undefined
            ? true : props.accessible}` — identically in Image.ios.js
            and Image.android.js — so a bare `accessibilityLabel` on it
            does not make it an accessibility element on EITHER
            platform, and may simply never be announced. If a platform
            heuristic surfaces it anyway, the result is worse: it
            double-announces against the visible caption right below it
            — "Nutrition label you photographed", then "Nutrition label"
            — which docs/rules/accessibility.md prohibits. Both branches
            are bad; neither has been confirmed on a device.

            One `accessible` wrapper avoids the question entirely by
            collapsing image + caption into a single node with one
            label. Safe here specifically because the tile has NO
            interactive child (that same rule forbids the wrapper when
            it would swallow a Pressable), and because the caption's
            words are contained in the group label — a collapsed
            subtree announces only the group's label, so anything not
            reflected in it is silently dropped. The test pins that
            containment by comparing the two off the DOM, not by
            matching two hand-written strings that happen to overlap. */}
        {nutritionImageUri ? (
          <View
            accessible
            accessibilityLabel="Nutrition label you photographed"
            style={styles.capturedPhoto}
          >
            <FallbackImage
              source={{ uri: nutritionImageUri }}
              style={[
                styles.capturedPhotoImage,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              fallbackIcon="image"
              // `contain`, not `cover`: a nutrition panel is portrait and
              // this frame is wide, so cropping to fill would show a
              // horizontal sliver of the label. These are evidence for
              // the numbers above — the whole panel has to be visible,
              // letterboxing and all.
              resizeMode="contain"
            />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Nutrition label
            </ThemedText>
          </View>
        ) : null}
        {frontImageUri ? (
          <View
            accessible
            accessibilityLabel="Product front you photographed"
            style={styles.capturedPhoto}
          >
            <FallbackImage
              source={{ uri: frontImageUri }}
              style={[
                styles.capturedPhotoImage,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              fallbackIcon="image"
              resizeMode="contain"
            />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Product front
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  capturedPhotos: {
    marginBottom: Spacing["2xl"],
  },
  capturedPhotoRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  capturedPhoto: {
    // `flex: 1` so two captures split the row evenly, CAPPED at half width so
    // a lone capture doesn't stretch across it. Letting it stretch looks like
    // it fills the gap left by the missing photo, but `contain` won't upscale
    // a portrait panel to a 343pt-wide frame — it just centres it and paints
    // ~126pt of empty background on either side. Same emptiness, now inside
    // the frame and larger. Capped, the single-capture case (step 3 skipped)
    // is the same tile it would have been beside a sibling.
    flex: 1,
    maxWidth: "50%",
    gap: Spacing.xs,
  },
  capturedPhotoImage: {
    width: "100%",
    height: 120,
    borderRadius: BorderRadius.card,
  },
});
