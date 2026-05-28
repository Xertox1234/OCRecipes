import React, { useCallback, useEffect } from "react";
import {
  View,
  Switch,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { apiRequest } from "@/lib/query-client";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { ReminderMutes } from "@shared/types/reminders";
import { QUERY_KEYS } from "@/lib/query-keys";

interface ReminderToggleConfig {
  key: keyof ReminderMutes;
  label: string;
  description: string;
}

const READ_ERROR_MESSAGE = "Couldn't load your reminder settings.";

const REMINDER_TYPES: ReminderToggleConfig[] = [
  {
    key: "meal-log",
    label: "Meal logging nudges",
    description: "Reminder at noon when you haven't logged anything yet today",
  },
  {
    key: "commitment",
    label: "Commitment follow-ups",
    description:
      "Alerts when a goal you told the Coach about is due for review",
  },
  {
    key: "daily-checkin",
    label: "Daily check-in",
    description: "Morning briefing with your calorie progress",
  },
];

function useReminderMutes() {
  return useQuery({
    queryKey: QUERY_KEYS.dietaryProfile,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/dietary-profile");
      return res.json();
    },
    select: (profile: { reminderMutes?: ReminderMutes }) => ({
      reminderMutes: (profile.reminderMutes ?? {}) as ReminderMutes,
    }),
    // This screen renders its own error/retry UI on read failure, so suppress
    // the global QueryCache toast to avoid double-reporting the same failure.
    meta: { silentError: true },
  });
}

function useUpdateReminderMute() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (mutes: Partial<ReminderMutes>) => {
      const res = await apiRequest("PATCH", "/api/reminders/mutes", mutes);
      return res.json() as Promise<{ reminderMutes: ReminderMutes }>;
    },
    onSuccess: () => {
      // Invalidate rather than setQueryData — avoids corrupting the full profile
      // cache when it is cold (old === undefined), which would drop non-mutes
      // fields read by other hooks on the same key.
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.dietaryProfile,
      });
    },
    onError: () => {
      // The global query-error net is query-only; surface mutation failures here
      // so a failed toggle does not silently leave the UI showing the wrong state.
      toast.error("Couldn't update your reminder settings. Please try again.");
    },
  });
}

export default function CoachRemindersScreen() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useReminderMutes();
  const updateMute = useUpdateReminderMute();

  const handleToggle = useCallback(
    (key: keyof ReminderMutes, currentlyMuted: boolean) => {
      haptics.selection();
      updateMute.mutate({ [key]: !currentlyMuted });
    },
    [haptics, updateMute],
  );

  // The error text carries an Android live region; announce it on iOS too so
  // the read-failure state is not silent for VoiceOver users. Gated to the
  // false→true transition (deps [isError]) to avoid re-announcing on refetch.
  useEffect(() => {
    if (isError && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(READ_ERROR_MESSAGE);
    }
  }, [isError]);

  const mutes = data?.reminderMutes ?? {};

  return (
    <ScrollView
      style={{ backgroundColor: theme.backgroundDefault }}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + Spacing.lg },
      ]}
    >
      <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
        {"Turn off categories you don't want the Coach to remind you about."}
      </ThemedText>

      {isError ? (
        <View style={styles.errorContainer}>
          <ThemedText
            style={[styles.errorText, { color: theme.textSecondary }]}
            accessibilityLiveRegion="assertive"
          >
            {READ_ERROR_MESSAGE}
          </ThemedText>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading reminder settings"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ThemedText style={[styles.retryText, { color: theme.link }]}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <View
          style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}
        >
          {REMINDER_TYPES.map((item, index) => {
            const isMuted = !!mutes[item.key];
            const isEnabled = !isMuted;
            const isLast = index === REMINDER_TYPES.length - 1;

            return (
              <View key={item.key}>
                <View
                  style={styles.row}
                  accessible
                  accessibilityRole="switch"
                  accessibilityLabel={item.label}
                  accessibilityValue={{ text: isEnabled ? "on" : "off" }}
                >
                  <View style={styles.labelContainer}>
                    <ThemedText style={styles.label}>{item.label}</ThemedText>
                    <ThemedText
                      style={[
                        styles.description,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {item.description}
                    </ThemedText>
                  </View>
                  <Switch
                    value={isEnabled}
                    onValueChange={() => handleToggle(item.key, isMuted)}
                    trackColor={{
                      false: withOpacity(theme.textSecondary, 0.3),
                      true: theme.link,
                    }}
                    thumbColor={
                      Platform.OS === "android" ? "#FFFFFF" : undefined // hardcoded
                    }
                    disabled={isLoading || updateMute.isPending}
                  />
                </View>
                {!isLast && (
                  <View
                    style={[
                      styles.divider,
                      {
                        backgroundColor: withOpacity(theme.textSecondary, 0.12),
                      },
                    ]}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorContainer: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: Spacing.xs,
  },
  errorText: {
    fontSize: 13,
  },
  retryText: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
  },
  card: {
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.md,
  },
  labelContainer: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.md,
  },
});
