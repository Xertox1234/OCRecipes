import React, { useRef, useState } from "react";
import { StyleSheet, View, ScrollView } from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { SelectableTile } from "@/components/SelectableTile";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useMeasurementUnit } from "@/hooks/useMeasurementUnit";
import { apiRequest } from "@/lib/query-client";
import { parseDecimalInput } from "@/lib/number-input";
import { goalFieldError, type GoalField } from "./GoalSetupScreen-utils";
import {
  weightToKg,
  heightToCm,
  weightUnitLabel,
  heightUnitLabel,
} from "@shared/lib/units";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type {
  Gender,
  ActivityLevel,
  PrimaryGoal,
} from "@shared/types/user-goals";

type GoalSetupScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "GoalSetup"
>;

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
  shape,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** `tile` in a wrapping row; `row` when the column stretches it full width. */
  shape: "tile" | "row";
}) {
  const { theme } = useTheme();

  return (
    <SelectableTile
      shape={shape}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      accessibilityRole="radio"
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? withOpacity(theme.link, 0.12)
            : theme.backgroundSecondary,
          borderColor: selected ? theme.link : "transparent",
        },
      ]}
    >
      <ThemedText type="body" style={[styles.chipLabel, { color: theme.text }]}>
        {label}
      </ThemedText>
      {description && (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {description}
        </ThemedText>
      )}
    </SelectableTile>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  unit,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error: string | null;
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
        <FocusTextInput
          style={[
            styles.numberInput,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          keyboardType="numeric"
          placeholder={placeholder}
          placeholderTextColor={withOpacity(theme.textSecondary, 0.6)}
          accessibilityLabel={label}
        />
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          {unit}
        </ThemedText>
      </View>
      <InlineError message={error} style={styles.fieldError} />
    </View>
  );
}

