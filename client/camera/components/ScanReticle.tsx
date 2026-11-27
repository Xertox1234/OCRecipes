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
import {
  expandTimingConfig,
  reticleSettleSpringConfig,
} from "@/constants/animations";
import {
  BARCODE_RETICLE,
  CONFIDENCE_COLORS,
  FRAME_SIZES,
  getReticleTarget,
  getConfidenceFromPhase,
  getShapedFrameConfidence,
  type FrameShape,
} from "./ScanReticle-utils";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const CORNER_LEN = 24;
const STROKE_WIDTH = 3;
const SPRING_TRACK = { damping: 20, mass: 1, stiffness: 200 };
const SPRING_MORPH = { damping: 16, mass: 1, stiffness: 220 };
const SPRING_SNAP = { damping: 8, mass: 1, stiffness: 300 };

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
  /**
   * The step's frame (camera shell). When set, the frame takes this shape in
   * every phase but tracking, glides between shapes in 300 ms with no bounce
   * (instant under reduced motion), and is white at rest.
   */
  shape?: FrameShape;
}

// HUNTING "breathing": the frame's half-width swings this far either way.
const BREATHE = 4;

export function ScanReticle({ phase, reducedMotion, shape }: Props) {
  const { width: sw, height: sh } = useWindowDimensions();
  const cx = useSharedValue(sw / 2);
  const cy = useSharedValue(sh / 2);
  const rw = useSharedValue(130);
  const rh = useSharedValue(80);
  const confidence = useSharedValue(0);
  const cornerScale = useSharedValue(1);
  const isFirstDetection = React.useRef(true);

  // Breathes around the current frame's half-width, not the barcode frame's.
  const restHalfWidth =
    (shape ? FRAME_SIZES[shape] : BARCODE_RETICLE).width / 2;

  useEffect(() => {
    if (phase.type === "HUNTING" && !reducedMotion) {
      rw.value = withRepeat(
        withSequence(
          withTiming(restHalfWidth + BREATHE, { duration: 1000 }),
          withTiming(restHalfWidth - BREATHE, { duration: 1000 }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(rw);
      // Still HUNTING (reduced motion): rest at the frame's width, since the
      // morph effect below leaves rw to this effect in HUNTING.
      if (phase.type === "HUNTING") rw.value = restHalfWidth;
    }
  }, [phase.type, rw, reducedMotion, restHalfWidth]);

  useEffect(() => {
    const target = getReticleTarget(phase, sw, sh, shape);
    const conf = shape
      ? getShapedFrameConfidence(phase)
      : getConfidenceFromPhase(phase);
    // A shaped frame changes shape between steps: a 300 ms glide, no bounce,
    // and an instant jump under reduced motion (spec motion plan).
    const morph = (value: number) =>
      shape
        ? reducedMotion
          ? value
          : withTiming(value, expandTimingConfig)
        : withSpring(value, SPRING_MORPH);

    if (phase.type === "BARCODE_TRACKING") {
      if (isFirstDetection.current) {
        // Teleport on first detection — "snap then settle"
        cx.set(target.cx);
        cy.set(target.cy);
        isFirstDetection.current = false;
      } else {
        cx.set(withSpring(target.cx, SPRING_TRACK));
        cy.set(withSpring(target.cy, SPRING_TRACK));
      }
    } else {
      if (phase.type !== "BARCODE_LOCKED") {
        isFirstDetection.current = true;
      }
      cx.set(morph(target.cx));
      cy.set(morph(target.cy));
    }

    // HUNTING breathing (effect above) owns rw — don't overwrite it here
    if (phase.type !== "HUNTING") {
      rw.set(morph(target.width / 2));
    }
    rh.set(morph(target.height / 2));
    confidence.set(withTiming(conf, { duration: 80 }));

    // Reduced motion keeps the colour change and drops the scale settle.
    if (phase.type === "BARCODE_LOCKED" && !reducedMotion) {
      cornerScale.set(
        withSpring(1.1, SPRING_SNAP, () => {
          cornerScale.set(withSpring(1, reticleSettleSpringConfig));
        }),
      );
    }
  }, [
    phase,
    cx,
    cy,
    rw,
    rh,
    confidence,
    cornerScale,
    sw,
    sh,
    shape,
    reducedMotion,
  ]);

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
