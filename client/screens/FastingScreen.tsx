import React, { useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { FastingTimer } from "@/components/FastingTimer";
import { FastingSetupModal } from "@/components/FastingSetupModal";
import { FastingStreakBadge } from "@/components/FastingStreakBadge";
import WeeklyChart from "@/components/WeeklyFastingChart";
import { AskCoachSection } from "@/components/AskCoachSection";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useFastingTimer } from "@/hooks/useFastingTimer";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  FAB_CLEARANCE,
  withOpacity,
} from "@/constants/theme";
import { formatDuration, formatDateShort as formatDate } from "@/lib/format";

const FASTING_COACH_QUESTIONS = [
  {
    text: "Does coffee break my fast?",
    question: "Does coffee break my fast?",
  },
  {
    text: "How do I handle hunger during a fast?",
    question: "How do I handle hunger during a fast?",
  },
  {
    text: "What are the benefits of 16:8 fasting?",
    question: "What are the benefits of 16:8 fasting?",
  },
  {
    text: "Is it safe to exercise while fasting?",
    question: "Is it safe to exercise while fasting?",
  },
  {
    text: "What should I eat to break my fast?",
    question: "What should I eat to break my fast?",
  },
  {
    text: "How does fasting affect metabolism?",
    question: "How does fasting affect metabolism?",
  },
] as const;

export default function FastingScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const { reducedMotion } = useAccessibility();

  const {
    theme,
    haptics,
    showSetup,
    setShowSetup,
    elapsedMinutes,
    schedule,
    currentFast,
    historyLoading,
    updateSchedule,
    startFast,
    endFast,
    isFasting,
    stats,
    logs,
    weeklyData,
    currentPhase,
    nextPhaseBoundary,
    idleTip,
    handleRefresh,
    handleStartFast,
    handleEndFast,
    handleSaveSchedule,
    ConfirmationModal,
  } = useFastingTimer();

  const fastingContext = useMemo(
    () =>
      `User is on fasting screen. Schedule: ${schedule?.protocol ?? "none"}. Currently ${isFasting ? "fasting" : "not fasting"}${elapsedMinutes ? `. Elapsed: ${Math.round(elapsedMinutes / 60)}h` : ""}`,
    [schedule?.protocol, isFasting, elapsedMinutes],
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
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

      {/* Phase Info Card */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(200).duration(400)
        }
      >
        {isFasting && currentPhase ? (
          <Card elevation={1} style={styles.phaseCard}>
            <View
              accessible
              accessibilityLabel={`Current phase: ${currentPhase.name}. ${currentPhase.description}${nextPhaseBoundary ? `. Next phase: ${nextPhaseBoundary.phase.name} in ${formatDuration(nextPhaseBoundary.minutes - elapsedMinutes)}` : ""}`}
            >
              <View style={styles.phaseHeader}>
                <Feather
                  name="activity"
                  size={18}
                  color={theme.link}
                  importantForAccessibility="no"
                />
                <ThemedText style={[styles.phaseName, { color: theme.link }]}>
                  {currentPhase.name}
                </ThemedText>
              </View>
              <ThemedText
                type="small"
                style={[
                  styles.phaseDescription,
                  { color: theme.textSecondary },
                ]}
              >
                {currentPhase.description}
              </ThemedText>
              {nextPhaseBoundary && (
                <ThemedText
                  type="caption"
                  style={[styles.phaseNext, { color: theme.text }]}
                >
                  Next: {nextPhaseBoundary.phase.name} in{" "}
                  {formatDuration(nextPhaseBoundary.minutes - elapsedMinutes)}
                </ThemedText>
              )}
            </View>
          </Card>
        ) : (
          <Card elevation={1} style={styles.phaseCard}>
            <View
              style={styles.tipRow}
              accessible
              accessibilityLabel={idleTip.text}
            >
              <ThemedText style={styles.tipIcon} importantForAccessibility="no">
                {idleTip.icon}
              </ThemedText>
              <ThemedText
                type="small"
                style={[styles.tipText, { color: theme.textSecondary }]}
              >
                {idleTip.text}
              </ThemedText>
            </View>
          </Card>
        )}
      </Animated.View>

      {/* Ask Coach */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(300).duration(400)
        }
      >
        <AskCoachSection
          questions={FASTING_COACH_QUESTIONS}
          screenContext={fastingContext}
        />
      </Animated.View>

      {/* Schedule Info Card */}
      {schedule && (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(400).duration(400)
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
            reducedMotion ? undefined : FadeInDown.delay(500).duration(400)
          }
        >
          <Card elevation={1} style={styles.chartCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              This Week
            </ThemedText>
            <View
              accessible={true}
              accessibilityRole="image"
              accessibilityLabel={`Weekly fasting chart: ${weeklyData.filter((d) => d.completed).length} of 7 days completed, ${weeklyData.filter((d) => d.minutes > 0).length} days with fasting activity`}
            >
              <WeeklyChart data={weeklyData} />
            </View>
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
            reducedMotion ? undefined : FadeInDown.delay(600).duration(400)
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
            reducedMotion ? undefined : FadeInDown.delay(700).duration(400)
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
        initialNotifyEatingWindow={schedule?.notifyEatingWindow ?? true}
        initialNotifyMilestones={schedule?.notifyMilestones ?? true}
        initialNotifyCheckIns={schedule?.notifyCheckIns ?? true}
      />
      <ConfirmationModal />
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
  // Phase Info Card
  phaseCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  phaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  phaseName: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  phaseDescription: {
    lineHeight: 20,
  },
  phaseNext: {
    marginTop: Spacing.sm,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  tipIcon: {
    fontSize: 24,
  },
  tipText: {
    flex: 1,
    lineHeight: 20,
  },
});
