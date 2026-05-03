import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import {
  useWeightLogs,
  useWeightTrend,
  useLogWeight,
} from "@/hooks/useWeightLogs";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";
import {
  formatWeightSubtitle,
  formatWeightDelta,
  computeGoalProgress,
  formatGoalLabel,
} from "./weight-log-drawer-utils";
import type { HomeScreenNavigationProp } from "@/types/navigation";
import type { HomeAction } from "./action-config";

const JUST_LOGGED_DURATION_MS = 3000;

interface WeightLogDrawerProps {
  action: HomeAction;
}

export function WeightLogDrawer({ action }: WeightLogDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { reducedMotion } = useAccessibility();

  const [isOpen, setIsOpen] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState(false);
  const [lastLoggedWeight, setLastLoggedWeight] = useState<number | undefined>(
    undefined,
  );
  const justLoggedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chevronRotation = useSharedValue(0);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isOpen,
    reducedMotion,
  );

  const { data: logs = [] } = useWeightLogs();
  const { data: trend } = useWeightTrend();
  const logWeight = useLogWeight();

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (justLoggedTimerRef.current) clearTimeout(justLoggedTimerRef.current);
    };
  }, []);

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    setIsOpen(next);
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    if (reducedMotion) {
      chevronRotation.value = next ? 90 : 0;
    } else {
      chevronRotation.value = withTiming(
        next ? 90 : 0,
        next ? expandTimingConfig : collapseTimingConfig,
      );
    }
  }, [isOpen, haptics, chevronRotation, reducedMotion]);

  // Keep chevron in sync when reducedMotion changes while open
  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(chevronRotation);
      chevronRotation.value = isOpen ? 90 : 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable ref
  }, [reducedMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const handleLog = useCallback(() => {
    setInputError(null);
    const parsed = parseFloat(weightInput);
    if (!weightInput || isNaN(parsed) || parsed <= 0 || parsed > 999) {
      const msg = "Enter a weight between 0 and 999 kg";
      setInputError(msg);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(msg);
      }
      return;
    }

    logWeight.mutate(
      { weight: parsed },
      {
        onSuccess: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Success);
          setWeightInput("");
          setLastLoggedWeight(parsed);
          setJustLogged(true);
          if (justLoggedTimerRef.current)
            clearTimeout(justLoggedTimerRef.current);
          justLoggedTimerRef.current = setTimeout(() => {
            setJustLogged(false);
          }, JUST_LOGGED_DURATION_MS);
        },
        onError: (err) => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          const msg = (err as Error).message || "Failed to log weight";
          setInputError(msg);
          if (Platform.OS === "ios") {
            AccessibilityInfo.announceForAccessibility(msg);
          }
        },
      },
    );
  }, [weightInput, logWeight, haptics]);

  const handleTapThrough = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("WeightTracking");
  }, [haptics, navigation]);

  const subtitle = formatWeightSubtitle(
    logs,
    trend,
    justLogged,
    lastLoggedWeight,
  );
  const lastWeight = logs[0] ? parseFloat(logs[0].weight) : null;
  const goalWeight = trend?.goalWeight ?? null;
  const startWeight =
    logs.length > 0 ? parseFloat(logs[logs.length - 1].weight) : null;
  const goalProgress = computeGoalProgress(lastWeight, goalWeight, startWeight);
  const showGoalBar = goalWeight !== null && lastWeight !== null;

  const chipBg = withOpacity(theme.textSecondary, 0.08);

  return (
    <View>
      {/* Header row */}
      <Pressable
        onPress={handleToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`${action.label}, ${subtitle}`}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={`Double tap to ${isOpen ? "collapse" : "expand"} weight log`}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: withOpacity(theme.link, 0.1) },
          ]}
        >
          <Feather
            name={action.icon as keyof typeof Feather.glyphMap}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </View>
        <View style={styles.labelBlock}>
          <ThemedText type="body" style={styles.label}>
            {action.label}
          </ThemedText>
          <ThemedText
            style={[
              styles.subtitle,
              { color: justLogged ? theme.success : theme.textSecondary },
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </ThemedText>
        </View>
        <Animated.View style={chevronStyle}>
          <Feather
            name="chevron-right"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
        </Animated.View>
      </Pressable>

      {/* Always-mounted animated drawer body */}
      <Animated.View style={[animatedStyle, styles.clipContainer]}>
        <View
          style={[
            styles.drawerBody,
            { backgroundColor: withOpacity(theme.link, 0.04) },
          ]}
          onLayout={onContentLayout}
          importantForAccessibility={isOpen ? "yes" : "no-hide-descendants"}
          aria-hidden={!isOpen}
        >
          {/* Stat chips */}
          <View style={styles.chipsRow}>
            <StatChip
              value={lastWeight !== null ? `${lastWeight.toFixed(1)}` : "—"}
              label="last (kg)"
              chipBg={chipBg}
              valueColor={theme.text}
              labelColor={theme.textSecondary}
            />
            <StatChip
              value={
                trend?.weeklyRateOfChange != null &&
                trend.weeklyRateOfChange !== 0
                  ? formatWeightDelta(trend.weeklyRateOfChange)
                  : "—"
              }
              label="this week"
              chipBg={chipBg}
              valueColor={
                trend?.weeklyRateOfChange != null &&
                trend.weeklyRateOfChange !== 0
                  ? trend.weeklyRateOfChange < 0
                    ? theme.success
                    : theme.error
                  : theme.text
              }
              labelColor={theme.textSecondary}
            />
            <StatChip
              value={goalWeight !== null ? `${goalWeight.toFixed(1)}` : "—"}
              label="goal (kg)"
              chipBg={chipBg}
              valueColor={theme.text}
              labelColor={theme.textSecondary}
            />
          </View>

          {/* Goal progress bar — only when goal and current weight are set */}
          {showGoalBar && (
            <View>
              <View
                style={[
                  styles.goalBarTrack,
                  {
                    backgroundColor: withOpacity(theme.textSecondary, 0.15),
                  },
                ]}
              >
                <View
                  style={[
                    styles.goalBarFill,
                    {
                      backgroundColor: theme.link,
                      width: `${Math.round(goalProgress * 100)}%`,
                    },
                  ]}
                />
              </View>
              <ThemedText
                style={[styles.goalLabel, { color: theme.textSecondary }]}
              >
                {formatGoalLabel(lastWeight!, goalWeight!)}
              </ThemedText>
            </View>
          )}

          {/* Weight input */}
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.weightInput,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: inputError ? theme.error : theme.border,
                },
              ]}
              placeholder={lastWeight !== null ? lastWeight.toFixed(1) : "0.0"}
              placeholderTextColor={theme.textSecondary}
              value={weightInput}
              onChangeText={(v) => {
                setWeightInput(v);
                if (inputError) setInputError(null);
              }}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={handleLog}
              aria-invalid={inputError != null}
              accessibilityLabel="Weight in kg"
            />
            <View
              style={[
                styles.unitBadge,
                { backgroundColor: withOpacity(theme.textSecondary, 0.1) },
              ]}
            >
              <ThemedText
                style={[styles.unitText, { color: theme.textSecondary }]}
              >
                kg
              </ThemedText>
            </View>
          </View>

          {inputError && (
            <ThemedText
              style={[styles.errorText, { color: theme.error }]}
              accessibilityLiveRegion="polite"
            >
              {inputError}
            </ThemedText>
          )}

          {/* Log button */}
          <Pressable
            onPress={handleLog}
            disabled={logWeight.isPending}
            accessibilityRole="button"
            accessibilityLabel="Log Weight"
            accessibilityState={{
              busy: logWeight.isPending,
              disabled: logWeight.isPending,
            }}
            style={({ pressed }) => [
              styles.logButton,
              {
                backgroundColor: theme.link,
                opacity: pressed || logWeight.isPending ? 0.7 : 1,
              },
            ]}
          >
            {logWeight.isPending ? (
              <ActivityIndicator size="small" color={theme.buttonText} />
            ) : (
              <ThemedText
                style={[styles.logButtonText, { color: theme.buttonText }]}
              >
                Log Weight
              </ThemedText>
            )}
          </Pressable>

          {/* Tap-through */}
          <Pressable
            onPress={handleTapThrough}
            accessibilityRole="link"
            accessibilityLabel="Full chart and history"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText style={[styles.tapThrough, { color: theme.link }]}>
              Full chart & history →
            </ThemedText>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// StatChip — file-local helper component
