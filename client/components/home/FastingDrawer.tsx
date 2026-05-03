import React, { useState, useCallback, useEffect } from "react";
import { Pressable, StyleSheet, View, ActivityIndicator } from "react-native";
import Svg, { Circle } from "react-native-svg";
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
import { useFastingTimer } from "@/hooks/useFastingTimer";
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
  formatFastingSubtitle,
  formatTimeToGoal,
  formatStartedAt,
  formatLastFastDuration,
  formatCompletionRate,
  computeFastProgress,
} from "./fasting-drawer-utils";
import type { HomeScreenNavigationProp } from "@/types/navigation";
import type { HomeAction } from "./action-config";

// Static ring geometry — no animation in the mini ring
const RING_SIZE = 64;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2; // 29
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_CENTER = RING_SIZE / 2; // 32

interface FastingDrawerProps {
  action: HomeAction;
}

export function FastingDrawer({ action }: FastingDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { reducedMotion } = useAccessibility();

  const [isOpen, setIsOpen] = useState(false);
  const chevronRotation = useSharedValue(0);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isOpen,
    reducedMotion,
  );

  const {
    isFasting,
    elapsedMinutes,
    currentFast,
    schedule,
    stats,
    logs,
    currentPhase,
    handleStartFast,
    handleEndFast,
    startFast,
    endFast,
    ConfirmationModal,
  } = useFastingTimer();

  const targetHours =
    currentFast?.targetDurationHours ?? schedule?.fastingHours;
  const progress = computeFastProgress(elapsedMinutes, targetHours ?? 16);

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

  const handleTapThrough = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Fasting");
  }, [haptics, navigation]);

  const subtitle = formatFastingSubtitle(
    isFasting,
    elapsedMinutes,
    targetHours,
    schedule?.protocol,
  );

  return (
    <View>
      {/* Header row */}
      <Pressable
        onPress={handleToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`${action.label}, ${subtitle}`}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={`Double tap to ${isOpen ? "collapse" : "expand"} fasting timer`}
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
              { color: isFasting ? theme.success : theme.textSecondary },
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
          {/* Top content row: ring + phase/ready block */}
          <View style={styles.topRow}>
            {/* Mini ring — static SVG snapshot */}
            <View style={styles.ringWrapper}>
              <Svg width={RING_SIZE} height={RING_SIZE} accessible={false}>
                <Circle
                  cx={RING_CENTER}
                  cy={RING_CENTER}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={withOpacity(theme.textSecondary, 0.2)}
                  strokeWidth={RING_STROKE}
                />
                {isFasting && (
                  <Circle
                    cx={RING_CENTER}
                    cy={RING_CENTER}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={progress >= 1 ? theme.success : theme.link}
                    strokeWidth={RING_STROKE}
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                    strokeLinecap="round"
                    rotation="-90"
                    origin={`${RING_CENTER}, ${RING_CENTER}`}
                  />
                )}
              </Svg>
              {!isFasting && (
                <ThemedText style={[styles.ringEmoji, { opacity: 0.35 }]}>
                  🌙
                </ThemedText>
              )}
            </View>

            {/* Phase / ready description */}
            <View style={styles.phaseBlock}>
              {isFasting && currentPhase && (
                <>
                  <ThemedText
                    style={[styles.phaseName, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    🔥 {currentPhase.name}
                  </ThemedText>
                  <ThemedText
                    style={[styles.phaseDesc, { color: theme.textSecondary }]}
                    numberOfLines={3}
                  >
                    {currentPhase.description}
                  </ThemedText>
                </>
              )}
              {!isFasting && (
                <>
                  <ThemedText style={[styles.phaseName, { color: theme.text }]}>
                    Ready to fast?
                  </ThemedText>
                  <ThemedText
                    style={[styles.phaseDesc, { color: theme.textSecondary }]}
                    numberOfLines={2}
                  >
                    {schedule
                      ? `${schedule.protocol} · ${schedule.fastingHours}h fast, ${schedule.eatingHours}h eating window.`
                      : "Set up a schedule or start a 16h fast."}
                  </ThemedText>
                </>
              )}
            </View>
          </View>

          {/* Stat chips */}
          <View style={styles.chipsRow}>
            {isFasting ? (
              <>
                <StatChip
                  value={formatTimeToGoal(elapsedMinutes, targetHours ?? 16)}
                  label="to goal"
                  textColor={theme.text}
                  labelColor={theme.textSecondary}
                  chipBg={withOpacity(theme.textSecondary, 0.08)}
                />
                <StatChip
                  value={String(stats?.currentStreak ?? 0)}
                  label="day streak"
                  textColor={theme.text}
                  labelColor={theme.textSecondary}
                  chipBg={withOpacity(theme.textSecondary, 0.08)}
                />
                <StatChip
                  value={
                    currentFast ? formatStartedAt(currentFast.startedAt) : "—"
                  }
                  label="started"
                  textColor={theme.text}
                  labelColor={theme.textSecondary}
                  chipBg={withOpacity(theme.textSecondary, 0.08)}
                />
              </>
            ) : (
              <>
                <StatChip
                  value={String(stats?.currentStreak ?? 0)}
                  label="day streak"
                  textColor={theme.text}
                  labelColor={theme.textSecondary}
                  chipBg={withOpacity(theme.textSecondary, 0.08)}
                />
                <StatChip
                  value={formatLastFastDuration(logs)}
                  label="last fast"
                  textColor={theme.text}
                  labelColor={theme.textSecondary}
                  chipBg={withOpacity(theme.textSecondary, 0.08)}
                />
                <StatChip
                  value={formatCompletionRate(stats)}
                  label="completion"
                  textColor={theme.text}
                  labelColor={theme.textSecondary}
                  chipBg={withOpacity(theme.textSecondary, 0.08)}
                />
              </>
            )}
          </View>

          {/* Primary action button */}
          {isFasting ? (
            <Pressable
              onPress={handleEndFast}
              disabled={endFast.isPending}
              accessibilityRole="button"
              accessibilityLabel="End Fast"
              accessibilityState={{
                busy: endFast.isPending,
                disabled: endFast.isPending,
              }}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: theme.error,
                  opacity: pressed || endFast.isPending ? 0.7 : 1,
                },
              ]}
            >
              {endFast.isPending ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText
                  style={[styles.actionButtonText, { color: theme.buttonText }]}
                >
                  ■ End Fast
                </ThemedText>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={handleStartFast}
              disabled={startFast.isPending}
              accessibilityRole="button"
              accessibilityLabel="Start Fast"
              accessibilityState={{
                busy: startFast.isPending,
                disabled: startFast.isPending,
              }}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: theme.link,
                  opacity: pressed || startFast.isPending ? 0.7 : 1,
                },
              ]}
            >
              {startFast.isPending ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText
                  style={[styles.actionButtonText, { color: theme.buttonText }]}
                >
                  ▶ Start Fast
                </ThemedText>
              )}
            </Pressable>
          )}

          {/* Tap-through */}
          <Pressable
            onPress={handleTapThrough}
            accessibilityRole="link"
            accessibilityLabel="History, stats and settings"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText style={[styles.tapThrough, { color: theme.link }]}>
              📊 History, stats & settings
            </ThemedText>
          </Pressable>
        </View>
      </Animated.View>

      <ConfirmationModal />
    </View>
  );
}

// ---------------------------------------------------------------------------
// StatChip — file-local helper component
// ---------------------------------------------------------------------------

interface StatChipProps {
  value: string;
  label: string;
  textColor: string;
  labelColor: string;
  chipBg: string;
}

function StatChip({
  value,
  label,
  textColor,
  labelColor,
  chipBg,
}: StatChipProps) {
  return (
    <View style={[styles.chip, { backgroundColor: chipBg }]}>
      <ThemedText style={[styles.chipValue, { color: textColor }]}>
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
  subtitle: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  clipContainer: { overflow: "hidden" },
  drawerBody: {
    position: "absolute",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  topRow: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "flex-start",
  },
  ringWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  ringEmoji: {
    position: "absolute",
    fontSize: 22,
  },
  phaseBlock: { flex: 1, justifyContent: "center" },
  phaseName: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    fontWeight: "600",
  },
  phaseDesc: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    marginTop: 2,
    lineHeight: 17,
  },
  chipsRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
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
  actionButton: {
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonText: {
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
