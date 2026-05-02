// client/camera/components/ScanReticle.tsx
import React, { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  useAnimatedProps,
  cancelAnimation,
  interpolateColor,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import { getReticleTarget, getConfidenceFromPhase } from "./ScanReticle-utils";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const CORNER_LEN = 24;
const STROKE_WIDTH = 2.5;
const SPRING_TRACK = { damping: 20, stiffness: 200 };
const SPRING_MORPH = { damping: 16, stiffness: 220 };
const SPRING_SNAP = { damping: 8, stiffness: 300 };

// Confidence colour stops — semantic design values, cannot use theme in worklet
const CONFIDENCE_COLORS = ["#FFFFFF", "#f59e0b", "#22c55e"] as const; // hardcoded

type Corner = "tl" | "tr" | "bl" | "br";

interface CornerPathProps {
  corner: Corner;
  cx: SharedValue<number>;
  cy: SharedValue<number>;
  rw: SharedValue<number>;
  rh: SharedValue<number>;
  cornerScale: SharedValue<number>;
  confidence: SharedValue<number>;
  arrivalDelay: number;
}

function CornerPath({
  corner,
  cx,
  cy,
  rw,
  rh,
  cornerScale,
  confidence,
  arrivalDelay,
}: CornerPathProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 200 });
    }, arrivalDelay);
    return () => clearTimeout(timer);
  }, [opacity, arrivalDelay]);

  const animatedProps = useAnimatedProps(() => {
    "worklet";
    const w = rw.value * cornerScale.value;
    const h = rh.value * cornerScale.value;
    const x = cx.value;
    const y = cy.value;
    const L = CORNER_LEN;
    let d = "";
    switch (corner) {
      case "tl":
        d = `M ${x - w + L} ${y - h} L ${x - w} ${y - h} L ${x - w} ${y - h + L}`;
        break;
      case "tr":
        d = `M ${x + w - L} ${y - h} L ${x + w} ${y - h} L ${x + w} ${y - h + L}`;
        break;
      case "bl":
        d = `M ${x - w + L} ${y + h} L ${x - w} ${y + h} L ${x - w} ${y + h - L}`;
        break;
      case "br":
        d = `M ${x + w - L} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y + h - L}`;
        break;
    }
    const color = interpolateColor(
      confidence.value,
      [0, 0.5, 1.0],
      [...CONFIDENCE_COLORS],
    );
    return { d, stroke: color, opacity: opacity.value };
  });

  return (
    <AnimatedPath
      animatedProps={animatedProps}
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      fill="none"
    />
  );
}

interface Props {
  phase: ScanPhase;
  reducedMotion?: boolean;
}

export function ScanReticle({ phase, reducedMotion }: Props) {
  const { width: sw, height: sh } = useWindowDimensions();
  const cx = useSharedValue(sw / 2);
  const cy = useSharedValue(sh / 2);
  const rw = useSharedValue(130);
  const rh = useSharedValue(80);
  const confidence = useSharedValue(0);
  const cornerScale = useSharedValue(1);
  const isFirstDetection = React.useRef(true);

  useEffect(() => {
    if (phase.type === "HUNTING" && !reducedMotion) {
      rw.value = withRepeat(
        withSequence(
          withTiming(134, { duration: 1000 }),
          withTiming(126, { duration: 1000 }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(rw);
    }
  }, [phase.type, rw, reducedMotion]);

  useEffect(() => {
    const target = getReticleTarget(phase, sw, sh);
    const conf = getConfidenceFromPhase(phase);

    if (phase.type === "BARCODE_TRACKING") {
      if (isFirstDetection.current) {
        // Teleport on first detection — "snap then settle"
        cx.value = target.cx;
        cy.value = target.cy;
        isFirstDetection.current = false;
      } else {
        cx.value = withSpring(target.cx, SPRING_TRACK);
        cy.value = withSpring(target.cy, SPRING_TRACK);
      }
    } else {
      if (phase.type !== "BARCODE_LOCKED") {
        isFirstDetection.current = true;
      }
      cx.value = withSpring(target.cx, SPRING_MORPH);
      cy.value = withSpring(target.cy, SPRING_MORPH);
    }

    // HUNTING breathing (effect above) owns rw — don't overwrite it here
    if (phase.type !== "HUNTING") {
      rw.value = withSpring(target.width / 2, SPRING_MORPH);
    }
    rh.value = withSpring(target.height / 2, SPRING_MORPH);
    confidence.value = withTiming(conf, { duration: 80 });

    if (phase.type === "BARCODE_LOCKED") {
      cornerScale.value = withSpring(1.1, SPRING_SNAP, () => {
        cornerScale.value = withSpring(1, { damping: 12 });
      });
    }
  }, [phase, cx, cy, rw, rh, confidence, cornerScale, sw, sh]);

  const corners: Corner[] = ["tl", "tr", "bl", "br"];
  const DELAYS = [150, 180, 210, 240];

  return (
    <Svg
      style={[StyleSheet.absoluteFill, { width: sw, height: sh }]}
      pointerEvents="none"
    >
      {corners.map((corner, i) => (
        <CornerPath
          key={corner}
          corner={corner}
          cx={cx}
          cy={cy}
          rw={rw}
          rh={rh}
          cornerScale={cornerScale}
          confidence={confidence}
          arrivalDelay={DELAYS[i]}
        />
      ))}
    </Svg>
  );
}