// ---------------------------------------------------------------------------

interface StatChipProps {
  value: string;
  label: string;
  chipBg: string;
  valueColor: string;
  labelColor: string;
}

function StatChip({
  value,
  label,
  chipBg,
  valueColor,
  labelColor,
}: StatChipProps) {
  return (
    <View style={[styles.chip, { backgroundColor: chipBg }]}>
      <ThemedText style={[styles.chipValue, { color: valueColor }]}>
        {value}
      </ThemedText>
      <ThemedText style={[styles.chipLabel, { color: labelColor }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 48,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  labelBlock: { flex: 1, gap: 2 },
  label: { lineHeight: 18 },
  subtitle: { fontSize: 12, fontFamily: FontFamily.regular },
  clipContainer: { overflow: "hidden" },
  drawerBody: {
    position: "absolute",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  chipsRow: { flexDirection: "row", gap: Spacing.xs },
  chip: {
    flex: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    alignItems: "center",
    gap: 2,
  },
  chipValue: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    fontWeight: "700",
  },
  chipLabel: {
    fontSize: 9,
    fontFamily: FontFamily.regular,
    textAlign: "center",
  },
  goalBarTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  goalBarFill: { height: "100%", borderRadius: 3 },
  goalLabel: { fontSize: 11, fontFamily: FontFamily.regular, marginTop: 3 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  weightInput: {
    flex: 1,
    fontSize: 22,
    fontFamily: FontFamily.medium,
    fontWeight: "700",
    borderWidth: 1.5,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    minHeight: 48,
  },
  unitBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  unitText: { fontSize: 14, fontFamily: FontFamily.medium, fontWeight: "600" },
  errorText: { fontSize: 12, fontFamily: FontFamily.regular },
  logButton: {
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  logButtonText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    fontWeight: "600",
  },
  tapThrough: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    textAlign: "center",
    paddingVertical: Spacing.xs,
  },
});
