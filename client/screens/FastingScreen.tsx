import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Alert,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { FastingTimer } from "@/components/FastingTimer";
import { FastingSetupModal } from "@/components/FastingSetupModal";
import { FastingStreakBadge } from "@/components/FastingStreakBadge";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  useFastingSchedule,
  useCurrentFast,
  useFastingHistory,
  useUpdateSchedule,
  useStartFast,
  useEndFast,
} from "@/hooks/useFasting";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  FAB_CLEARANCE,
  withOpacity,
} from "@/constants/theme";
import { formatDuration, formatDateShort as formatDate } from "@/lib/format";

/** Compute elapsed minutes from a start time to now */
function getElapsedMinutes(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  return Math.max(0, (now - start) / 60000);
}

/** Build weekly bar chart data from fasting logs (last 7 days) */
function buildWeeklyData(
  logs: {
    startedAt: string;
    actualDurationMinutes: number | null;
    completed: boolean | null;
  }[],
): { day: string; minutes: number; completed: boolean }[] {
  const result: { day: string; minutes: number; completed: boolean }[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayName = dayNames[date.getDay()];

    const dayLog = logs.find((l) => {
      const logDate = new Date(l.startedAt).toISOString().split("T")[0];
      return logDate === dateStr;
    });

    result.push({
      day: dayName,
      minutes: dayLog?.actualDurationMinutes ?? 0,
      completed: dayLog?.completed ?? false,
    });
  }
  return result;
}

