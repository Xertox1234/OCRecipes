import React, { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { FontFamily, Spacing, withOpacity } from "@/constants/theme";
import {
  calculateFastingProgress,
  formatFastingTimeDisplay,
} from "./fasting-display-utils";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface FastingTimerProps {
  /** ISO string of when the fast started */
  startedAt: string;
  /** Target duration in hours */
  targetHours: number;
  /** Current elapsed minutes (refreshed by parent) */
  elapsedMinutes: number;
  /** Diameter of the timer circle */
  size?: number;
}

export const FastingTimer = React.memo(function FastingTimer({
  startedAt,
  targetHours,
  elapsedMinutes,
  size = 240,
}: FastingTimerProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  const targetMinutes = targetHours * 60;
  const progress = calculateFastingProgress(elapsedMinutes, targetMinutes);
  const isComplete = progress >= 1;

  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Animated progress value
  const animatedProgress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      animatedProgress.value = progress;
    } else {
      animatedProgress.value = withTiming(progress, {
        duration: 800,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [progress, reducedMotion, animatedProgress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animatedProgress.value),
  }));

  // Format time display
  const timeDisplay = useMemo(
    () => formatFastingTimeDisplay(elapsedMinutes, targetMinutes),
    [elapsedMinutes, targetMinutes],
  );

  const percentageText = `${Math.round(progress * 100)}%`;

  const progressColor = isComplete ? theme.success : theme.link;
  const trackColor = withOpacity(theme.textSecondary, 0.15);

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      accessibilityLabel={`Fasting timer: ${timeDisplay.main} ${timeDisplay.label}, ${percentageText} complete`}
      accessibilityRole="timer"
    >
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc */}
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={progressColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      {/* Center text overlay */}
      <View style={styles.textOverlay}>
        <ThemedText
          style={[
            styles.timeText,
            { color: isComplete ? theme.success : theme.text },
          ]}
        >
          {timeDisplay.main}
        </ThemedText>
        <ThemedText
          type="caption"
          style={[styles.labelText, { color: theme.textSecondary }]}
        >
          {timeDisplay.label}
        </ThemedText>
        <ThemedText style={[styles.percentageText, { color: progressColor }]}>
          {percentageText}
        </ThemedText>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  textOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  timeText: {
    fontSize: 36,
    fontFamily: FontFamily.bold,
    fontWeight: "700",
    letterSpacing: 1,
  },
  labelText: {
    marginTop: Spacing.xs,
  },
  percentageText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
    marginTop: Spacing.xs,
  },
});
