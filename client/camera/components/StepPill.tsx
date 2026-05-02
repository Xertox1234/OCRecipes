import React, { useEffect } from "react";
import { StyleSheet, View, Text } from "react-native";
import Animated, {
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  useAnimatedStyle,
  cancelAnimation,
} from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import {
  getStepDotState,
  shouldShowStepPill,
  type StepDotState,
} from "./StepPill-utils";

const STEP_LABELS = ["Barcode", "Nutrition", "Front"];

interface DotProps {
  label: string;
  state: StepDotState;
}

function StepDot({ label, state }: DotProps) {
  const scale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const prevState = React.useRef<StepDotState>(state);

  useEffect(() => {
    if (prevState.current !== "done" && state === "done") {
      scale.value = withSequence(
        withSpring(1.25, { damping: 10 }),
        withSpring(1, { damping: 10 }),
      );
    }
    prevState.current = state;
  }, [state, scale]);

  useEffect(() => {
    if (state === "active") {
      ringOpacity.value = withTiming(1, { duration: 200 });
      ringScale.value = withRepeat(
        withSequence(
          withTiming(1.5, { duration: 700 }),
          withTiming(1, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(ringScale);
      cancelAnimation(ringOpacity);
      ringOpacity.value = withTiming(0, { duration: 200 });
      ringScale.value = 1;
    }
  }, [state, ringScale, ringOpacity]);

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
          {i > 0 && <View style={styles.connector} />}
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
    backgroundColor: "#22c55e", // hardcoded
    borderColor: "#22c55e", // hardcoded
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
    backgroundColor: "rgba(255,255,255,0.2)",
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
