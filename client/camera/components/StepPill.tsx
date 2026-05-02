import React, { useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  AccessibilityInfo,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  withSpring,
  withRepeat,
  withTiming,
  useAnimatedStyle,
  cancelAnimation,
  interpolateColor,
} from "react-native-reanimated";
import { useAccessibility } from "@/hooks/useAccessibility";
import type { ScanPhase } from "../types/scan-phase";
import {
  getStepDotState,
  shouldShowStepPill,
  type StepDotState,
} from "./StepPill-utils";

const DONE_COLOR = "#22c55e"; // hardcoded — camera overlay, cannot use theme

const STEP_LABELS = ["Barcode", "Nutrition", "Front"];

interface DotProps {
  label: string;
  state: StepDotState;
}

function StepDot({ label, state }: DotProps) {
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const prevState = React.useRef<StepDotState>(state);

  useEffect(() => {
    if (prevState.current !== "done" && state === "done") {
      if (!reducedMotion) {
        scale.value = withSpring(1.25, { damping: 10 }, () => {
          scale.value = withSpring(1, { damping: 10 });
        });
      }
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(`${label} step complete`);
      }
    }
    prevState.current = state;
  }, [state, scale, label, reducedMotion]);

  useEffect(() => {
    if (state === "active") {
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(`${label} step in progress`);
      }
      if (reducedMotion) {
        ringOpacity.value = 0;
      } else {
        ringOpacity.value = withTiming(1, { duration: 200 });
        ringScale.value = withRepeat(
          withTiming(1.5, { duration: 700 }),
          -1,
          true,
        );
      }
    } else {
      cancelAnimation(ringScale);
      cancelAnimation(ringOpacity);
      ringOpacity.value = withTiming(0, { duration: 200 });
      ringScale.value = withTiming(1, { duration: 200 });
    }
  }, [state, ringScale, ringOpacity, reducedMotion, label]);

  const dotAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const ringAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const isDone = state === "done";
  const isActive = state === "active";

  return (
    <View style={styles.dotWrapper}>
      <Animated.View
        style={[
          styles.dot,
          isDone && styles.dotDone,
          isActive && styles.dotActive,
          dotAnimStyle,
        ]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${label}: ${state}`}
      >
        {isDone && <Text style={styles.checkmark}>✓</Text>}
      </Animated.View>
      {isActive && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.ring, ringAnimStyle]}
        />
      )}
      <Text style={[styles.label, isActive && styles.labelActive]}>
        {label}
      </Text>
    </View>
  );
}

interface ConnectorProps {
  precedingDotState: StepDotState;
}

function Connector({ precedingDotState }: ConnectorProps) {
  const { reducedMotion } = useAccessibility();
  const progress = useSharedValue(0);

  useEffect(() => {
    const target = precedingDotState === "done" ? 1 : 0;
    progress.value = withTiming(target, { duration: reducedMotion ? 0 : 300 });
  }, [precedingDotState, progress, reducedMotion]);

  const animStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(255,255,255,0.2)", DONE_COLOR],
    ),
  }));

  return <Animated.View style={[styles.connector, animStyle]} />;
}

interface Props {
  phase: ScanPhase;
}

export function StepPill({ phase }: Props) {
  const opacity = useSharedValue(0);
  const visible = shouldShowStepPill(phase);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.pill, animStyle]} pointerEvents="none">
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && (
            <Connector
              precedingDotState={getStepDotState(phase, (i - 1) as 0 | 1 | 2)}
            />
          )}
          <StepDot
            label={label}
            state={getStepDotState(phase, i as 0 | 1 | 2)}
          />
        </React.Fragment>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: "center",
  },
  dotWrapper: {
    alignItems: "center",
    gap: 4,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotActive: {
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  dotDone: {
    backgroundColor: DONE_COLOR,
    borderColor: DONE_COLOR,
  },
  checkmark: {
    color: "#fff", // hardcoded
    fontSize: 11,
    fontWeight: "700",
  },
  ring: {
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  connector: {
    width: 20,
    height: 1,
    marginHorizontal: 4,
    marginBottom: 16,
  },
  label: {
    fontSize: 9,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 0.3,
  },
  labelActive: {
    color: "rgba(255,255,255,0.8)",
  },
});
