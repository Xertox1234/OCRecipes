// The one-time tips carousel shown before the very first scan: a light
// (app-theme) screen with 3 pages, dots, and Next / "Scan now". Presentational
// only — the screen decides when it shows and what onDone does.
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { useTheme } from "@/hooks/useTheme";
import {
  tipsPageFadeTimingConfig,
  tipsPageSpringConfig,
} from "@/constants/animations";
import {
  FontFamily,
  MAX_FONT_SCALE_CONSTRAINED,
  Spacing,
} from "@/constants/theme";

interface TipRow {
  icon: keyof typeof Feather.glyphMap;
  text: string;
}

interface TipsPage {
  hero: keyof typeof Feather.glyphMap;
  title: string;
  rows: TipRow[];
}

const PAGES: TipsPage[] = [
  {
    hero: "camera",
    title: "Get the best scan",
    rows: [
      { icon: "target", text: "Hold still for a moment" },
      { icon: "sun", text: "Use plenty of light" },
      { icon: "maximize", text: "Fill the frame, nothing cut off" },
    ],
  },
  {
    hero: "maximize",
    title: "Barcodes scan by themselves",
    rows: [
      { icon: "maximize", text: "Line the barcode up inside the frame" },
      { icon: "zap", text: "It scans by itself. No tap needed" },
      { icon: "hash", text: "Won't read? You can type the number" },
    ],
  },
  {
    hero: "file-text",
    title: "Labels and fronts need a tap",
    rows: [
      { icon: "file-text", text: "Fit the whole panel in the frame" },
      { icon: "package", text: "Fit the front of the package in the frame" },
      { icon: "circle", text: "Then tap the big button to take the photo" },
    ],
  },
];

const LAST_PAGE = PAGES.length - 1;
// Past this share of a page's width (or a flick of this speed) a release turns
// the page.
const TURN_DISTANCE_SHARE = 0.25;
const FLICK_VELOCITY = 600;
const HERO_SIZE = 120;
const BUTTON_HEIGHT = 52;

interface TipsCarouselProps {
  onDone: () => void;
}

interface PageViewProps {
  page: TipsPage;
  index: number;
  width: number;
  progress: { value: number };
  reducedMotion: boolean;
  active: boolean;
}

function PageView({
  page,
  index,
  width,
  progress,
  reducedMotion,
  active,
}: PageViewProps) {
  const { theme } = useTheme();
  // Swipe: pages slide side by side. Reduced motion: no travel, they stack
  // and crossfade.
  const style = useAnimatedStyle(() => {
    const offset = index - progress.value;
    if (reducedMotion) {
      return { opacity: Math.max(0, 1 - Math.abs(offset)) };
    }
    return { transform: [{ translateX: offset * width }] };
  });

  return (
    <Animated.View
      style={[styles.page, { width }, style]}
      // Only the visible page is read out; Next / "Scan now" step through.
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
    >
      <View
        style={[styles.hero, { backgroundColor: theme.backgroundSecondary }]}
      >
        <Feather
          name={page.hero}
          size={52}
          color={theme.link}
          accessible={false}
        />
      </View>
      <Text
        style={[styles.title, { color: theme.text }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
      >
        {page.title}
      </Text>
      {page.rows.map((row) => (
        <View key={row.text} style={styles.row}>
          <View style={styles.rowIcon}>
            <Feather
              name={row.icon}
              size={18}
              color={theme.link}
              accessible={false}
            />
          </View>
          <Text
            style={[styles.rowText, { color: theme.text }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
          >
            {row.text}
          </Text>
        </View>
      ))}
    </Animated.View>
  );
}

export function TipsCarousel({ onDone }: TipsCarouselProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  // Fractional page position: 0..2, driven by the finger then settled by a
  // spring (crossfaded by timing under reduced motion).
  const progress = useSharedValue(0);
  const pageSV = useSharedValue(0);

  const settle = useCallback(
    (target: number, velocity = 0) => {
      pageSV.set(target);
      progress.set(
        reducedMotion
          ? withTiming(target, tipsPageFadeTimingConfig)
          : // Physics spring: tipsPageSpringConfig writes mass (Reanimated 4 defaults to 4).
            withSpring(target, { ...tipsPageSpringConfig, velocity }),
      );
      setPage(target);
    },
    [pageSV, progress, reducedMotion],
  );

  const handleNext = () => {
    if (page >= LAST_PAGE) {
      haptics.selection();
      onDone();
      return;
    }
    haptics.selection();
    settle(page + 1);
  };

  const panGesture = usePanGesture({
    enabled: !reducedMotion,
    activeOffsetX: [-12, 12],
    onUpdate: (e) => {
      const next = pageSV.value - e.translationX / width;
      progress.set(Math.min(LAST_PAGE, Math.max(0, next)));
    },
    onDeactivate: (e) => {
      let target = pageSV.value;
      if (
        e.translationX < -width * TURN_DISTANCE_SHARE ||
        e.velocityX < -FLICK_VELOCITY
      ) {
        target = Math.min(LAST_PAGE, target + 1);
      } else if (
        e.translationX > width * TURN_DISTANCE_SHARE ||
        e.velocityX > FLICK_VELOCITY
      ) {
        target = Math.max(0, target - 1);
      }
      pageSV.set(target);
      // Hand the release velocity (in pages per second) to the spring.
      progress.set(
        withSpring(target, {
          ...tipsPageSpringConfig,
          velocity: -e.velocityX / width,
        }),
      );
      scheduleOnRN(setPage, target);
    },
  });

  const isLast = page === LAST_PAGE;
  const ctaLabel = isLast ? "Scan now" : "Next";

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.backgroundRoot,
          paddingTop: insets.top + Spacing["3xl"],
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
      accessibilityViewIsModal
    >
      <GestureDetector gesture={panGesture}>
        <View style={styles.pages}>
          {PAGES.map((p, i) => (
            <PageView
              key={p.title}
              page={p}
              index={i}
              width={width}
              progress={progress}
              reducedMotion={reducedMotion}
              active={i === page}
            />
          ))}
        </View>
      </GestureDetector>

      <View
        style={styles.dots}
        accessible
        accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}
        accessibilityLiveRegion="polite"
      >
        {PAGES.map((p, i) => (
          <View
            key={p.title}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === page ? theme.text : theme.backgroundTertiary,
              },
            ]}
          />
        ))}
      </View>

      <PressableScale
        onPress={handleNext}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        style={[styles.cta, { backgroundColor: theme.accentSolid }]}
      >
        <Text
          style={[styles.ctaText, { color: theme.buttonText }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          {ctaLabel}
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pages: { flex: 1, overflow: "hidden" },
  page: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: Spacing["2xl"],
    alignItems: "stretch",
  },
  hero: {
    width: HERO_SIZE,
    height: HERO_SIZE,
    borderRadius: HERO_SIZE / 2,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["3xl"],
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    minHeight: 44,
  },
  rowIcon: { width: 28, alignItems: "center" },
  rowText: {
    flexShrink: 1,
    fontFamily: FontFamily.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cta: {
    minHeight: BUTTON_HEIGHT,
    marginHorizontal: Spacing["2xl"],
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontFamily: FontFamily.semiBold, fontSize: 16 },
});