function WeeklyChart({
  data,
}: {
  data: { day: string; minutes: number; completed: boolean }[];
}) {
  const { theme } = useTheme();

  const maxMinutes = useMemo(
    () => Math.max(...data.map((d) => d.minutes), 60),
    [data],
  );
  const chartHeight = 120;
  const barWidth = 28;
  const gap = 12;
  const totalWidth = data.length * (barWidth + gap) - gap;
  const padding = { top: 10, bottom: 24 };
  const usableHeight = chartHeight - padding.top - padding.bottom;

  return (
    <Svg
      width="100%"
      height={chartHeight}
      viewBox={`0 0 ${totalWidth} ${chartHeight}`}
    >
      {data.map((d, i) => {
        const barHeight =
          maxMinutes > 0 ? (d.minutes / maxMinutes) * usableHeight : 0;
        const x = i * (barWidth + gap);
        const y = padding.top + usableHeight - barHeight;
        const fillColor = d.completed
          ? theme.success
          : d.minutes > 0
            ? withOpacity(theme.link, 0.6)
            : withOpacity(theme.textSecondary, 0.15);

        return (
          <React.Fragment key={d.day}>
            <Rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 2)}
              rx={4}
              fill={fillColor}
            />
            <SvgText
              x={x + barWidth / 2}
              y={chartHeight - 4}
              fontSize={10}
              fill={theme.textSecondary}
              textAnchor="middle"
            >
              {d.day}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export default function FastingScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();

  const [showSetup, setShowSetup] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  const { data: schedule } = useFastingSchedule();
  const { data: currentFast, refetch: refetchCurrent } = useCurrentFast();
  const {
    data: historyData,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useFastingHistory();
  const updateSchedule = useUpdateSchedule();
  const startFast = useStartFast();
  const endFast = useEndFast();

  const isFasting = currentFast != null;
  const stats = historyData?.stats;
  const logs = useMemo(() => historyData?.logs ?? [], [historyData?.logs]);

  // Update elapsed time every 30 seconds when fasting
  useEffect(() => {
    if (!currentFast) {
      setElapsedMinutes(0);
      return;
    }
    // Initial set
    setElapsedMinutes(getElapsedMinutes(currentFast.startedAt));

    const interval = setInterval(() => {
      setElapsedMinutes(getElapsedMinutes(currentFast.startedAt));
    }, 30000);
    return () => clearInterval(interval);
  }, [currentFast]);

  const weeklyData = useMemo(() => buildWeeklyData(logs), [logs]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchCurrent(), refetchHistory()]);
  }, [refetchCurrent, refetchHistory]);

  const handleStartFast = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    startFast.mutate(undefined, {
      onSuccess: () => {
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
      onError: (err) => {
        Alert.alert("Error", err.message || "Failed to start fast");
      },
    });
  }, [haptics, startFast]);

  const handleEndFast = useCallback(() => {
    Alert.alert("End Fast", "Are you sure you want to end your current fast?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End Fast",
        style: "destructive",
        onPress: () => {
          haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
          endFast.mutate(undefined, {
            onSuccess: (result) => {
              const type = result.completed
                ? Haptics.NotificationFeedbackType.Success
                : Haptics.NotificationFeedbackType.Warning;
              haptics.notification(type);
              if (result.completed) {
                Alert.alert(
                  "Fast Complete",
                  `Great job! You fasted for ${formatDuration(result.actualDurationMinutes ?? 0)}.`,
                );
              }
            },
            onError: (err) => {
              Alert.alert("Error", err.message || "Failed to end fast");
            },
          });
        },
      },
    ]);
  }, [haptics, endFast]);

  const handleSaveSchedule = useCallback(
    (data: {
      protocol: string;
      fastingHours: number;
      eatingHours: number;
      eatingWindowStart?: string;
      eatingWindowEnd?: string;
    }) => {
      updateSchedule.mutate(data, {
        onSuccess: () => {
          setShowSetup(false);
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
        onError: (err) => {
          Alert.alert("Error", err.message || "Failed to save schedule");
        },
      });
    },
    [updateSchedule, haptics],
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: insets.top + Spacing.lg,
        paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={handleRefresh}
          tintColor={theme.link}
        />
      }
    >
      {/* Header */}
      <Animated.View
        entering={reducedMotion ? undefined : FadeInDown.delay(0).duration(400)}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <ThemedText type="h3">Intermittent Fasting</ThemedText>
          <Pressable
            onPress={() => {
              haptics.selection();
              setShowSetup(true);
            }}
            accessibilityLabel="Configure fasting schedule"
            accessibilityRole="button"
            hitSlop={11}
          >
            <Feather name="settings" size={22} color={theme.link} />
          </Pressable>
        </View>
        {stats && stats.currentStreak > 0 && (
          <FastingStreakBadge streak={stats.currentStreak} />
        )}
      </Animated.View>

      {/* Timer Section */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(100).duration(400)
        }
      >
        <Card elevation={1} style={styles.timerCard}>
          {isFasting && currentFast ? (
            <>
              <FastingTimer
                startedAt={currentFast.startedAt}
                targetHours={currentFast.targetDurationHours}
                elapsedMinutes={elapsedMinutes}
              />
              <Pressable
                onPress={handleEndFast}
                disabled={endFast.isPending}
                accessibilityLabel="End fast"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: endFast.isPending,
                  busy: endFast.isPending,
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.error,
                    opacity: pressed || endFast.isPending ? 0.6 : 1,
                  },
                ]}
              >
                <Feather
                  name="stop-circle"
                  size={20}
                  color={theme.buttonText}
                />
                <ThemedText
                  style={[styles.actionButtonText, { color: theme.buttonText }]}
                >
                  {endFast.isPending ? "Ending..." : "End Fast"}
                </ThemedText>
              </Pressable>
              <ThemedText
                type="caption"
                style={[styles.fastStarted, { color: theme.textSecondary }]}
              >
                Started{" "}
                {new Date(currentFast.startedAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </ThemedText>
            </>
          ) : (
            <>
              <View style={styles.idleState}>
                <Feather
                  name="moon"
                  size={48}
                  color={withOpacity(theme.link, 0.4)}
                />
                <ThemedText
                  type="h4"
                  style={[styles.idleTitle, { color: theme.text }]}
                >
                  Ready to fast?
                </ThemedText>
                <ThemedText
                  type="small"
                  style={[styles.idleSubtitle, { color: theme.textSecondary }]}
                >
                  {schedule
                    ? `${schedule.protocol} protocol (${schedule.fastingHours}h fast)`
                    : "Set up a schedule or start a 16h fast"}
                </ThemedText>
              </View>
              <Pressable
                onPress={handleStartFast}
                disabled={startFast.isPending}
                accessibilityLabel="Start fast"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: startFast.isPending,
                  busy: startFast.isPending,
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.link,
                    opacity: pressed || startFast.isPending ? 0.6 : 1,
                  },
                ]}
              >
                <Feather
                  name="play-circle"
                  size={20}
                  color={theme.buttonText}
                />
                <ThemedText
                  style={[styles.actionButtonText, { color: theme.buttonText }]}
                >
                  {startFast.isPending ? "Starting..." : "Start Fast"}
                </ThemedText>
              </Pressable>
            </>
          )}
        </Card>
      </Animated.View>

      {/* Schedule Info Card */}
      {schedule && (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(200).duration(400)
          }
        >
          <Card elevation={1} style={styles.scheduleCard}>
            <View style={styles.scheduleHeader}>
              <ThemedText type="h4">Schedule</ThemedText>
              <Pressable
                onPress={() => {
                  haptics.selection();
                  setShowSetup(true);
                }}
                accessibilityLabel="Edit schedule"
                accessibilityRole="button"
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              >
                <Feather name="edit-2" size={16} color={theme.link} />
              </Pressable>
            </View>
            <View style={styles.scheduleDetails}>
              <View style={styles.scheduleItem}>
                <Feather name="clock" size={16} color={theme.textSecondary} />
                <ThemedText type="small">
                  {schedule.protocol} protocol
                </ThemedText>
              </View>
              <View style={styles.scheduleItem}>
                <Feather name="moon" size={16} color={theme.textSecondary} />
                <ThemedText type="small">
                  {schedule.fastingHours}h fasting
                </ThemedText>
              </View>
              <View style={styles.scheduleItem}>
                <Feather name="sun" size={16} color={theme.textSecondary} />
                <ThemedText type="small">
                  {schedule.eatingHours}h eating
                  {schedule.eatingWindowStart && schedule.eatingWindowEnd
                    ? ` (${schedule.eatingWindowStart}-${schedule.eatingWindowEnd})`
                    : ""}
                </ThemedText>
              </View>
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Weekly History Chart */}
      {logs.length > 0 && (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(300).duration(400)
          }
        >
          <Card elevation={1} style={styles.chartCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              This Week
            </ThemedText>
            <WeeklyChart data={weeklyData} />
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: theme.success }]}
                />
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Completed
                </ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    {
                      backgroundColor: withOpacity(theme.link, 0.6),
                    },
                  ]}
                />
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Partial
                </ThemedText>
              </View>
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Stats Summary */}
      {stats && stats.totalFasts > 0 && (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(400).duration(400)
          }
        >
          <Card elevation={1} style={styles.statsCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              Statistics
            </ThemedText>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <ThemedText style={[styles.statValue, { color: theme.link }]}>
                  {Math.round(stats.completionRate * 100)}%
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Completion
                </ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statValue, { color: theme.success }]}
                >
                  {formatDuration(stats.averageDurationMinutes)}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Avg Duration
                </ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statValue, { color: theme.warning }]}
                >
                  {stats.longestStreak}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Best Streak
                </ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={[styles.statValue, { color: theme.text }]}>
                  {stats.completedFasts}/{stats.totalFasts}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Completed
                </ThemedText>
              </View>
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Recent History */}
      {logs.length > 0 && (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(500).duration(400)
          }
        >
          <Card elevation={1} style={styles.historyCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              Recent Fasts
            </ThemedText>
            {logs.slice(0, 10).map((log) => (
              <View
                key={log.id}
                style={[
                  styles.historyItem,
                  { borderBottomColor: theme.border },
                ]}
                accessibilityLabel={`${formatDate(log.startedAt)}: ${
                  log.actualDurationMinutes
                    ? formatDuration(log.actualDurationMinutes)
                    : "In progress"
                }${log.completed ? ", completed" : ""}`}
              >
                <View style={styles.historyItemLeft}>
                  <View style={styles.historyItemHeader}>
                    <Feather
                      name={log.completed ? "check-circle" : "circle"}
                      size={16}
                      color={
                        log.completed ? theme.success : theme.textSecondary
                      }
                    />
                    <ThemedText style={styles.historyDate}>
                      {formatDate(log.startedAt)}
                    </ThemedText>
                  </View>
                  {log.note ? (
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                      numberOfLines={1}
                    >
                      {log.note}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.historyItemRight}>
                  <ThemedText
                    style={[
                      styles.historyDuration,
                      {
                        color: log.completed ? theme.success : theme.text,
                      },
                    ]}
                  >
                    {log.actualDurationMinutes
                      ? formatDuration(log.actualDurationMinutes)
                      : "--"}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    / {log.targetDurationHours}h
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        </Animated.View>
      )}

      {/* Empty State */}
      {!isFasting && logs.length === 0 && !historyLoading && (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(200).duration(400)
          }
        >
          <Card elevation={1} style={styles.emptyCard}>
            <Feather
              name="coffee"
              size={40}
              color={withOpacity(theme.textSecondary, 0.5)}
            />
            <ThemedText type="h4" style={styles.emptyTitle}>
              No fasting history
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.emptyText, { color: theme.textSecondary }]}
            >
              Start your first fast to begin tracking your intermittent fasting
              journey.
            </ThemedText>
          </Card>
        </Animated.View>
      )}

      {/* Setup Modal */}
      <FastingSetupModal
        visible={showSetup}
        onClose={() => setShowSetup(false)}
        onSave={handleSaveSchedule}
        isPending={updateSchedule.isPending}
        initialProtocol={schedule?.protocol}
        initialFastingHours={schedule?.fastingHours}
        initialEatingWindowStart={schedule?.eatingWindowStart ?? undefined}
        initialEatingWindowEnd={schedule?.eatingWindowEnd ?? undefined}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timerCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    alignItems: "center",
  },
  actionButton: {
    flexDirection: "row",
    height: 52,
    borderRadius: BorderRadius.button,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    alignSelf: "stretch",
  },
  actionButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  fastStarted: {
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  idleState: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    gap: Spacing.md,
  },
  idleTitle: {
    marginTop: Spacing.sm,
  },
  idleSubtitle: {
    textAlign: "center",
  },
  scheduleCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  scheduleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  scheduleDetails: {
    gap: Spacing.sm,
  },
  scheduleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chartCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  chartLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.xl,
    marginTop: Spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statsCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  statItem: {
    flex: 1,
    minWidth: "40%",
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  statValue: {
    fontSize: 20,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  historyCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  historyItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  historyItemLeft: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  historyItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 2,
  },
  historyDate: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  historyItemRight: {
    alignItems: "flex-end",
  },
  historyDuration: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  emptyCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    gap: Spacing.md,
  },
  emptyTitle: {
    marginTop: Spacing.sm,
  },
  emptyText: {
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
  },
});
