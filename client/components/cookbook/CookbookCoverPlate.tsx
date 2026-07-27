import React, { useEffect } from "react";
import { StyleSheet, View, ActivityIndicator, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  BorderRadius,
  Fonts,
  MAX_FONT_SCALE_CONSTRAINED,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import { expandTimingConfig } from "@/constants/animations";
import { resolveImageUrl } from "@/lib/query-client";
import {
  COVER_ASPECT_RATIO,
  isCoverTitlePlaceholder,
  resolveCoverTitle,
} from "./cookbook-cover-utils";

interface CookbookCoverPlateProps {
  /** Current value of the name field — rendered live onto the cover. */
  name: string;
  /** Stored cover image, if the cookbook already has one. */
  coverImageUrl?: string | null;
  /** Locally-picked image shown optimistically before the upload lands. */
  previewUri?: string | null;
  /** Plate width in points — the caller animates this with the keyboard. */
  width: number;
  /** Covers the plate with a spinner while an image is being produced. */
  busy?: boolean;
  /** Copy under the spinner, e.g. "Generating…". */
  busyLabel?: string;
}

/**
 * The cookbook cover as a physical object: a plate at book proportion with a
 * debossed keyline, a spine band down the left edge, and the title set live in
 * a serif face.
 *
 * The serif is deliberate and scoped to this one surface. The app bundles only
 * Poppins; `Fonts.serif` resolves to the platform's own book face (New York on
 * iOS, Noto Serif on Android) at zero bundle cost. Everything else on the
 * screen stays Poppins — the cover is a simulated printed artifact, so it gets
 * print type and the UI around it does not.
 *
 * Hidden from the accessibility tree on purpose: the title duplicates the name
 * field directly below it, and a live preview would announce on every
 * keystroke. Cover state is conveyed by the action buttons' labels instead.
 */
export function CookbookCoverPlate({
  name,
  coverImageUrl,
  previewUri,
  width,
  busy = false,
  busyLabel,
}: CookbookCoverPlateProps) {
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();

  // A locally-picked image wins over the stored one so the plate updates the
  // instant the user chooses a photo, not when the upload round-trips. The
  // stored URL goes through `resolveImageUrl` because disk-backed dev storage
  // returns a RELATIVE path (`/api/cookbook-covers/…`) that no image loader
  // can fetch; `previewUri` is already an absolute `file://` URI.
  const artUri = previewUri ?? resolveImageUrl(coverImageUrl);
  const title = resolveCoverTitle(name);
  const isPlaceholder = isCoverTitlePlaceholder(name);

  // Animating width/height (rather than a scale transform) keeps the keyline
  // hairline-thin and the title crisp at both sizes. Seeded at the incoming
  // width so the plate renders at full size on the first frame instead of
  // growing in from zero.
  const animatedWidth = useSharedValue(width);
  useEffect(() => {
    animatedWidth.value = withTiming(width, {
      ...expandTimingConfig,
      duration: reducedMotion ? 0 : expandTimingConfig.duration,
    });
  }, [width, reducedMotion, animatedWidth]);

  const animatedSize = useAnimatedStyle(() => ({
    width: animatedWidth.value,
    height: animatedWidth.value / COVER_ASPECT_RATIO,
  }));

  // Title scales with the plate so it stays proportionate when compacted —
  // driven by the ANIMATED width, not the prop. Reading the prop would snap
  // the font to its target on frame one while the box is still tweening, so
  // the title visibly pops out of proportion for the whole 300ms.
  const animatedTitle = useAnimatedStyle(() => {
    const size = Math.max(13, Math.round(animatedWidth.value * 0.115));
    return { fontSize: size, lineHeight: Math.round(size * 1.25) };
  });

  return (
    <Animated.View
      style={[
        styles.plate,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: withOpacity(theme.text, isDark ? 0.18 : 0.12),
          shadowOpacity: isDark ? 0.45 : 0.18,
        },
        animatedSize,
      ]}
      entering={reducedMotion ? undefined : FadeIn.duration(280)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {artUri ? (
        <Image
          source={{ uri: artUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={reducedMotion ? 0 : 220}
        />
      ) : (
        // Empty plate: a soft top-down sheen so it reads as a printed board
        // rather than a flat grey rectangle.
        <LinearGradient
          colors={[
            withOpacity(theme.text, isDark ? 0.06 : 0.03),
            "transparent",
            withOpacity(theme.text, isDark ? 0.1 : 0.05),
          ]}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* Scrim under the title — only needed over art, where the underlying
          image is arbitrary and the title would otherwise be unreadable. */}
      {artUri ? (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.15)", "rgba(0,0,0,0.62)"]}
          locations={[0.35, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {/* Spine: two hairlines inset from the left edge. The single cheapest
          cue that this is a book and not a card. */}
      <View
        style={[
          styles.spine,
          { borderRightColor: withOpacity(theme.text, isDark ? 0.22 : 0.14) },
        ]}
      />
      <View
        style={[
          styles.spineInner,
          { borderRightColor: withOpacity(theme.text, isDark ? 0.14 : 0.08) },
        ]}
      />

      {/* Keyline: the debossed border a hardback cover is stamped with. */}
      <View
        style={[
          styles.keyline,
          {
            borderColor: artUri
              ? "rgba(255,255,255,0.55)"
              : withOpacity(theme.link, 0.35),
          },
        ]}
      />

      <View style={styles.titleWrap}>
        {/* Animated.Text, not ThemedText: the font size is animated in step
            with the plate, and ThemedText is a plain wrapper with no ref
            forwarding so it can't be wrapped by createAnimatedComponent.
            Every style ThemedText would contribute is set explicitly below;
            the Dynamic Type cap replaces its `maxScale` handling, and is
            needed because the plate is a fixed-ratio box with a 3-line
            title. */}
        <Animated.Text
          numberOfLines={3}
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
          style={[
            styles.title,
            {
              // The scrim under the title is a fixed dark gradient in both
              // themes, so the title is always white over art —
              // `buttonText` is #FFFFFF in light and dark alike.
              color: artUri
                ? theme.buttonText
                : isPlaceholder
                  ? withOpacity(theme.text, 0.35)
                  : theme.text,
            },
            animatedTitle,
          ]}
        >
          {title}
        </Animated.Text>
      </View>

      {busy ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.busyOverlay,
            { backgroundColor: withOpacity(theme.backgroundRoot, 0.72) },
          ]}
        >
          <ActivityIndicator size="small" color={theme.link} />
          {busyLabel ? (
            <ThemedText
              style={[styles.busyLabel, { color: theme.textSecondary }]}
            >
              {busyLabel}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plate: {
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignSelf: "center",
    justifyContent: "flex-end",
    // Elevation reads as a book lifted off the page.
    shadowColor: "#000000", // hardcoded — static StyleSheet can't read theme; shadow is black in both modes (opacity varies)
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 6,
  },
  spine: {
    position: "absolute",
    left: 10,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    width: 0,
  },
  spineInner: {
    position: "absolute",
    left: 14,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    width: 0,
  },
  keyline: {
    position: "absolute",
    top: Spacing.md,
    bottom: Spacing.md,
    left: Spacing.lg,
    right: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 2,
  },
  titleWrap: {
    position: "absolute",
    left: Spacing.lg + Spacing.sm,
    right: Spacing.md + Spacing.sm,
    bottom: Spacing.md + Spacing.sm,
  },
  title: {
    fontFamily: Fonts?.serif,
    // The system serif renders light by default; a medium weight gives the
    // stamped-cover look without a bundled bold face.
    fontWeight: Platform.OS === "ios" ? "600" : "700",
    letterSpacing: 0.2,
  },
  busyOverlay: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  busyLabel: {
    fontSize: 12,
  },
});