export default function GoalSetupScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<GoalSetupScreenNavigationProp>();
  const queryClient = useQueryClient();
  const { updateUser } = useAuthContext();
  const canSetMacros = usePremiumFeature("macroGoals");
  const unit = useMeasurementUnit();

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

  const scrollViewRef = useRef<ScrollView>(null);

  // Number messages show on leaving a field or on Calculate/Save, never per
  // keystroke. Empty fields stay with the "Still needed" line.
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<GoalField, string>>
  >({});
  const fieldValues: Record<GoalField, string> = {
    age,
    weight,
    height,
    calories: manualCalories,
    protein: manualProtein,
    carbs: manualCarbs,
    fat: manualFat,
  };

  /** Show (or clear) these fields' messages; one error buzz when any refuses. */
  const checkFields = (fields: GoalField[]): boolean => {
    const found: Partial<Record<GoalField, string>> = {};
    for (const field of fields) {
      const message = goalFieldError(field, fieldValues[field], unit);
      if (message) found[field] = message;
    }
    const ok = Object.keys(found).length === 0;
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) delete next[field];
      return { ...next, ...found };
    });
    if (!ok) haptics.notification(Haptics.NotificationFeedbackType.Error);
    return ok;
  };

  /** Hide a field's message while it is retyped; it is checked again on blur. */
  const changeField =
    (field: GoalField, setValue: (value: string) => void) =>
    (value: string) => {
      setValue(value);
      if (fieldErrors[field]) {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    };

  /** A value the field check accepted, as the number it reads as. */
  const numberOf = (text: string) => parseDecimalInput(text) ?? NaN;

  const isFormComplete =
    age && weight && height && gender && activityLevel && primaryGoal;
  const missingFields = [
    !age && "age",
    !weight && "weight",
    !height && "height",
    !gender && "gender",
    !activityLevel && "activity level",
    !primaryGoal && "primary goal",
  ].filter((f): f is string => typeof f === "string");

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/goals/calculate", {
        age: numberOf(age),
        // Inputs are in the user's preferred unit; the API expects kg/cm.
        weight: weightToKg(numberOf(weight), unit),
        height: heightToCm(numberOf(height), unit),
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
      // The results render below the fold of a long form — bring them into
      // view (deferred one frame so they have laid out). QA #70.
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollToEnd({ animated: !reducedMotion });
      });
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      // Scroll to bottom so the InlineError below the button is visible.
      // Deferred one frame so the error layout has committed before measuring.
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollToEnd({ animated: !reducedMotion });
      });
    },
    // `calculateMutation.isError` already drives a visible InlineError below
    // the button (see its render below).
    meta: { silentError: true },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PUT", "/api/goals", {
        dailyCalorieGoal: numberOf(manualCalories),
        dailyProteinGoal: numberOf(manualProtein),
        dailyCarbsGoal: numberOf(manualCarbs),
        dailyFatGoal: numberOf(manualFat),
        // Inputs are in the user's preferred unit; the API expects kg/cm.
        weight: weightToKg(numberOf(weight), unit),
        height: heightToCm(numberOf(height), unit),
        age: numberOf(age),
        gender,
      });
      return response.json();
    },
    onSuccess: async () => {
      // Update local user state
      await updateUser({
        dailyCalorieGoal: numberOf(manualCalories),
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] });
      // After the awaited updateUser, so a failed local update never
      // celebrates. The toast survives the goBack and fires its own haptic.
      toast.success("Goals saved");
      navigation.goBack();
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    },
    // `saveMutation.isError` already drives a visible InlineError (see its
    // render below).
    meta: { silentError: true },
  });

  const handleCalculate = () => {
    if (!isFormComplete) return;
    if (!checkFields(["age", "weight", "height"])) return;
    calculateMutation.mutate();
  };

  const handleSave = () => {
    const allFields: GoalField[] = [
      "age",
      "weight",
      "height",
      "calories",
      "protein",
      "carbs",
      "fat",
    ];
    if (!checkFields(allFields)) return;
    saveMutation.mutate();
  };

  return (
    <ThemedView style={styles.container} accessibilityViewIsModal>
      <ScreenScrollView
        ref={scrollViewRef}
        headerInsetExtra={Spacing.xl}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
        // The numeric pad has no Done key — let a drag dismiss it.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
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
              <Feather name="user" size={20} color={theme.link} />
              <ThemedText type="h4">Physical Profile</ThemedText>
            </View>

            <View style={styles.inputGrid}>
              <NumberInput
                label="Age"
                value={age}
                onChange={changeField("age", setAge)}
                onBlur={() => checkFields(["age"])}
                error={fieldErrors.age ?? null}
                unit="years"
                placeholder="e.g. 25"
              />
              <NumberInput
                label="Weight"
                value={weight}
                onChange={changeField("weight", setWeight)}
                onBlur={() => checkFields(["weight"])}
                error={fieldErrors.weight ?? null}
                unit={weightUnitLabel(unit)}
                placeholder={unit === "imperial" ? "e.g. 154" : "e.g. 70"}
              />
              <NumberInput
                label="Height"
                value={height}
                onChange={changeField("height", setHeight)}
                onBlur={() => checkFields(["height"])}
                error={fieldErrors.height ?? null}
                unit={heightUnitLabel(unit)}
                placeholder={unit === "imperial" ? "e.g. 67" : "e.g. 170"}
              />
            </View>

            <ThemedText type="body" style={styles.fieldLabel}>
              Gender
            </ThemedText>
            <View
              style={styles.chipRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Gender"
            >
              {GENDER_OPTIONS.map((option) => (
                <SelectableChip
                  key={option.value}
                  label={option.label}
                  selected={gender === option.value}
                  shape="tile"
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

            <View
              style={styles.chipColumn}
              accessibilityRole="radiogroup"
              accessibilityLabel="Activity level"
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <SelectableChip
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  selected={activityLevel === option.value}
                  shape="row"
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

            <View
              style={styles.chipColumn}
              accessibilityRole="radiogroup"
              accessibilityLabel="Goal"
            >
              {GOAL_OPTIONS.map((option) => (
                <SelectableChip
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  selected={primaryGoal === option.value}
                  shape="row"
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
              disabled={!isFormComplete}
              loading={calculateMutation.isPending}
              accessibilityLabel="Calculate my goals"
              style={[
                styles.calculateButton,
                { backgroundColor: theme.accentSolid },
              ]}
            >
              Calculate My Goals
            </Button>
            {/* Always rendered: removing the line when the form completes
                shortened the page and, at the bottom of the scroll, moved
                the button out from under the finger. */}
            <ThemedText
              type="small"
              style={[styles.calculateHint, { color: theme.textSecondary }]}
            >
              {missingFields.length > 0
                ? `Still needed: ${missingFields.join(", ")}`
                : "Ready to calculate"}
            </ThemedText>
            <InlineError
              message={
                calculateMutation.isError
                  ? "Failed to calculate goals. Please check your inputs."
                  : null
              }
              style={{ marginTop: Spacing.sm }}
            />
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
                { borderColor: theme.link, borderWidth: 2 },
              ]}
            >
              <View style={styles.resultsHeader}>
                <Feather name="check-circle" size={24} color={theme.link} />
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
                  <FocusTextInput
                    style={[
                      styles.goalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.calorieAccent,
                      },
                    ]}
                    value={manualCalories}
                    onChangeText={changeField("calories", setManualCalories)}
                    onBlur={() => checkFields(["calories"])}
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

                <View
                  style={[styles.goalItem, !canSetMacros && { opacity: 0.6 }]}
                >
                  <View>
                    <FocusTextInput
                      style={[
                        styles.goalInput,
                        {
                          backgroundColor: theme.backgroundSecondary,
                          color: theme.proteinAccent,
                        },
                      ]}
                      value={manualProtein}
                      onChangeText={changeField("protein", setManualProtein)}
                      onBlur={() => checkFields(["protein"])}
                      keyboardType="numeric"
                      editable={canSetMacros}
                      accessibilityLabel={
                        canSetMacros
                          ? "Daily protein target"
                          : "Daily protein target (Premium required)"
                      }
                    />
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Protein (g)
                  </ThemedText>
                </View>

                <View
                  style={[styles.goalItem, !canSetMacros && { opacity: 0.6 }]}
                >
                  <View>
                    <FocusTextInput
                      style={[
                        styles.goalInput,
                        {
                          backgroundColor: theme.backgroundSecondary,
                          color: theme.carbsAccent,
                        },
                      ]}
                      value={manualCarbs}
                      onChangeText={changeField("carbs", setManualCarbs)}
                      onBlur={() => checkFields(["carbs"])}
                      keyboardType="numeric"
                      editable={canSetMacros}
                      accessibilityLabel={
                        canSetMacros
                          ? "Daily carbs target"
                          : "Daily carbs target (Premium required)"
                      }
                    />
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Carbs (g)
                  </ThemedText>
                </View>

                <View
                  style={[styles.goalItem, !canSetMacros && { opacity: 0.6 }]}
                >
                  <View>
                    <FocusTextInput
                      style={[
                        styles.goalInput,
                        {
                          backgroundColor: theme.backgroundSecondary,
                          color: theme.fatAccent,
                        },
                      ]}
                      value={manualFat}
                      onChangeText={changeField("fat", setManualFat)}
                      onBlur={() => checkFields(["fat"])}
                      keyboardType="numeric"
                      editable={canSetMacros}
                      accessibilityLabel={
                        canSetMacros
                          ? "Daily fat target"
                          : "Daily fat target (Premium required)"
                      }
                    />
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Fat (g)
                  </ThemedText>
                </View>
              </View>

              {(["calories", "protein", "carbs", "fat"] as const).map(
                (field) => (
                  <InlineError
                    key={field}
                    message={fieldErrors[field] ?? null}
                    style={styles.goalError}
                  />
                ),
              )}

              {!canSetMacros && (
                <View style={styles.premiumNote}>
                  <Feather
                    name="lock"
                    size={12}
                    color={theme.textSecondary}
                    accessible={false}
                  />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Editing protein, carb and fat targets requires Premium.
                  </ThemedText>
                </View>
              )}

              <Button
                onPress={handleSave}
                loading={saveMutation.isPending}
                accessibilityLabel="Save my goals"
                style={[
                  styles.saveButton,
                  { backgroundColor: theme.accentSolid },
                ]}
              >
                Save My Goals
              </Button>
              <InlineError
                message={
                  saveMutation.isError
                    ? "Failed to save goals. Please try again."
                    : null
                }
                style={{ marginTop: Spacing.sm }}
              />
            </Card>
          </Animated.View>
        )}
      </ScreenScrollView>
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
    // Wide enough that the field keeps room for 3 digits beside its unit
    // label ("years"); narrower and a 2-digit age clipped to "2!" (QA #68).
    minWidth: 130,
  },
  inputLabel: {
    marginBottom: Spacing.xs,
  },
  fieldError: {
    marginTop: Spacing.xs,
  },
  goalError: {
    marginBottom: Spacing.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  numberInput: {
    flex: 1,
    minWidth: 56,
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
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  calculateHint: {
    textAlign: "center",
    marginBottom: Spacing.lg,
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
    // 48% + gap overflowed 100% and collapsed the grid to one column (QA #70).
    flexBasis: "45%",
    flexGrow: 1,
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
  premiumNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  saveButton: {
    marginTop: Spacing.md,
  },
});
