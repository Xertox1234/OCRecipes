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
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { Card } from "@/components/Card";
import { CalorieBudgetBar } from "@/components/CalorieBudgetBar";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useExerciseLogs,
  useLogExercise,
  useDeleteExerciseLog,
  type ApiExerciseLog,
} from "@/hooks/useExerciseLogs";
import { useDailyBudget } from "@/hooks/useDailyBudget";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  FAB_CLEARANCE,
  TAB_BAR_HEIGHT,
} from "@/constants/theme";
import type { ActivityStackParamList } from "@/navigation/ActivityStackNavigator";

type NavigationProp = NativeStackNavigationProp<
  ActivityStackParamList,
  "ExerciseLog"
>;

const EXERCISE_TYPES = [
  { key: "cardio", label: "Cardio" },
  { key: "strength", label: "Strength" },
  { key: "flexibility", label: "Flex" },
  { key: "sports", label: "Sports" },
  { key: "other", label: "Other" },
] as const;

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCalories(cal: string | null): string {
  if (!cal) return "--";
  return `${Math.round(parseFloat(cal))} cal`;
}

export default function ExerciseLogScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<NavigationProp>();

  const [exerciseName, setExerciseName] = useState("");
  const [exerciseType, setExerciseType] = useState<string>("cardio");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  // Get today's date range for fetching logs
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const { data: logs = [] } = useExerciseLogs({
    from: todayStart.toISOString(),
    to: todayEnd.toISOString(),
  });
  const { data: budget } = useDailyBudget();
  const logExercise = useLogExercise();
  const deleteLog = useDeleteExerciseLog();

  const handleLogExercise = useCallback(() => {
    const durationMinutes = parseInt(duration, 10);
    if (!exerciseName.trim()) {
      setExerciseError("Please enter an exercise name.");
      return;
    }
    if (isNaN(durationMinutes) || durationMinutes <= 0) {
      setExerciseError("Please enter a valid duration in minutes.");
      return;
    }
    setExerciseError(null);

    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logExercise.mutate(
      {
        exerciseName: exerciseName.trim(),
        exerciseType,
        durationMinutes,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setExerciseName("");
          setDuration("");
          setNotes("");
          haptics.notification(Haptics.NotificationFeedbackType.Success);
          AccessibilityInfo.announceForAccessibility(
            "Exercise logged successfully",
          );
        },
      },
    );
  }, [exerciseName, exerciseType, duration, notes, haptics, logExercise]);

  const handleDeleteLog = useCallback(
    (log: ApiExerciseLog) => {
      Alert.alert("Delete Exercise", `Remove "${log.exerciseName}" entry?`, [
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

  const handleSearchExercise = useCallback(() => {
    haptics.selection();
    navigation.navigate("ExerciseSearch", {
      onSelect: (exercise) => {
        setExerciseName(exercise.name);
        setExerciseType(exercise.type);
      },
    });
  }, [haptics, navigation]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.lg,
          paddingBottom:
            insets.bottom + TAB_BAR_HEIGHT + FAB_CLEARANCE + Spacing.xl,
        }}
        keyboardDismissMode="on-drag"
      >
        {/* Page Title */}
        <ThemedText type="h3" style={styles.pageTitle}>
          Activity
        </ThemedText>

        {/* Daily Budget Bar */}
        {budget && (
          <Card elevation={1} style={styles.budgetCard}>
            <ThemedText type="h4" style={styles.sectionTitle}>
              Daily Budget
            </ThemedText>
            <CalorieBudgetBar
              calorieGoal={budget.calorieGoal}
              foodCalories={budget.foodCalories}
              exerciseCalories={budget.exerciseCalories}
            />
          </Card>
        )}

        {/* Log Exercise Card */}
        <Card elevation={1} style={styles.inputCard}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Log Exercise
          </ThemedText>

          {/* Exercise Name Input with Search Button */}
          <View style={styles.nameRow}>
            <TextInput
              style={[
                styles.nameInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder="Exercise name"
              placeholderTextColor={theme.textSecondary}
              value={exerciseName}
              onChangeText={(text) => {
                setExerciseName(text);
                if (exerciseError) setExerciseError(null);
              }}
              accessibilityLabel="Exercise name"
            />
            <Pressable
              onPress={handleSearchExercise}
              accessibilityLabel="Search exercise library"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.searchButton,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="search" size={20} color={theme.link} />
            </Pressable>
          </View>

          {/* Type Selector */}
          <View
            style={styles.typeRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Exercise type"
          >
            {EXERCISE_TYPES.map((t) => {
              const isSelected = exerciseType === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    haptics.selection();
                    setExerciseType(t.key);
                  }}
                  accessibilityLabel={`${t.label} exercise type`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: isSelected
                        ? theme.link
                        : theme.backgroundSecondary,
                      borderColor: isSelected ? theme.link : theme.border,
                    },
                  ]}
                >
                  <ThemedText
                    type="caption"
                    style={{
                      color: isSelected ? theme.buttonText : theme.text,
                      fontFamily: FontFamily.medium,
                    }}
                  >
                    {t.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Duration + Log Button */}
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.durationInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder="Duration (min)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              value={duration}
              onChangeText={(text) => {
                setDuration(text);
                if (exerciseError) setExerciseError(null);
              }}
              accessibilityLabel="Duration in minutes"
            />
            <Pressable
              onPress={handleLogExercise}
              disabled={logExercise.isPending || !exerciseName || !duration}
              accessibilityLabel="Log exercise"
              accessibilityRole="button"
              accessibilityState={{
                disabled: logExercise.isPending || !exerciseName || !duration,
                busy: logExercise.isPending,
              }}
              style={({ pressed }) => [
                styles.logButton,
                {
                  backgroundColor: theme.link,
                  opacity:
                    pressed ||
                    logExercise.isPending ||
                    !exerciseName ||
                    !duration
                      ? 0.6
                      : 1,
                },
              ]}
            >
              <Feather name="plus" size={20} color={theme.buttonText} />
            </Pressable>
          </View>

          {/* Notes */}
          <TextInput
            style={[
              styles.noteInput,
              {
                backgroundColor: theme.backgroundSecondary,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            placeholder="Notes (optional)"
            placeholderTextColor={theme.textSecondary}
            value={notes}
            onChangeText={setNotes}
            accessibilityLabel="Optional notes"
          />
          <InlineError
            message={exerciseError}
            style={{ marginTop: Spacing.sm }}
          />
        </Card>

        {/* Today's Exercises */}
        <Card elevation={1} style={styles.historyCard}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Today&apos;s Exercises
          </ThemedText>
          {logs.length === 0 ? (
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              No exercises logged today
            </ThemedText>
          ) : (
            logs.map((log) => (
              <Pressable
                key={log.id}
                onLongPress={() => handleDeleteLog(log)}
                accessibilityLabel={`${log.exerciseName}, ${log.durationMinutes} minutes, ${formatCalories(log.caloriesBurned)}`}
                accessibilityHint="Long press to delete"
                style={({ pressed }) => [
                  styles.exerciseItem,
                  {
                    borderBottomColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={styles.exerciseItemLeft}>
                  <View style={styles.exerciseItemHeader}>
                    <ThemedText style={styles.exerciseName}>
                      {log.exerciseName}
                    </ThemedText>
                    <View
                      style={[
                        styles.typeBadge,
                        { backgroundColor: theme.backgroundSecondary },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: theme.textSecondary }}
                      >
                        {log.exerciseType}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    {log.durationMinutes} min
                    {log.notes ? ` \u00b7 ${log.notes}` : ""}
                  </ThemedText>
                </View>
                <View style={styles.exerciseItemRight}>
                  <ThemedText
                    style={[styles.caloriesText, { color: theme.success }]}
                  >
                    {formatCalories(log.caloriesBurned)}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    {formatTime(log.loggedAt)}
                  </ThemedText>
                </View>
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
  pageTitle: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  budgetCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  inputCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  nameRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  nameInput: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  typeRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
    flexWrap: "wrap",
  },
  typeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
  },
  inputRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  durationInput: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
  },
  logButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
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
  historyCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  exerciseItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  exerciseItemLeft: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  exerciseItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: 2,
  },
  exerciseName: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 1,
    borderRadius: BorderRadius.chip,
  },
  exerciseItemRight: {
    alignItems: "flex-end",
  },
  caloriesText: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
});
