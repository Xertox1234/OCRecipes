import React, { useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type GoalSetupScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "GoalSetup"
>;

type Gender = "male" | "female" | "other";
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "athlete";
type PrimaryGoal =
  | "lose_weight"
  | "gain_muscle"
  | "maintain"
  | "eat_healthier"
  | "manage_condition";

interface CalculatedGoals {
  dailyCalories: number;
  dailyProtein: number;
  dailyCarbs: number;
  dailyFat: number;
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

const ACTIVITY_OPTIONS: {
  value: ActivityLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "sedentary",
    label: "Sedentary",
    description: "Little or no exercise",
  },
  {
    value: "light",
    label: "Lightly Active",
    description: "Light exercise 1-3 days/week",
  },
  {
    value: "moderate",
    label: "Moderately Active",
    description: "Moderate exercise 3-5 days/week",
  },
  {
    value: "active",
    label: "Very Active",
    description: "Hard exercise 6-7 days/week",
  },
  {
    value: "athlete",
    label: "Athlete",
    description: "Very hard exercise & physical job",
  },
];

const GOAL_OPTIONS: {
  value: PrimaryGoal;
  label: string;
  description: string;
}[] = [
  {
    value: "lose_weight",
    label: "Lose Weight",
    description: "-500 cal deficit",
  },
  {
    value: "gain_muscle",
    label: "Build Muscle",
    description: "+300 cal surplus",
  },
  {
    value: "maintain",
    label: "Maintain Weight",
    description: "Balanced intake",
  },
  {
    value: "eat_healthier",
    label: "Eat Healthier",
    description: "Focus on nutrition",
  },
  {
    value: "manage_condition",
    label: "Manage Condition",
    description: "Health-focused",
  },
];

function SelectableChip({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      accessibilityRole="radio"
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? theme.success + "20"
            : theme.backgroundSecondary,
          borderColor: selected ? theme.success : "transparent",
        },
      ]}
    >
      <ThemedText
        type="body"
        style={[
          styles.chipLabel,
          { color: selected ? theme.success : theme.text },
        ]}
      >
        {label}
      </ThemedText>
      {description && (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {description}
        </ThemedText>
      )}
    </Pressable>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  unit,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit: string;
  placeholder: string;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.numberInputContainer}>
      <ThemedText type="body" style={styles.inputLabel}>
        {label}
      </ThemedText>
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.numberInput,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel={label}
        />
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          {unit}
        </ThemedText>
      </View>
    </View>
  );
}

