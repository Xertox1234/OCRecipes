import React, { ComponentProps, useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TextInput,
  ActivityIndicator,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
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
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { useSavedItemCount } from "@/hooks/useSavedItems";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";

import {
  DIET_LABELS,
  GOAL_LABELS,
  ACTIVITY_LABELS,
  SKILL_LABELS,
  TIME_LABELS,
  CONDITION_LABELS,
} from "@/constants/dietary-options";
import {
  useThemePreference,
  type ThemePreference,
} from "@/context/ThemeContext";

type ProfileScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, "Profile">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList, "ProfileTab">,
    NativeStackNavigationProp<RootStackParamList>
  >
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
              ? withOpacity(theme.error, 0.12)
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

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { user, logout, updateUser, checkAuth } = useAuthContext();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { preference: themePreference, setPreference: setThemePreference } =
    useThemePreference();

  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [nameSelection, setNameSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  const nameInputRef = useRef<TextInput>(null);

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

  const { data: savedItemCount } = useSavedItemCount();

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

  const handleThemeToggle = async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    const nextPreference: ThemePreference =
      themePreference === "system"
        ? "light"
        : themePreference === "light"
          ? "dark"
          : "system";
    await setThemePreference(nextPreference);
  };

  const handleAvatarPress = async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const token = await tokenStorage.get();
      if (!token) {
        throw new Error("Not authenticated");
      }

      // Compress the image
      const compressed = await compressImage(result.assets[0].uri, {
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.8,
        targetSizeKB: 500,
      });

      try {
        // Upload using expo-file-system (same as photo analysis)
        const uploadResult = await uploadAsync(
          `${getApiUrl()}/api/user/avatar`,
          compressed.uri,
          {
            httpMethod: "POST",
            uploadType: FileSystemUploadType.MULTIPART,
            fieldName: "avatar",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (uploadResult.status !== 200) {
          const errorData = JSON.parse(uploadResult.body || "{}");
          throw new Error(errorData.error || "Failed to upload avatar");
        }

        // Refresh user state to get new avatar
        await checkAuth();

        haptics.notification(Haptics.NotificationFeedbackType.Success);
      } finally {
        // Clean up compressed image
        await cleanupImage(compressed.uri);
      }
    } catch (error) {
      console.error("Avatar upload error:", error);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploadingAvatar(false);
    }
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
        <Pressable
          onPress={handleAvatarPress}
          accessibilityLabel="Tap to change profile picture"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.avatar,
            {
              backgroundColor: withOpacity(theme.success, 0.12),
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {isUploadingAvatar ? (
            <ActivityIndicator size="large" color={theme.success} />
          ) : user?.avatarUrl ? (
            <Image
              source={{ uri: user.avatarUrl }}
              style={styles.avatarImage}
            />
          ) : (
            <Feather name="user" size={40} color={theme.success} />
          )}
          <View
            style={[
              styles.avatarEditBadge,
              { backgroundColor: theme.success, borderColor: theme.buttonText },
            ]}
          >
            <Feather name="camera" size={14} color={theme.buttonText} />
          </View>
        </Pressable>

        {isEditing ? (
          <>
            <TextInput
              ref={nameInputRef}
              style={[
                styles.nameInput,
                {
                  backgroundColor: theme.backgroundDefault,
                  color: theme.text,
                  borderColor: theme.success,
                },
              ]}
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                // Clear controlled selection after first input
                if (nameSelection) {
                  setNameSelection(undefined);
                }
              }}
              selection={nameSelection}
              onSelectionChange={() => {
                // Clear controlled selection after user interacts with cursor
                // This allows normal cursor behavior after initial select-all
                if (nameSelection) {
                  setNameSelection(undefined);
                }
              }}
              placeholder="Display Name"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Display name"
              autoFocus
            />
            <View style={styles.inlineEditButtons}>
              <Pressable
                onPress={handleSave}
                disabled={isSaving}
                accessibilityLabel={
                  isSaving ? "Saving changes" : "Save changes"
                }
                accessibilityRole="button"
                style={[
                  styles.inlineSaveButton,
                  { backgroundColor: theme.success },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color={theme.buttonText} size="small" />
                ) : (
                  <>
                    <Feather name="check" size={16} color={theme.buttonText} />
                    <ThemedText
                      type="small"
                      style={{ color: theme.buttonText, fontWeight: "600" }}
                    >
                      Save
                    </ThemedText>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsEditing(false);
                  setDisplayName(user?.displayName || "");
                }}
                accessibilityLabel="Cancel editing"
                accessibilityRole="button"
                style={[
                  styles.inlineCancelButton,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Feather name="x" size={16} color={theme.text} />
                <ThemedText type="small">Cancel</ThemedText>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable
            onPress={() => {
              const currentName = user?.displayName || user?.username || "";
              setDisplayName(currentName);
              // Select all text so typing replaces it
              setNameSelection({ start: 0, end: currentName.length });
              setIsEditing(true);
              haptics.impact(Haptics.ImpactFeedbackStyle.Light);
            }}
            accessibilityLabel="Tap to edit display name"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.nameRow,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <ThemedText type="h3" style={styles.userName}>
              {user?.displayName || user?.username || "User"}
            </ThemedText>
            <Feather name="edit-2" size={14} color={theme.textSecondary} />
          </Pressable>
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
                backgroundColor: withOpacity(theme.success, 0.12),
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
                  style={{ color: theme.buttonText, fontWeight: "600" }}
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
        <View style={styles.sectionHeaderRow}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Dietary Preferences
          </ThemedText>
          <Pressable
            onPress={() => navigation.navigate("EditDietaryProfile")}
            accessibilityLabel="Edit dietary preferences"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.setupGoalsButton,
              {
                backgroundColor: withOpacity(theme.success, 0.12),
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="edit-2" size={14} color={theme.success} />
            <ThemedText type="small" style={{ color: theme.success }}>
              Edit
            </ThemedText>
          </Pressable>
        </View>
        <Card elevation={1} style={styles.dietaryCard}>
          {dietaryProfile ? (
            <>
              {dietaryProfile.allergies &&
              dietaryProfile.allergies.length > 0 ? (
                <View style={styles.dietaryRow}>
                  <View
                    style={[
                      styles.dietaryIcon,
                      { backgroundColor: withOpacity(theme.error, 0.12) },
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
                                  ? withOpacity(theme.error, 0.12)
                                  : a.severity === "moderate"
                                    ? withOpacity(theme.warning, 0.12)
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
                      { backgroundColor: withOpacity(theme.info, 0.12) },
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
                      { backgroundColor: withOpacity(theme.success, 0.12) },
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
                      {
                        backgroundColor: withOpacity(theme.calorieAccent, 0.12),
                      },
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
                      {
                        backgroundColor: withOpacity(theme.proteinAccent, 0.12),
                      },
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
                      { backgroundColor: withOpacity(theme.carbsAccent, 0.12) },
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
                      { backgroundColor: withOpacity(theme.fatAccent, 0.12) },
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
          My Library
        </ThemedText>
        <Card
          elevation={1}
          onPress={() => navigation.navigate("SavedItems")}
          accessibilityLabel={`My Library, ${savedItemCount?.count ?? 0} saved items`}
          accessibilityHint="Tap to view your saved recipes and activities"
          style={styles.libraryCard}
        >
          <View style={styles.libraryContent}>
            <View
              style={[
                styles.libraryIcon,
                { backgroundColor: withOpacity(theme.link, 0.12) },
              ]}
            >
              <Feather name="bookmark" size={24} color={theme.link} />
            </View>
            <View style={styles.libraryInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Saved Items
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {savedItemCount?.count ?? 0} recipes & activities
              </ThemedText>
            </View>
            <Feather
              name="chevron-right"
              size={20}
              color={theme.textSecondary}
            />
          </View>
        </Card>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(600).duration(400)
        }
      >
        <ThemedText type="h4" style={styles.sectionTitle}>
          Account
        </ThemedText>
        <Card elevation={1} style={styles.settingsCard}>
          <SettingsItem
            icon="edit-2"
            label="Edit Profile"
            onPress={() => {
              const currentName = user?.displayName || user?.username || "";
              setDisplayName(currentName);
              setNameSelection({ start: 0, end: currentName.length });
              setIsEditing(true);
            }}
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <SettingsItem
            icon={
              themePreference === "dark"
                ? "moon"
                : themePreference === "light"
                  ? "sun"
                  : "smartphone"
            }
            label="Appearance"
            value={THEME_LABELS[themePreference]}
            onPress={handleThemeToggle}
            showChevron={false}
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <SettingsItem
            icon="log-out"
            label="Sign Out"
            onPress={handleLogout}
            showChevron={false}
            danger
          />
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
    position: "relative",
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
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
    marginBottom: Spacing.sm,
    minWidth: 200,
  },
  inlineEditButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  inlineSaveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  inlineCancelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
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
  libraryCard: {
    padding: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  libraryContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  libraryIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  libraryInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
});
