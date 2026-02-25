import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { WeightChart } from "@/components/WeightChart";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useWeightLogs,
  useWeightTrend,
  useLogWeight,
  useDeleteWeightLog,
  useSetGoalWeight,
  type ApiWeightLog,
} from "@/hooks/useWeightLogs";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { formatDateMedium as formatDate } from "@/lib/format";

function formatWeight(weight: string): string {
  return `${parseFloat(weight).toFixed(1)} kg`;
}

export default function WeightTrackingScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { isPremium } = usePremiumContext();

  const [weightInput, setWeightInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [goalInput, setGoalInput] = useState("");
  const [showGoalInput, setShowGoalInput] = useState(false);

  const { data: logs = [] } = useWeightLogs();
  const { data: trend } = useWeightTrend();
  const logWeight = useLogWeight();
  const deleteLog = useDeleteWeightLog();
  const setGoalWeight = useSetGoalWeight();

  const handleLogWeight = useCallback(() => {
    const weight = parseFloat(weightInput);
    if (isNaN(weight) || weight <= 0 || weight > 999) {
      Alert.alert("Invalid Weight", "Please enter a valid weight in kg.");
      return;
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logWeight.mutate(
      { weight, note: noteInput || undefined },
      {
        onSuccess: () => {
          setWeightInput("");
          setNoteInput("");
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
      },
    );
  }, [weightInput, noteInput, haptics, logWeight]);

  const handleDeleteLog = useCallback(
    (log: ApiWeightLog) => {
      Alert.alert("Delete Entry", `Remove ${formatWeight(log.weight)} entry?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
            deleteLog.mutate(log.id);
          },
        },
      ]);
    },
    [haptics, deleteLog],
  );

  const handleSetGoal = useCallback(() => {
    const goal = parseFloat(goalInput);
    if (isNaN(goal) || goal <= 0 || goal > 999) {
      Alert.alert("Invalid Weight", "Please enter a valid goal weight.");
      return;
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    setGoalWeight.mutate(goal, {
      onSuccess: () => {
        setGoalInput("");
        setShowGoalInput(false);
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
    });
  }, [goalInput, haptics, setGoalWeight]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        contentContainerStyle={{
          paddingBottom: insets.bottom + Spacing.xl,
        }}
      >
        {/* Log Weight Card */}
        <Card elevation={1} style={styles.inputCard}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Log Weight
          </ThemedText>
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.weightInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder="Weight (kg)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              value={weightInput}
              onChangeText={setWeightInput}
              accessibilityLabel="Weight in kilograms"
            />
            <Pressable
              onPress={handleLogWeight}
              disabled={logWeight.isPending || !weightInput}
              accessibilityLabel="Log weight"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.logButton,
                {
                  backgroundColor: theme.link,
                  opacity:
                    pressed || logWeight.isPending || !weightInput ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="plus" size={20} color={theme.buttonText} />
            </Pressable>
          </View>
          <TextInput
            style={[
              styles.noteInput,
              {
                backgroundColor: theme.backgroundSecondary,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            placeholder="Note (optional)"
            placeholderTextColor={theme.textSecondary}
            value={noteInput}
            onChangeText={setNoteInput}
            accessibilityLabel="Optional note"
          />
        </Card>

        {/* Trend Summary */}
        {trend && trend.currentWeight != null && (
          <Card elevation={1} style={styles.trendCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              Trend
            </ThemedText>
            <View style={styles.trendRow}>
              <View style={styles.trendItem}>
                <ThemedText style={styles.trendValue}>
                  {trend.currentWeight.toFixed(1)}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Current (kg)
                </ThemedText>
              </View>
              {trend.weeklyRateOfChange != null && (
                <View style={styles.trendItem}>
                  <ThemedText
                    style={[
                      styles.trendValue,
                      {
                        color:
                          trend.weeklyRateOfChange < 0
                            ? theme.success
                            : trend.weeklyRateOfChange > 0
                              ? theme.error
                              : theme.text,
                      },
                    ]}
                  >
                    {trend.weeklyRateOfChange > 0 ? "+" : ""}
                    {trend.weeklyRateOfChange.toFixed(2)}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    kg/week
                  </ThemedText>
                </View>
              )}
              {isPremium && trend.avg7Day != null && (
                <View style={styles.trendItem}>
                  <ThemedText style={styles.trendValue}>
                    {trend.avg7Day.toFixed(1)}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    7-day avg
                  </ThemedText>
                </View>
              )}
            </View>
            {isPremium && trend.projectedGoalDate && (
              <ThemedText
                type="caption"
                style={[styles.goalProjection, { color: theme.success }]}
              >
                Projected goal date: {trend.projectedGoalDate}
              </ThemedText>
            )}
          </Card>
        )}

        {/* Chart (premium) */}
        {isPremium && logs.length > 1 && (
          <Card elevation={1} style={styles.chartCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              Weight History
            </ThemedText>
            <WeightChart data={logs} goalWeight={trend?.goalWeight} />
          </Card>
        )}

        {/* Goal Weight */}
        <Card elevation={1} style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <ThemedText type="h4">Goal Weight</ThemedText>
            <Pressable
              onPress={() => setShowGoalInput(!showGoalInput)}
              accessibilityLabel="Set goal weight"
              accessibilityRole="button"
            >
              <Feather name="edit-2" size={18} color={theme.link} />
            </Pressable>
          </View>
          {trend?.goalWeight ? (
            <ThemedText style={styles.goalValue}>
              {trend.goalWeight.toFixed(1)} kg
            </ThemedText>
          ) : (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              No goal set
            </ThemedText>
          )}
          {showGoalInput && (
            <View style={styles.goalInputRow}>
              <TextInput
                style={[
                  styles.weightInput,
                  {
                    flex: 1,
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                placeholder="Goal weight (kg)"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                value={goalInput}
                onChangeText={setGoalInput}
                accessibilityLabel="Goal weight in kilograms"
              />
              <Pressable
                onPress={handleSetGoal}
                disabled={!goalInput}
                accessibilityLabel="Save goal weight"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.logButton,
                  {
                    backgroundColor: theme.success,
                    opacity: pressed || !goalInput ? 0.6 : 1,
                  },
                ]}
              >
                <Feather name="check" size={20} color={theme.buttonText} />
              </Pressable>
            </View>
          )}
        </Card>

        {/* History List */}
        <Card elevation={1} style={styles.historyCard}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            History
          </ThemedText>
          {logs.length === 0 ? (
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              No weight entries yet
            </ThemedText>
          ) : (
            logs.map((log) => (
              <Pressable
                key={log.id}
                onLongPress={() => handleDeleteLog(log)}
                accessibilityLabel={`${formatWeight(log.weight)} on ${formatDate(log.loggedAt)}`}
                accessibilityHint="Long press to delete"
                style={({ pressed }) => [
                  styles.historyItem,
                  {
                    borderBottomColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View>
                  <ThemedText style={styles.historyWeight}>
                    {formatWeight(log.weight)}
                  </ThemedText>
                  {log.note ? (
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      {log.note}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  {formatDate(log.loggedAt)}
                </ThemedText>
              </Pressable>
            ))
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inputCard: {
    margin: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  inputRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  weightInput: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
  },
  noteInput: {
    height: 44,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    fontSize: 14,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  logButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  trendCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  trendRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  trendItem: {
    alignItems: "center",
  },
  trendValue: {
    fontSize: 20,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  goalProjection: {
    textAlign: "center",
    marginTop: Spacing.md,
  },
  chartCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  goalCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  goalValue: {
    fontSize: 24,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  goalInputRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  historyCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  historyItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  historyWeight: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
});