export default function GoalSetupScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<GoalSetupScreenNavigationProp>();
  const queryClient = useQueryClient();
  const { updateUser } = useAuthContext();

  // Form state - these will be entered by the user
  const [age, setAge] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(
    null,
  );
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);

  // Calculated goals (after calculation)
  const [calculatedGoals, setCalculatedGoals] =
    useState<CalculatedGoals | null>(null);

  // Manual adjustment state
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");

  const isFormComplete =
    age && weight && height && gender && activityLevel && primaryGoal;

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/goals/calculate", {
        age: parseInt(age),
        weight: parseFloat(weight),
        height: parseFloat(height),
        gender,
        activityLevel,
        primaryGoal,
      });
      return response.json() as Promise<CalculatedGoals>;
    },
    onSuccess: (data) => {
      setCalculatedGoals(data);
      setManualCalories(data.dailyCalories.toString());
      setManualProtein(data.dailyProtein.toString());
      setManualCarbs(data.dailyCarbs.toString());
      setManualFat(data.dailyFat.toString());
      haptics.notification(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PUT", "/api/goals", {
        dailyCalorieGoal: parseInt(manualCalories),
        dailyProteinGoal: parseInt(manualProtein),
        dailyCarbsGoal: parseInt(manualCarbs),
        dailyFatGoal: parseInt(manualFat),
        weight: parseFloat(weight),
        height: parseFloat(height),
        age: parseInt(age),
        gender,
      });
      return response.json();
    },
    onSuccess: async () => {
      // Update local user state
      await updateUser({
        dailyCalorieGoal: parseInt(manualCalories),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleCalculate = () => {
    if (!isFormComplete) return;
    calculateMutation.mutate();
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(100).duration(400)
          }
        >
          <ThemedText type="h2" style={styles.title}>
            Set Your Goals
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            We&apos;ll calculate personalized nutrition targets based on your
            profile
          </ThemedText>
        </Animated.View>

        {/* Physical Profile */}
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(200).duration(400)
          }
        >
          <Card elevation={1} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="user" size={20} color={theme.success} />
              <ThemedText type="h4">Physical Profile</ThemedText>
            </View>

            <View style={styles.inputGrid}>
              <NumberInput
                label="Age"
                value={age}
                onChange={setAge}
                unit="years"
                placeholder="25"
              />
              <NumberInput
                label="Weight"
                value={weight}
                onChange={setWeight}
                unit="kg"
                placeholder="70"
              />
              <NumberInput
                label="Height"
                value={height}
                onChange={setHeight}
                unit="cm"
                placeholder="170"
              />
            </View>

            <ThemedText type="body" style={styles.fieldLabel}>
              Gender
            </ThemedText>
            <View style={styles.chipRow}>
              {GENDER_OPTIONS.map((option) => (
                <SelectableChip
                  key={option.value}
                  label={option.label}
                  selected={gender === option.value}
                  onPress={() => setGender(option.value)}
                />
              ))}
            </View>
          </Card>
        </Animated.View>

        {/* Activity Level */}
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(300).duration(400)
          }
        >
          <Card elevation={1} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="activity" size={20} color={theme.proteinAccent} />
              <ThemedText type="h4">Activity Level</ThemedText>
            </View>

            <View style={styles.chipColumn}>
              {ACTIVITY_OPTIONS.map((option) => (
                <SelectableChip
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  selected={activityLevel === option.value}
                  onPress={() => setActivityLevel(option.value)}
                />
              ))}
            </View>
          </Card>
        </Animated.View>

        {/* Primary Goal */}
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(400).duration(400)
          }
        >
          <Card elevation={1} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="target" size={20} color={theme.calorieAccent} />
              <ThemedText type="h4">Primary Goal</ThemedText>
            </View>

            <View style={styles.chipColumn}>
              {GOAL_OPTIONS.map((option) => (
                <SelectableChip
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  selected={primaryGoal === option.value}
                  onPress={() => setPrimaryGoal(option.value)}
                />
              ))}
            </View>
          </Card>
        </Animated.View>

        {/* Calculate Button */}
        {!calculatedGoals && (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInUp.delay(500).duration(400)
            }
          >
            <Button
              onPress={handleCalculate}
              disabled={!isFormComplete || calculateMutation.isPending}
              accessibilityLabel="Calculate my goals"
              style={[
                styles.calculateButton,
                { backgroundColor: theme.success },
              ]}
            >
              {calculateMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                "Calculate My Goals"
              )}
            </Button>
          </Animated.View>
        )}

        {/* Calculated Results */}
        {calculatedGoals && (
          <Animated.View
            entering={reducedMotion ? undefined : FadeInUp.duration(400)}
          >
            <Card
              elevation={2}
              style={[
                styles.resultsCard,
                { borderColor: theme.success, borderWidth: 2 },
              ]}
            >
              <View style={styles.resultsHeader}>
                <Feather name="check-circle" size={24} color={theme.success} />
                <ThemedText type="h4">Your Daily Targets</ThemedText>
              </View>

              <ThemedText
                type="small"
                style={[styles.resultsSubtitle, { color: theme.textSecondary }]}
              >
                Adjust these values if needed
              </ThemedText>

              <View style={styles.goalsGrid}>
                <View style={styles.goalItem}>
                  <TextInput
                    style={[
                      styles.goalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.calorieAccent,
                      },
                    ]}
                    value={manualCalories}
                    onChangeText={setManualCalories}
                    keyboardType="numeric"
                    accessibilityLabel="Daily calorie target"
                  />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Calories
                  </ThemedText>
                </View>

                <View style={styles.goalItem}>
                  <TextInput
                    style={[
                      styles.goalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.proteinAccent,
                      },
                    ]}
                    value={manualProtein}
                    onChangeText={setManualProtein}
                    keyboardType="numeric"
                    accessibilityLabel="Daily protein target"
                  />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Protein (g)
                  </ThemedText>
                </View>

                <View style={styles.goalItem}>
                  <TextInput
                    style={[
                      styles.goalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.carbsAccent,
                      },
                    ]}
                    value={manualCarbs}
                    onChangeText={setManualCarbs}
                    keyboardType="numeric"
                    accessibilityLabel="Daily carbs target"
                  />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Carbs (g)
                  </ThemedText>
                </View>

                <View style={styles.goalItem}>
                  <TextInput
                    style={[
                      styles.goalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.fatAccent,
                      },
                    ]}
                    value={manualFat}
                    onChangeText={setManualFat}
                    keyboardType="numeric"
                    accessibilityLabel="Daily fat target"
                  />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Fat (g)
                  </ThemedText>
                </View>
              </View>

              <Button
                onPress={handleSave}
                disabled={saveMutation.isPending}
                accessibilityLabel="Save my goals"
                style={[styles.saveButton, { backgroundColor: theme.success }]}
              >
                {saveMutation.isPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  "Save My Goals"
                )}
              </Button>
            </Card>
          </Animated.View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    marginBottom: Spacing["2xl"],
  },
  section: {
    padding: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  inputGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  numberInputContainer: {
    flex: 1,
    minWidth: 80,
  },
  inputLabel: {
    marginBottom: Spacing.xs,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  numberInput: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    fontSize: 16,
    fontWeight: "600",
  },
  fieldLabel: {
    marginBottom: Spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  chipColumn: {
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
  },
  chipLabel: {
    fontWeight: "600",
  },
  calculateButton: {
    marginVertical: Spacing.lg,
  },
  resultsCard: {
    padding: Spacing["2xl"],
    marginTop: Spacing.lg,
  },
  resultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  resultsSubtitle: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  goalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  goalItem: {
    width: "48%",
    alignItems: "center",
  },
  goalInput: {
    width: "100%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  saveButton: {
    marginTop: Spacing.md,
  },
});
