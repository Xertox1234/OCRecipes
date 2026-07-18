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
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useAccessibility } from "@/hooks/useAccessibility";
import type { ScanPhase } from "../types/scan-phase";
import {
  getStepDotState,
  shouldShowStepPill,
  type StepDotState,
} from "./StepPill-utils";

// Matches the design's on-dark check green (dark `success`) and ProductChip's
// reviewCheck.
const DONE_COLOR = "#4CAF7D"; // hardcoded — camera overlay, cannot use theme

const STEP_LABELS = ["Barcode", "Nutrition", "Front"];

interface SegmentProps {
  label: string;
  state: StepDotState;
}

function StepSegment({ label, state }: SegmentProps) {
  const { reducedMotion } = useAccessibility();
  const checkScale = useSharedValue(1);
  const prevState = React.useRef<StepDotState>(state);

  useEffect(() => {
    if (prevState.current !== "done" && state === "done") {
      if (!reducedMotion) {
        checkScale.value = withSpring(1.25, { damping: 10 }, () => {
          checkScale.value = withSpring(1, { damping: 10 });
        });
      }
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(`${label} step complete`);
      }
    }
    prevState.current = state;
  }, [state, checkScale, label, reducedMotion]);

  useEffect(() => {
    if (state === "active" && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(`${label} step in progress`);
    }
  }, [state, label]);

  const checkAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const isActive = state === "active";

  return (
    <View
      style={[styles.segment, isActive && styles.segmentActive]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${label}: ${state}`}
    >
      {state === "done" && (
        <Animated.View style={checkAnimStyle}>
          <Feather
            name="check"
            size={13}
            color={DONE_COLOR}
            accessible={false}
          />
        </Animated.View>
      )}
      <Text
        style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}
      >
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

  const pillAnimStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.pill, pillAnimStyle]} pointerEvents="none">
      {STEP_LABELS.map((label, i) => (
        <StepSegment
          key={label}
          label={label}
          state={getStepDotState(phase, i as 0 | 1 | 2)}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 999,
    padding: 4,
    alignSelf: "center",
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  segmentActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
  },
  segmentLabelActive: {
    color: "#FFFFFF", // hardcoded — camera overlay
  },
});
