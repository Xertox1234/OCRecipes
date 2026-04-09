import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo, Alert, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { toDateString } from "@shared/lib/date";
import {
  useFastingSchedule,
  useCurrentFast,
  useFastingHistory,
  useUpdateSchedule,
  useStartFast,
  useEndFast,
} from "@/hooks/useFasting";
import { formatDuration } from "@/lib/format";
import {
  getFastingPhase,
  getNextPhaseBoundary,
  FASTING_TIPS,
} from "@/components/fasting-display-utils";
import { requestNotificationPermission } from "@/lib/notifications";
import {
  scheduleMilestoneNotifications,
  scheduleCheckInNotifications,
  scheduleEatingWindowNotifications,
} from "@/lib/fasting-notifications";

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
    const dateStr = toDateString(date);
    const dayName = dayNames[date.getDay()];

    const dayLog = logs.find((l) => {
      const logDate = toDateString(new Date(l.startedAt));
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

export function useFastingTimer() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { confirm, ConfirmationModal } = useConfirmationModal();

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

  // Phase computation — stable per hour bucket (review #7)
  const phaseHourBucket = Math.floor(elapsedMinutes / 60);
  const currentPhase = useMemo(
    () => (isFasting ? getFastingPhase(elapsedMinutes) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phaseHourBucket, isFasting],
  );
  const nextPhaseBoundary = useMemo(
    () => (isFasting ? getNextPhaseBoundary(elapsedMinutes) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phaseHourBucket, isFasting],
  );

  // Phase transition — haptic + a11y announcement
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentPhase) {
      prevPhaseRef.current = null;
      return;
    }
    if (
      prevPhaseRef.current !== null &&
      currentPhase.name !== prevPhaseRef.current
    ) {
      AccessibilityInfo.announceForAccessibility(
        `You've entered the ${currentPhase.name} phase`,
      );
      haptics.notification(Haptics.NotificationFeedbackType.Success);
    }
    prevPhaseRef.current = currentPhase.name;
  }, [currentPhase, haptics]);

  // Random idle tip — stable per mount (LEARNINGS.md:59)
  const [idleTip] = useState(
    () => FASTING_TIPS[Math.floor(Math.random() * FASTING_TIPS.length)],
  );

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchCurrent(), refetchHistory()]);
    haptics.impact();
  }, [refetchCurrent, refetchHistory, haptics]);

  const handleStartFast = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    startFast.mutate(undefined, {
      onSuccess: async (log) => {
        haptics.notification(Haptics.NotificationFeedbackType.Success);

        // Schedule notifications if any toggle is enabled
        const s = schedule;
        const anyEnabled =
          (s?.notifyMilestones ?? true) ||
          (s?.notifyCheckIns ?? true) ||
          (s?.notifyEatingWindow ?? true);
        if (!anyEnabled) return;

        const granted = await requestNotificationPermission();
        if (!granted) {
          Alert.alert(
            "Notifications Disabled",
            "Enable notifications in Settings to receive fasting reminders and milestone encouragements.",
            [
              { text: "Not Now", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => Linking.openSettings(),
              },
            ],
          );
          return;
        }

        const startedAt = new Date(log.startedAt);
        const batches: Promise<string[]>[] = [];

        if (s?.notifyMilestones ?? true) {
          batches.push(
            scheduleMilestoneNotifications(startedAt, log.targetDurationHours),
          );
        }
        if (s?.notifyCheckIns ?? true) {
          batches.push(scheduleCheckInNotifications(startedAt));
        }
        if (
          (s?.notifyEatingWindow ?? true) &&
          s?.eatingWindowStart &&
          s?.eatingWindowEnd
        ) {
          batches.push(
            scheduleEatingWindowNotifications(
              s.eatingWindowStart,
              s.eatingWindowEnd,
            ),
          );
        }
        await Promise.all(batches);
      },
      onError: (err) => {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        toast.error(err.message || "Failed to start fast");
      },
    });
  }, [haptics, toast, startFast, schedule]);

  const handleEndFast = useCallback(() => {
    confirm({
      title: "End Fast",
      message: "Are you sure you want to end your current fast?",
      confirmLabel: "End Fast",
      destructive: true,
      onConfirm: () => {
        // Cancel all pending fasting notifications (survives unmount/crash)
        Notifications.cancelAllScheduledNotificationsAsync();

        endFast.mutate(undefined, {
          onSuccess: (result) => {
            const type = result.completed
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Warning;
            haptics.notification(type);
            if (result.completed) {
              toast.success(
                `Great job! You fasted for ${formatDuration(result.actualDurationMinutes ?? 0)}.`,
              );
            }
          },
          onError: (err) => {
            haptics.notification(Haptics.NotificationFeedbackType.Error);
            toast.error(err.message || "Failed to end fast");
          },
        });
      },
    });
  }, [confirm, haptics, toast, endFast]);

  const handleSaveSchedule = useCallback(
    (data: {
      protocol: string;
      fastingHours: number;
      eatingHours: number;
      eatingWindowStart?: string;
      eatingWindowEnd?: string;
      notifyEatingWindow: boolean;
      notifyMilestones: boolean;
      notifyCheckIns: boolean;
    }) => {
      updateSchedule.mutate(data, {
        onSuccess: () => {
          setShowSetup(false);
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
        onError: (err) => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          toast.error(err.message || "Failed to save schedule");
        },
      });
    },
    [updateSchedule, haptics, toast],
  );

  return {
    theme,
    haptics,
    showSetup,
    setShowSetup,
    elapsedMinutes,
    schedule,
    currentFast,
    historyData,
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
    confirm,
    ConfirmationModal,
  };
}
