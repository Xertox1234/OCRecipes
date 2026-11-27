// The per-step example card: in-house art, a title, one "why" line and a
// white "Got it" pill. Presentational only — the screen decides when to show
// it (first 3 scans of a flow, then through "?") and counts the dismissals.
import React, { useEffect, useState, type ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { PressableScale } from "@/components/PressableScale";
import { useHaptics } from "@/hooks/useHaptics";
import { contentRevealTimingConfig } from "@/constants/animations";
import {
  CameraColors,
  Colors,
  FontFamily,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import type { ScanExampleKey } from "@/lib/feature-tips-storage";
import {
  BarcodeExampleArt,
  NutritionLabelExampleArt,
  PackageFrontExampleArt,
} from "./example-art";

export const EXAMPLE_CONTENT: Record<
  ScanExampleKey,
  { title: string; body: string; Art: ComponentType }
> = {
  barcode: {
    title: "Scan the barcode",
    body: "Line it up inside the frame. It scans by itself. No tap needed.",
    Art: BarcodeExampleArt,
  },
  "barcode-nutrition": {
    title: "Photo the nutrition label",
    body: "We check the numbers against the real package, so your log is accurate.",
    Art: NutritionLabelExampleArt,
  },
  "barcode-front": {
    title: "Photo the front (optional)",
    body: "Helps with the name, brand and size when the barcode isn't in our database.",
    Art: PackageFrontExampleArt,
  },
};

const OPTIONAL_SUFFIX = " (optional)";
// The card follows the dim by one beat: "dim, then card" (spec motion plan).
const CARD_DELAY_MS = 80;

interface ExampleCardProps {
  exampleKey: ScanExampleKey;
  onDismiss: () => void;
}

export function ExampleCard({ exampleKey, onDismiss }: ExampleCardProps) {
  const haptics = useHaptics();
  const { title, body, Art } = EXAMPLE_CONTENT[exampleKey];
  const scrim = useSharedValue(0);
  const card = useSharedValue(0);
  const [pressed, setPressed] = useState(false);

  // Both are fades — no travel — so reduced motion needs no variant here.
  useEffect(() => {
    scrim.value = withTiming(1, contentRevealTimingConfig);
    card.value = withDelay(
      CARD_DELAY_MS,
      withTiming(1, contentRevealTimingConfig),
    );
  }, [exampleKey, scrim, card]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value }));

  // "(optional)" reads as a quiet aside, as in the mockup.
  const isOptional = title.endsWith(OPTIONAL_SUFFIX);
  const mainTitle = isOptional
    ? title.slice(0, -OPTIONAL_SUFFIX.length)
    : title;

  const handleDismiss = () => {
    haptics.selection();
    onDismiss();
  };

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
        pointerEvents="none"
      />
      <Animated.View style={[styles.content, cardStyle]}>
        <Art />
        <Text
          style={styles.title}
          accessibilityRole="header"
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          {mainTitle}
          {isOptional ? (
            <Text style={styles.titleNote}>{OPTIONAL_SUFFIX}</Text>
          ) : null}
        </Text>
        <Text
          style={styles.body}
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          {body}
        </Text>
        <PressableScale
          scaleTo={0.96}
          onPress={handleDismiss}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel="Got it"
          style={[styles.cta, pressed && styles.ctaPressed]}
        >
          <Text
            style={styles.ctaText}
            maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
          >
            Got it
          </Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: CameraColors.exampleScrim },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    // Leaves the bottom third for the step tabs and controls, which stay
    // visible over the scrim.
    paddingBottom: 160,
  },
  title: {
    color: CameraColors.text,
    fontFamily: FontFamily.bold,
    fontSize: 20,
    marginTop: 20,
    marginBottom: 6,
    textAlign: "center",
  },
  titleNote: {
    color: CameraColors.textMuted,
    fontFamily: FontFamily.medium,
    fontSize: 15,
  },
  body: {
    color: CameraColors.textMuted,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
    maxWidth: 300,
  },
  cta: {
    minHeight: 48,
    minWidth: 140,
    paddingHorizontal: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CameraColors.shutterButton,
  },
  // Press dims a touch as well as the 0.96 scale, so reduced motion (where
  // usePressScale drops the scale) still answers the tap.
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    color: Colors.light.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
});
