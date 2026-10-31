import React, { useEffect } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Platform,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
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
import {
  expandTimingConfig,
  pressSpringConfig,
  successPopConfig,
} from "@/constants/animations";
import { resolveImageUrl } from "@/lib/query-client";
import {
  COVER_ASPECT_RATIO,
  isCoverTitlePlaceholder,
  resolveCoverSubtitle,
  resolveCoverTitle,
} from "./cookbook-cover-utils";

interface CookbookCoverPlateProps {
  /** Current value of the name field — rendered live onto the cover. */
  name: string;
  /** Current value of the description field — set small under the title. */
  description?: string | null;
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
  /** Create mode's "generate on save" is armed — marks the cover with a feather. */
  generateArmed?: boolean;
  /**
   * Tapping the cover is a shortcut to the photo picker. The plate stays out
   * of the accessibility tree, so the labelled "Add photo" button remains the
   * accessible route to the same action.
   */
  onPress?: () => void;
  disabled?: boolean;
  /** Bump to play the success pop (the cookbook was just saved). */
  celebrateKey?: number;
}

/** How far the page block shows past the cover's fore-edge. */
const PAGE_EDGE = 6;
const SPINE_WIDTH = 12;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The cookbook cover as a physical object: a cloth-bound board at book
 * proportion, with a spine band, a debossed keyline, the page block showing
 * at the fore-edge, and the title set live in a serif face.
 *
 * Empty, the board is the app's terracotta (`accentSolid`, the AA-safe fill in
 * both themes) with cream ink — the theme's own cream: `backgroundRoot` in
 * light, `text` in dark. With art, the art replaces the cloth and the ink
 * turns white over a scrim.
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
  description,
  coverImageUrl,
  previewUri,
  width,
  busy = false,
  busyLabel,
  generateArmed = false,
  onPress,
  disabled = false,
  celebrateKey = 0,
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
  const subtitle = resolveCoverSubtitle(description);
  const isPlaceholder = isCoverTitlePlaceholder(name);

  const cream = isDark ? theme.text : theme.backgroundRoot;
  // The scrim under the title is a fixed dark gradient in both themes, so the
  // ink is always white over art — `buttonText` is #FFFFFF in light and dark.
  const ink = artUri ? theme.buttonText : cream;

  // Animating width/height (rather than a scale transform) keeps the keyline
  // hairline-thin and the title crisp at both sizes. Seeded at the incoming
  // width so the plate renders at full size on the first frame instead of
  // growing in from zero.
  const animatedWidth = useSharedValue(width);
  useEffect(() => {
    animatedWidth.set(
      withTiming(width, {
        ...expandTimingConfig,
        duration: reducedMotion ? 0 : expandTimingConfig.duration,
      }),
    );
  }, [width, reducedMotion, animatedWidth]);

  const animatedSize = useAnimatedStyle(() => ({
    width: animatedWidth.get(),
    height: (animatedWidth.get() - PAGE_EDGE) / COVER_ASPECT_RATIO,
  }));

  // Title and subtitle scale with the plate so they stay proportionate when
  // compacted — driven by the ANIMATED width, not the prop. Reading the prop
  // would snap the font to its target on frame one while the box is still
  // tweening, so the title visibly pops out of proportion for the whole 300ms.
  const animatedTitle = useAnimatedStyle(() => {
    const size = Math.max(13, Math.round(animatedWidth.get() * 0.115));
    return { fontSize: size, lineHeight: Math.round(size * 1.25) };
  });
  const animatedSubtitle = useAnimatedStyle(() => {
    const size = Math.max(9, Math.round(animatedWidth.get() * 0.055));
    return { fontSize: size, lineHeight: Math.round(size * 1.35) };
  });

  // Press answers the touch with the house press spring; reduced motion dims
  // instead of scaling so the press is still visible.
  const scale = useSharedValue(1);
  const pressDim = useSharedValue(1);
  const animatedPress = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    opacity: pressDim.get(),
  }));
  const interactive = !!onPress && !disabled && !busy;

  const handlePressIn = () => {
    if (!interactive) return;
    if (reducedMotion) pressDim.set(0.85);
    else scale.set(withSpring(0.98, pressSpringConfig));
  };
  const handlePressOut = () => {
    pressDim.set(1);
    if (!reducedMotion) scale.set(withSpring(1, pressSpringConfig));
  };

  // The one celebratory moment: the book settles with an overshoot when it is
  // saved. Started from an effect, never the handler — a shared-value write
  // before the view's first commit is lost. Reduced motion keeps the haptic
  // and the toast the caller fires; only the travel is dropped.
  useEffect(() => {
    if (celebrateKey === 0 || reducedMotion) return;
    scale.set(
      withSequence(
        withSpring(1.05, successPopConfig),
        withSpring(1, successPopConfig),
      ),
    );
  }, [celebrateKey, reducedMotion, scale]);

  return (
    <AnimatedPressable
      onPress={interactive ? onPress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={!interactive}
      style={[styles.plate, animatedSize, animatedPress]}
      entering={reducedMotion ? undefined : FadeIn.duration(280)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {/* Page block: the paper edge showing past the cover on the right. */}
      <View
        style={[
          styles.pages,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View
          style={[styles.pageLine, { right: 2, backgroundColor: theme.border }]}
        />
        <View
          style={[styles.pageLine, { right: 4, backgroundColor: theme.border }]}
        />
      </View>

      {/* Board: carries the shadow. Kept separate from the clipping layer
          below — on iOS `overflow: hidden` clips a view's own shadow, which
          left the old plate sitting flat on the page. */}
      <View
        style={[
          styles.board,
          {
            backgroundColor: artUri
              ? theme.backgroundSecondary
              : theme.accentSolid,
            shadowOpacity: isDark ? 0.5 : 0.22,
          },
        ]}
      >
        <View style={styles.clip}>
          {artUri ? (
            <Image
              source={{ uri: artUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={reducedMotion ? 0 : 220}
            />
          ) : (
            // Cloth: light catching the top of the board, falling off to
            // the bottom edge, so the terracotta reads as bound cloth rather
            // than a flat fill.
            <LinearGradient
              colors={[
                withOpacity(cream, 0.16),
                "transparent",
                "rgba(0,0,0,0.18)",
              ]}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFill}
            />
          )}

          {/* Scrim under the title — only needed over art, where the
              underlying image is arbitrary and the title would otherwise be
              unreadable. */}
          {artUri ? (
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.15)", "rgba(0,0,0,0.62)"]}
              locations={[0.35, 0.62, 1]}
              style={StyleSheet.absoluteFill}
            />
          ) : null}

          {/* Spine: a darker band where the board hinges, with a highlight
              along the crease. The single cheapest cue that this is a book
              and not a card. */}
          <View style={styles.spine} />
          <View
            style={[
              styles.spineCrease,
              { backgroundColor: withOpacity(cream, 0.28) },
            ]}
          />

          {/* Keyline: the debossed border a hardback cover is stamped with. */}
          <View
            style={[styles.keyline, { borderColor: withOpacity(ink, 0.55) }]}
          />

          {generateArmed && !artUri ? (
            <View
              style={[
                styles.armedBadge,
                { backgroundColor: withOpacity(cream, 0.2) },
              ]}
            >
              <Feather name="feather" size={12} color={cream} />
            </View>
          ) : null}

          <View style={styles.titleWrap}>
            {/* Animated.Text, not ThemedText: the font size is animated in
                step with the plate, and ThemedText is a plain wrapper with no
                ref forwarding so it can't be wrapped by
                createAnimatedComponent. Every style ThemedText would
                contribute is set explicitly below; the Dynamic Type cap
                replaces its `maxScale` handling, and is needed because the
                plate is a fixed-ratio box with a 3-line title. */}
            <Animated.Text
              numberOfLines={3}
              maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
              style={[
                styles.title,
                { color: isPlaceholder ? withOpacity(ink, 0.6) : ink },
                animatedTitle,
              ]}
            >
              {title}
            </Animated.Text>
            {subtitle ? (
              <Animated.Text
                numberOfLines={2}
                maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
                style={[
                  styles.subtitle,
                  { color: withOpacity(ink, 0.85) },
                  animatedSubtitle,
                ]}
              >
                {subtitle}
              </Animated.Text>
            ) : null}
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
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  plate: {
    alignSelf: "center",
  },
  pages: {
    position: "absolute",
    top: 4,
    bottom: 4,
    right: 0,
    left: Spacing.lg,
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pageLine: {
    position: "absolute",
    top: 3,
    bottom: 3,
    width: StyleSheet.hairlineWidth,
  },
  board: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: PAGE_EDGE,
    borderRadius: BorderRadius.card,
    // Elevation reads as a book lifted off the page.
    shadowColor: "#000000", // hardcoded — static StyleSheet can't read theme; shadow is black in both modes (opacity varies)
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 8,
  },
  clip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: BorderRadius.card,
    overflow: "hidden",
  },
  spine: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: SPINE_WIDTH,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  spineCrease: {
    position: "absolute",
    left: SPINE_WIDTH,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  keyline: {
    position: "absolute",
    top: Spacing.md,
    bottom: Spacing.md,
    left: SPINE_WIDTH + Spacing.sm,
    right: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 2,
  },
  armedBadge: {
    position: "absolute",
    top: Spacing.md + Spacing.sm,
    right: Spacing.md + Spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    position: "absolute",
    left: SPINE_WIDTH + Spacing.sm + Spacing.sm,
    right: Spacing.md + Spacing.sm,
    bottom: Spacing.md + Spacing.sm,
    gap: 2,
  },
  title: {
    fontFamily: Fonts?.serif,
    // The system serif renders light by default; a medium weight gives the
    // stamped-cover look without a bundled bold face.
    fontWeight: Platform.OS === "ios" ? "600" : "700",
    letterSpacing: 0.2,
  },
  subtitle: {
    fontFamily: Fonts?.serif,
    fontStyle: "italic",
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
