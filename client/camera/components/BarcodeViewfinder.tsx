// client/camera/components/BarcodeViewfinder.tsx
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { AbsoluteFill } from "@/constants/theme";
import { BARCODE_RETICLE, CONFIDENCE_COLORS } from "./ScanReticle-utils";

const CORNER_LEN = 26;
const STROKE = 3;
const LINE_WIDTH = 3;
// Faint guide bars that make the frame read as "a barcode goes here".
const BAR_WIDTHS = [3, 1, 2, 1, 4, 1, 1, 3, 2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 1, 2];
const SCAN_LINE = "#22c55e"; // hardcoded — live-camera overlay, not theme-able
const SCAN_TINT = "rgba(34, 197, 94, 0.18)"; // hardcoded — live-camera overlay

interface Props {
  /** 0 while looking, rising while a code holds, 1 from the lock on. */
  confidence: number;
  /** False while the viewfinder settles: drawn dim, not yet listening. */
  armed: boolean;
  /** The lock is in: the scan line sweeps across the code. */
  sweeping: boolean;
  /** The code is read: the frame fills green. */
  found: boolean;
  /** How long one sweep across and back takes. */
  sweepMs: number;
  reducedMotion: boolean;
}

/**
 * The barcode-shaped viewfinder for the Coach's scanner. Its corners fill
 * white → amber → green while the same code holds, a scan line sweeps across
 * it once the code locks, and it fills green when the read is in. With
 * Reduce Motion the sweep becomes a still tint; the pacing stays the same.
 */
export function BarcodeViewfinder({
  confidence,
  armed,
  sweeping,
  found,
  sweepMs,
  reducedMotion,
}: Props) {
  const { width, height } = BARCODE_RETICLE;
  const conf = useSharedValue(0);
  const presence = useSharedValue(0.35);
  const sweep = useSharedValue(0);

  // The short fades below stay under Reduce Motion on purpose; only the
  // sweep, the one moving element, is swapped for a still tint.
  useEffect(() => {
    conf.set(withTiming(confidence, { duration: 120 }));
  }, [conf, confidence]);

  useEffect(() => {
    presence.set(withTiming(armed ? 1 : 0.35, { duration: 250 }));
  }, [presence, armed]);

  const animateSweep = sweeping && !reducedMotion;
  useEffect(() => {
    if (!animateSweep) {
      cancelAnimation(sweep);
      sweep.set(0);
      return;
    }
    sweep.set(0);
    sweep.set(
      withRepeat(
        withTiming(1, {
          duration: sweepMs / 2,
          easing: Easing.inOut(Easing.quad),
        }),
        2,
        true,
      ),
    );
  }, [animateSweep, sweep, sweepMs]);

  const frameStyle = useAnimatedStyle(() => ({ opacity: presence.value }));
  const cornerStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      conf.value,
      [0, 0.5, 1],
      [...CONFIDENCE_COLORS],
    ),
  }));
  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweep.value * (width - LINE_WIDTH) }],
  }));

  const tinted = found || (sweeping && reducedMotion);

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <View style={styles.center}>
        <Animated.View style={[{ width, height }, frameStyle]}>
          {tinted && (
            <View
              testID="barcode-viewfinder-tint"
              style={[StyleSheet.absoluteFill, styles.tint]}
            />
          )}
          <View style={styles.bars}>
            {BAR_WIDTHS.map((w, i) => (
              <View key={i} style={[styles.bar, { width: w }]} />
            ))}
          </View>
          {animateSweep && (
            <Animated.View
              testID="barcode-viewfinder-sweep"
              style={[styles.line, lineStyle]}
            />
          )}
          <Animated.View style={[styles.corner, styles.tl, cornerStyle]} />
          <Animated.View style={[styles.corner, styles.tr, cornerStyle]} />
          <Animated.View style={[styles.corner, styles.bl, cornerStyle]} />
          <Animated.View style={[styles.corner, styles.br, cornerStyle]} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tint: {
    backgroundColor: SCAN_TINT,
    borderRadius: 6,
  },
  bars: {
    ...AbsoluteFill,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-evenly",
    paddingHorizontal: 28,
    paddingVertical: 34,
    opacity: 0.16,
  },
  bar: {
    backgroundColor: "#FFFFFF", // hardcoded — live-camera overlay
  },
  line: {
    position: "absolute",
    top: 10,
    bottom: 10,
    left: 0,
    width: LINE_WIDTH,
    borderRadius: LINE_WIDTH,
    backgroundColor: SCAN_LINE,
    shadowColor: SCAN_LINE,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  corner: {
    position: "absolute",
    width: CORNER_LEN,
    height: CORNER_LEN,
  },
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: STROKE,
    borderLeftWidth: STROKE,
    borderTopLeftRadius: 6,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: STROKE,
    borderRightWidth: STROKE,
    borderTopRightRadius: 6,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: STROKE,
    borderLeftWidth: STROKE,
    borderBottomLeftRadius: 6,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: STROKE,
    borderRightWidth: STROKE,
    borderBottomRightRadius: 6,
  },
});
