import React, { ComponentProps, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";

type ProfileScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "ProfileTab">,
  NativeStackNavigationProp<RootStackParamList>
>;

type FeatherIconName = ComponentProps<typeof Feather>["name"];

interface DietaryProfile {
  allergies?: { name: string; severity: string }[];
  healthConditions?: string[];
  dietType?: string | null;
  primaryGoal?: string | null;
  activityLevel?: string | null;
  cuisinePreferences?: string[];
  cookingSkillLevel?: string | null;
  cookingTimeAvailable?: string | null;
}

const DIET_LABELS: Record<string, string> = {
  omnivore: "Omnivore",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  keto: "Keto",
  paleo: "Paleo",
  mediterranean: "Mediterranean",
  halal: "Halal",
  kosher: "Kosher",
  low_fodmap: "Low FODMAP",
};

const GOAL_LABELS: Record<string, string> = {
  lose_weight: "Lose Weight",
  gain_muscle: "Build Muscle",
  maintain: "Maintain Weight",
  eat_healthier: "Eat Healthier",
  manage_condition: "Manage Health Condition",
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Sedentary",
  light: "Lightly Active",
  moderate: "Moderately Active",
  active: "Very Active",
  athlete: "Athlete",
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const TIME_LABELS: Record<string, string> = {
  quick: "Quick (< 15 min)",
  moderate: "Moderate (15-30 min)",
  extended: "Extended (30-60 min)",
  leisurely: "Leisurely (60+ min)",
};

const CONDITION_LABELS: Record<string, string> = {
  diabetes_type1: "Type 1 Diabetes",
  diabetes_type2: "Type 2 Diabetes",
  heart_disease: "Heart Disease",
  high_blood_pressure: "High Blood Pressure",
  high_cholesterol: "High Cholesterol",
  ibs: "IBS",
  celiac: "Celiac Disease",
  kidney_disease: "Kidney Disease",
  pcos: "PCOS",
  gerd: "GERD/Acid Reflux",
};

interface DailySummary {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
}

interface UserGoals {
  dailyCalorieGoal: number | null;
  dailyProteinGoal: number | null;
  dailyCarbsGoal: number | null;
  dailyFatGoal: number | null;
}

function SettingsItem({
  icon,
  label,
  value,
  onPress,
  showChevron = true,
  danger = false,
}: {
  icon: FeatherIconName;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  danger?: boolean;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityRole="button"
      accessibilityHint={showChevron ? "Tap to open" : undefined}
      style={({ pressed }) => [
        styles.settingsItem,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View
        style={[
          styles.settingsIcon,
          {
            backgroundColor: danger
              ? theme.error + "20"
              : theme.backgroundSecondary,
          },
        ]}
      >
        <Feather
          name={icon}
          size={20}
          color={danger ? theme.error : theme.text}
        />
      </View>
      <View style={styles.settingsContent}>
        <ThemedText type="body" style={[danger && { color: theme.error }]}>
          {label}
        </ThemedText>
        {value ? (
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {value}
          </ThemedText>
        ) : null}
      </View>
      {showChevron ? (
        <Feather name="chevron-right" size={20} color={theme.textSecondary} />
      ) : null}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { user, logout, updateUser } = useAuthContext();
  const navigation = useNavigation<ProfileScreenNavigationProp>();

  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [isSaving, setIsSaving] = useState(false);

  const { data: todaySummary } = useQuery<DailySummary>({
    queryKey: ["/api/daily-summary"],
    enabled: !!user,
  });

  const { data: userGoals } = useQuery<UserGoals>({
    queryKey: ["/api/goals"],
    enabled: !!user,
  });

  const {
    data: dietaryProfile,
    isLoading: dietaryLoading,
    error: dietaryError,
    refetch: refetchDietaryProfile,
  } = useQuery<DietaryProfile>({
    queryKey: ["/api/user/dietary-profile"],
    enabled: !!user,
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateUser({
        displayName: displayName.trim() || undefined,
      });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      setIsEditing(false);
    } catch {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
  };

  const calorieProgress = todaySummary
    ? Math.min(
        (todaySummary.totalCalories / (user?.dailyCalorieGoal || 2000)) * 100,
        100,
      )
    : 0;

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
    >
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(100).duration(400)
        }
        style={styles.profileHeader}
      >
        <View
          style={[styles.avatar, { backgroundColor: theme.success + "20" }]}
        >
          <Feather name="user" size={40} color={theme.success} />
        </View>

        {isEditing ? (
          <TextInput
            style={[
              styles.nameInput,
              {
                backgroundColor: theme.backgroundDefault,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Display Name"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Display name"
            autoFocus
          />
        ) : (
          <ThemedText type="h3" style={styles.userName}>
            {user?.displayName || user?.username || "User"}
          </ThemedText>
        )}

        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          @{user?.username}
        </ThemedText>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(200).duration(400)
        }
      >
        <Card elevation={1} style={styles.todayCard}>
          <View style={styles.todayHeader}>
            <ThemedText type="h4">Today&apos;s Progress</ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {todaySummary?.itemCount || 0} items logged
            </ThemedText>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.calorieInfo}>
              <ThemedText type="h2" style={{ color: theme.calorieAccent }}>
                {todaySummary?.totalCalories
                  ? Math.round(todaySummary.totalCalories)
                  : 0}
              </ThemedText>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>
                / {user?.dailyCalorieGoal || 2000} kcal
              </ThemedText>
            </View>

            <View
              style={[
                styles.progressBar,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${calorieProgress}%`,
                    backgroundColor: theme.calorieAccent,
                  },
                ]}
              />
            </View>
          </View>

          <View
            style={[styles.macrosSummary, { borderTopColor: theme.border }]}
          >
            <View style={styles.macroSummaryItem}>
              <ThemedText type="h4" style={{ color: theme.proteinAccent }}>
                {todaySummary?.totalProtein
                  ? Math.round(todaySummary.totalProtein)
                  : 0}
                g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Protein
              </ThemedText>
            </View>
            <View style={styles.macroSummaryItem}>
              <ThemedText type="h4" style={{ color: theme.carbsAccent }}>
                {todaySummary?.totalCarbs
                  ? Math.round(todaySummary.totalCarbs)
                  : 0}
                g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Carbs
              </ThemedText>
            </View>
            <View style={styles.macroSummaryItem}>
              <ThemedText type="h4" style={{ color: theme.fatAccent }}>
                {todaySummary?.totalFat ? Math.round(todaySummary.totalFat) : 0}
                g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Fat
              </ThemedText>
            </View>
          </View>
        </Card>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(300).duration(400)
        }
      >
        <View style={styles.sectionHeaderRow}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Nutrition Goals
          </ThemedText>
          <Pressable
            onPress={() => navigation.navigate("GoalSetup")}
            accessibilityLabel="Set up nutrition goals"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.setupGoalsButton,
              {
                backgroundColor: theme.success + "20",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="sliders" size={14} color={theme.success} />
            <ThemedText type="small" style={{ color: theme.success }}>
              {userGoals?.dailyProteinGoal ? "Edit" : "Set Up"}
            </ThemedText>
          </Pressable>
        </View>
        <Card elevation={1} style={styles.goalsCard}>
          {userGoals?.dailyProteinGoal ? (
            <>
              {/* Calorie Goal */}
              <View style={styles.macroGoalRow}>
                <View style={styles.macroGoalInfo}>
                  <ThemedText type="body">Calories</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {todaySummary ? Math.round(todaySummary.totalCalories) : 0}{" "}
                    /{" "}
                    {userGoals.dailyCalorieGoal ||
                      user?.dailyCalorieGoal ||
                      2000}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.macroProgressBar,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <View
                    style={[
                      styles.macroProgressFill,
                      {
                        width: `${Math.min(
                          ((todaySummary?.totalCalories || 0) /
                            (userGoals.dailyCalorieGoal ||
                              user?.dailyCalorieGoal ||
                              2000)) *
                            100,
                          100,
                        )}%`,
                        backgroundColor: theme.calorieAccent,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Protein Goal */}
              <View style={styles.macroGoalRow}>
                <View style={styles.macroGoalInfo}>
                  <ThemedText type="body">Protein</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {todaySummary ? Math.round(todaySummary.totalProtein) : 0}g
                    / {userGoals.dailyProteinGoal}g
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.macroProgressBar,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <View
                    style={[
                      styles.macroProgressFill,
                      {
                        width: `${Math.min(
                          ((todaySummary?.totalProtein || 0) /
                            userGoals.dailyProteinGoal) *
                            100,
                          100,
                        )}%`,
                        backgroundColor: theme.proteinAccent,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Carbs Goal */}
              <View style={styles.macroGoalRow}>
                <View style={styles.macroGoalInfo}>
                  <ThemedText type="body">Carbs</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {todaySummary ? Math.round(todaySummary.totalCarbs) : 0}g /{" "}
                    {userGoals.dailyCarbsGoal}g
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.macroProgressBar,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <View
                    style={[
                      styles.macroProgressFill,
                      {
                        width: `${Math.min(
                          ((todaySummary?.totalCarbs || 0) /
                            (userGoals.dailyCarbsGoal || 1)) *
                            100,
                          100,
                        )}%`,
                        backgroundColor: theme.carbsAccent,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Fat Goal */}
              <View style={[styles.macroGoalRow, { marginBottom: 0 }]}>
                <View style={styles.macroGoalInfo}>
                  <ThemedText type="body">Fat</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    {todaySummary ? Math.round(todaySummary.totalFat) : 0}g /{" "}
                    {userGoals.dailyFatGoal}g
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.macroProgressBar,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <View
                    style={[
                      styles.macroProgressFill,
                      {
                        width: `${Math.min(
                          ((todaySummary?.totalFat || 0) /
                            (userGoals.dailyFatGoal || 1)) *
                            100,
                          100,
                        )}%`,
                        backgroundColor: theme.fatAccent,
                      },
                    ]}
                  />
                </View>
              </View>
            </>
          ) : (
            <View style={styles.noGoalsContainer}>
              <Feather name="target" size={32} color={theme.textSecondary} />
              <ThemedText
                type="body"
                style={{
                  color: theme.textSecondary,
                  textAlign: "center",
                  marginTop: Spacing.md,
                }}
              >
                Set personalized nutrition goals based on your profile
              </ThemedText>
              <Pressable
                onPress={() => navigation.navigate("GoalSetup")}
                accessibilityLabel="Set up goals"
                accessibilityRole="button"
                style={[
                  styles.setGoalsButton,
                  { backgroundColor: theme.success },
                ]}
              >
                <ThemedText
                  type="body"
                  style={{ color: "#FFFFFF", fontWeight: "600" }}
                >
                  Set Up Goals
                </ThemedText>
              </Pressable>
            </View>
          )}
        </Card>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(400).duration(400)
        }
      >
        <ThemedText type="h4" style={styles.sectionTitle}>
          Dietary Preferences
        </ThemedText>
        <Card elevation={1} style={styles.dietaryCard}>
          {dietaryProfile ? (
            <>
              {dietaryProfile.allergies &&
              dietaryProfile.allergies.length > 0 ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.error + "20" },
                    ]}
                  >
                    <Feather
                      name="alert-triangle"
                      size={16}
                      color={theme.error}
                    />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Allergies
                    </ThemedText>
                    <View style={styles.chipRow}>
                      {dietaryProfile.allergies.map((a, i) => (
                        <View
                          key={i}
                          style={[
                            styles.chip,
                            {
                              backgroundColor:
                                a.severity === "severe"
                                  ? theme.error + "20"
                                  : a.severity === "moderate"
                                    ? theme.warning + "20"
                                    : theme.backgroundSecondary,
                            },
                          ]}
                        >
                          <ThemedText
                            type="small"
                            style={{
                              color:
                                a.severity === "severe"
                                  ? theme.error
                                  : a.severity === "moderate"
                                    ? theme.warning
                                    : theme.text,
                            }}
                          >
                            {a.name}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.healthConditions &&
              dietaryProfile.healthConditions.length > 0 ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.info + "20" },
                    ]}
                  >
                    <Feather name="heart" size={16} color={theme.info} />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Health Conditions
                    </ThemedText>
                    <ThemedText type="body">
                      {dietaryProfile.healthConditions
                        .map((c) => CONDITION_LABELS[c] || c)
                        .join(", ")}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.dietType ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.success + "20" },
                    ]}
                  >
                    <Feather name="target" size={16} color={theme.success} />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Diet Type
                    </ThemedText>
                    <ThemedText type="body">
                      {DIET_LABELS[dietaryProfile.dietType] ||
                        dietaryProfile.dietType}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.primaryGoal ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.calorieAccent + "20" },
                    ]}
                  >
                    <Feather
                      name="flag"
                      size={16}
                      color={theme.calorieAccent}
                    />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Goal
                    </ThemedText>
                    <ThemedText type="body">
                      {GOAL_LABELS[dietaryProfile.primaryGoal] ||
                        dietaryProfile.primaryGoal}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.activityLevel ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.proteinAccent + "20" },
                    ]}
                  >
                    <Feather
                      name="activity"
                      size={16}
                      color={theme.proteinAccent}
                    />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Activity Level
                    </ThemedText>
                    <ThemedText type="body">
                      {ACTIVITY_LABELS[dietaryProfile.activityLevel] ||
                        dietaryProfile.activityLevel}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.cuisinePreferences &&
              dietaryProfile.cuisinePreferences.length > 0 ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.carbsAccent + "20" },
                    ]}
                  >
                    <Feather name="globe" size={16} color={theme.carbsAccent} />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Cuisine Preferences
                    </ThemedText>
                    <ThemedText type="body">
                      {dietaryProfile.cuisinePreferences.join(", ")}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.cookingSkillLevel ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.fatAccent + "20" },
                    ]}
                  >
                    <Feather name="award" size={16} color={theme.fatAccent} />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Cooking Skill
                    </ThemedText>
                    <ThemedText type="body">
                      {SKILL_LABELS[dietaryProfile.cookingSkillLevel] ||
                        dietaryProfile.cookingSkillLevel}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {dietaryProfile.cookingTimeAvailable ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: theme.backgroundSecondary },
                    ]}
                  >
                    <Feather name="clock" size={16} color={theme.text} />
                  </View>
                  <View style={styles.dietaryContent}>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      Cooking Time
                    </ThemedText>
                    <ThemedText type="body">
                      {TIME_LABELS[dietaryProfile.cookingTimeAvailable] ||
                        dietaryProfile.cookingTimeAvailable}
                    </ThemedText>
                  </View>
                </View>
              ) : null}
            </>
          ) : dietaryLoading ? (
            <View style={styles.emptyDietary}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
              <ThemedText
                type="body"
                style={{
                  color: theme.textSecondary,
                  textAlign: "center",
                  marginTop: Spacing.sm,
                }}
              >
                Loading preferences...
              </ThemedText>
            </View>
          ) : dietaryError ? (
            <View style={styles.emptyDietary}>
              <Feather name="alert-circle" size={24} color={theme.error} />
              <ThemedText
                type="body"
                style={{
                  color: theme.textSecondary,
                  textAlign: "center",
                  marginTop: Spacing.sm,
                }}
              >
                Unable to load preferences
              </ThemedText>
              <Pressable
                onPress={() => refetchDietaryProfile()}
                accessibilityLabel="Retry loading dietary preferences"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.retryButton,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="refresh-cw" size={14} color={theme.link} />
                <ThemedText type="small" style={{ color: theme.link }}>
                  Retry
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyDietary}>
              <ThemedText
                type="body"
                style={{ color: theme.textSecondary, textAlign: "center" }}
              >
                No dietary preferences set
              </ThemedText>
            </View>
          )}
        </Card>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(500).duration(400)
        }
      >
        <ThemedText type="h4" style={styles.sectionTitle}>
          Account
        </ThemedText>
        <Card elevation={1} style={styles.settingsCard}>
          {isEditing ? (
            <View style={styles.editButtons}>
              <Button
                onPress={handleSave}
                disabled={isSaving}
                accessibilityLabel={
                  isSaving ? "Saving changes" : "Save Changes"
                }
                style={{ flex: 1, backgroundColor: theme.success }}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  "Save Changes"
                )}
              </Button>
              <Pressable
                onPress={() => setIsEditing(false)}
                accessibilityLabel="Cancel editing"
                accessibilityRole="button"
                style={[
                  styles.cancelButton,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <ThemedText type="body">Cancel</ThemedText>
              </Pressable>
            </View>
          ) : (
            <>
              <SettingsItem
                icon="edit-2"
                label="Edit Profile"
                onPress={() => setIsEditing(true)}
              />
              <View
                style={[styles.divider, { backgroundColor: theme.border }]}
              />
              <SettingsItem
                icon="log-out"
                label="Sign Out"
                onPress={handleLogout}
                showChevron={false}
                danger
              />
            </>
          )}
        </Card>
      </Animated.View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  profileHeader: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  userName: {
    marginBottom: Spacing.xs,
  },
  nameInput: {
    fontSize: 24,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    marginBottom: Spacing.xs,
    minWidth: 200,
  },
  todayCard: {
    padding: Spacing.xl,
    marginBottom: Spacing["2xl"],
  },
  todayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  progressContainer: {
    marginBottom: Spacing.lg,
  },
  calorieInfo: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  macrosSummary: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
  },
  macroSummaryItem: {
    alignItems: "center",
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  settingsCard: {
    padding: 0,
    marginBottom: Spacing["2xl"],
    overflow: "hidden",
  },
  settingsItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  settingsIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  settingsContent: {
    flex: 1,
  },
  divider: {
    height: 1,
    marginLeft: Spacing.lg + 40 + Spacing.md,
  },
  goalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
  },
  goalInput: {
    fontSize: 16,
    fontWeight: "600",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.xs,
    minWidth: 100,
    textAlign: "right",
  },
  editButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  cancelButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  dietaryCard: {
    padding: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  dietaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  dietaryIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  dietaryContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  emptyDietary: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  setupGoalsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  goalsCard: {
    padding: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  macroGoalRow: {
    marginBottom: Spacing.lg,
  },
  macroGoalInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  macroProgressBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  macroProgressFill: {
    height: "100%",
    borderRadius: 4,
  },
  noGoalsContainer: {
    alignItems: "center",
    padding: Spacing.xl,
  },
  setGoalsButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.full,
  },
});
