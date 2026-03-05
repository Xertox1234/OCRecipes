import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_SIZE = 160;
const STROKE_WIDTH = 12;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface CalorieRingProps {
  consumed: number;
  goal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const CalorieRing = React.memo(function CalorieRing({
  consumed,
  goal,
  protein,
  carbs,
  fat,
}: CalorieRingProps) {
  const { theme } = useTheme();
  const progress = useSharedValue(0);

  const targetProgress = goal > 0 ? Math.min(consumed / goal, 1) : 0;

  useEffect(() => {
    progress.value = withTiming(targetProgress, {
      duration: 800,
      easing: Easing.out(Easing.cubic),
    });
  }, [targetProgress, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: goal,
        now: consumed,
        text: `${consumed} of ${goal} calories`,
      }}
      accessibilityLabel={`${consumed} of ${goal} calories consumed. ${protein} grams protein, ${carbs} grams carbs, ${fat} grams fat`}
    >
      <View style={styles.ringWrapper}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Defs>
            <LinearGradient
              id="calorieRingGradient"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <Stop offset="0%" stopColor={"#B794F6" /* hardcoded */} />
              <Stop offset="100%" stopColor={"#7C4DFF" /* hardcoded */} />
            </LinearGradient>
          </Defs>
          {/* Track */}
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            stroke={withOpacity(theme.textSecondary, 0.15)}
            strokeWidth={STROKE_WIDTH}
            fill="none"
          />
          {/* Progress arc */}
          <AnimatedCircle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            stroke="url(#calorieRingGradient)"
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            animatedProps={animatedProps}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </Svg>
        {/* Center content overlaid on the ring */}
        <View style={styles.centerContent}>
          <MaterialCommunityIcons name="fire" size={22} color={theme.link} />
          <ThemedText style={styles.consumedValue}>
            {consumed.toLocaleString()}
          </ThemedText>
          <ThemedText
            style={[styles.goalLabel, { color: theme.textSecondary }]}
          >
            of {goal.toLocaleString()}
          </ThemedText>
        </View>
      </View>
      {/* Macro breakdown below ring */}
      <View style={styles.macrosRow}>
        <View style={styles.macroItem}>
          <ThemedText
            style={[styles.macroValue, { color: theme.proteinAccent }]}
          >
            {protein}g
          </ThemedText>
          <ThemedText
            style={[styles.macroLabel, { color: theme.textSecondary }]}
          >
            Protein
          </ThemedText>
        </View>
        <View style={styles.macroItem}>
          <ThemedText style={[styles.macroValue, { color: theme.carbsAccent }]}>
            {carbs}g
          </ThemedText>
          <ThemedText
            style={[styles.macroLabel, { color: theme.textSecondary }]}
          >
            Carbs
          </ThemedText>
        </View>
        <View style={styles.macroItem}>
          <ThemedText style={[styles.macroValue, { color: theme.fatAccent }]}>
            {fat}g
          </ThemedText>
          <ThemedText
            style={[styles.macroLabel, { color: theme.textSecondary }]}
          >
            Fat
          </ThemedText>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  ringWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  centerContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  consumedValue: {
    fontSize: 32,
    fontFamily: FontFamily.bold,
    lineHeight: 38,
  },
  goalLabel: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  macrosRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing["4xl"],
    marginTop: Spacing.md,
  },
  macroItem: {
    alignItems: "center",
  },
  macroValue: {
    fontSize: 17,
    fontFamily: FontFamily.bold,
  },
  macroLabel: {
    fontSize: 11,
    marginTop: 2,
  },
});
