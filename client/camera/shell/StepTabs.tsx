import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { stepCheckSpringConfig } from "@/constants/animations";
import { CameraColors, Colors } from "@/constants/theme";
import type { StepTabView } from "./barcode-flow";

// Matches the design's on-dark check green (dark `success`) and ProductChip's
// reviewCheck.
const DONE_COLOR = "#4CAF7D"; // hardcoded — camera overlay, cannot use theme

const ACTIVE_FILL = Colors.dark.accentSolid;

const TAB_ICONS: Record<StepTabView["id"], keyof typeof Feather.glyphMap> = {
  barcode: "maximize",
  nutrition: "file-text",
  front: "package",
};

interface StepTabsProps {
  tabs: StepTabView[];
  onRedo: (id: "barcode" | "nutrition") => void;
}

interface TabProps {
  tab: StepTabView;
  onRedo: StepTabsProps["onRedo"];
}

function StepTab({ tab, onRedo }: TabProps) {
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();
  const [pressed, setPressed] = useState(false);
  const checkScale = useSharedValue(1);
  const prevState = useRef(tab.state);
  const { label, state } = tab;

  useEffect(() => {
    if (prevState.current !== "done" && state === "done") {
      if (!reducedMotion) {
        checkScale.value = withSpring(1.25, stepCheckSpringConfig, () => {
          checkScale.value = withSpring(1, stepCheckSpringConfig);
        });
      }
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(`${label} step complete`);
      }
    }
    prevState.current = state;
  }, [state, checkScale, label, reducedMotion]);

  // Carried over from the old StepPill: also fires on mount when a tab starts
  // out active.
  useEffect(() => {
    if (state === "active" && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(`${label} step in progress`);
    }
  }, [state, label]);

  const checkAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const isActive = state === "active";
  const isDone = state === "done";
  const color = isActive
    ? CameraColors.text
    : isDone
      ? DONE_COLOR
      : CameraColors.textMuted;

  const handlePress = () => {
    if (!tab.tappable || tab.id === "front") return;
    haptics.selection();
    onRedo(tab.id);
  };

  return (
    <PressableScale
      // Press dims (opacity) instead of scaling: scaleTo 1 turns the scale off.
      scaleTo={1}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!tab.tappable}
      accessibilityRole="button"
      accessibilityLiveRegion="polite"
      accessibilityLabel={[label, tab.sublabel, isDone ? "done" : null]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={
        tab.tappable ? "Double tap to redo this step" : undefined
      }
      accessibilityState={{ selected: isActive, disabled: !tab.tappable }}
      style={[
        styles.tab,
        isActive && styles.tabActive,
        pressed && styles.tabPressed,
      ]}
    >
      {isDone ? (
        <Animated.View style={checkAnimStyle}>
          <Feather name="check" size={18} color={color} accessible={false} />
        </Animated.View>
      ) : (
        <Feather
          name={TAB_ICONS[tab.id]}
          size={18}
          color={color}
          accessible={false}
        />
      )}
      <Text style={[styles.label, { color }]}>{label}</Text>
      {tab.sublabel ? (
        <Text style={[styles.sublabel, { color }]}>{tab.sublabel}</Text>
      ) : null}
    </PressableScale>
  );
}

export function StepTabs({ tabs, onRedo }: StepTabsProps) {
  return (
    <View style={styles.row}>
      {tabs.map((tab) => (
        <StepTab key={tab.id} tab={tab} onRedo={onRedo} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, paddingHorizontal: 8 },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: CameraColors.overlayDark,
  },
  tabActive: { backgroundColor: ACTIVE_FILL },
  tabPressed: { opacity: 0.6 },
  label: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  sublabel: { fontSize: 10, opacity: 0.8 },
});
