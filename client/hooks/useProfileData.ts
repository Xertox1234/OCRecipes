import { useState, useRef, useEffect, useCallback } from "react";
import { AccessibilityInfo, Linking, Platform, ScrollView } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  useThemePreference,
  type ThemePreference,
} from "@/context/ThemeContext";
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

type ProfileScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, "Profile">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList, "ProfileTab">,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

interface DailySummary {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
}

interface FeaturedRecipe {
  id: number;
  title: string;
  imageUrl: string | null;
  dietTags: string[];
}

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function useProfileData() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { user, logout, checkAuth } = useAuthContext();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { preference: themePreference, setPreference: setThemePreference } =
    useThemePreference();
  const { isPremium } = usePremiumContext();

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const settingsYRef = useRef(0);

  const { data: todaySummary, isLoading: summaryLoading } =
    useQuery<DailySummary>({
      queryKey: ["/api/daily-summary"],
      enabled: !!user,
    });

  const { data: featuredRecipes } = useQuery<FeaturedRecipe[]>({
    queryKey: ["/api/recipes/featured"],
    enabled: !!user,
  });

  const { data: verificationData } = useQuery<{
    count: number;
    frontLabelCount: number;
    compositeScore: number;
    streak: number;
  }>({
    queryKey: ["/api/verification/user-count"],
    enabled: !!user,
  });

  const isInitialLoading = summaryLoading;
  const hasAnnouncedProfileRef = useRef(false);
  useEffect(() => {
    if (!isInitialLoading && user && !hasAnnouncedProfileRef.current) {
      hasAnnouncedProfileRef.current = true;
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          `Profile loaded for ${user.displayName || user.username}`,
        );
      }
    }
  }, [isInitialLoading, user]);

  const handleLogout = useCallback(async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
  }, [haptics, logout]);

  const handleThemeToggle = useCallback(async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    const nextPreference: ThemePreference =
      themePreference === "system"
        ? "light"
        : themePreference === "light"
          ? "dark"
          : "system";
    await setThemePreference(nextPreference);
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        `Appearance changed to ${THEME_LABELS[nextPreference]}`,
      );
    }
  }, [haptics, themePreference, setThemePreference]);

  const handleAvatarPress = useCallback(async () => {
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

      const compressed = await compressImage(result.assets[0].uri, {
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.8,
        targetSizeKB: 500,
      });

      try {
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
          let errorMessage = "Failed to upload avatar";
          try {
            const errorData = JSON.parse(uploadResult.body || "{}");
            if (errorData.error) errorMessage = errorData.error;
          } catch {
            // Malformed response body — use default message
          }
          throw new Error(errorMessage);
        }

        await checkAuth();
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      } finally {
        await cleanupImage(compressed.uri);
      }
    } catch (error) {
      console.error("Avatar upload error:", error);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [haptics, checkAuth]);

  const handleEditProfile = useCallback(() => {
    navigation.navigate("EditDietaryProfile");
  }, [navigation]);

  const handleGearPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    scrollRef.current?.scrollTo({
      y: settingsYRef.current,
      animated: true,
    });
  }, [haptics]);

  const handleRecipePress = useCallback(
    (recipeId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("FeaturedRecipeDetail", { recipeId });
    },
    [haptics, navigation],
  );

  const handleSubscription = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    if (isPremium) {
      if (Platform.OS === "ios") {
        Linking.openURL("https://apps.apple.com/account/subscriptions");
      } else {
        Linking.openURL("https://play.google.com/store/account/subscriptions");
      }
    } else {
      setShowUpgradeModal(true);
    }
  }, [haptics, isPremium]);

  const handleLockedPress = useCallback(() => {
    haptics.notification(Haptics.NotificationFeedbackType.Warning);
    setShowUpgradeModal(true);
  }, [haptics]);

  const handleWeightTracking = useCallback(() => {
    navigation.navigate("WeightTracking");
  }, [navigation]);

  const handleHealthKit = useCallback(() => {
    navigation.navigate("HealthKitSettings");
  }, [navigation]);

  const handleDietaryProfile = useCallback(() => {
    navigation.navigate("EditDietaryProfile");
  }, [navigation]);

  const handleGLP1Companion = useCallback(() => {
    navigation.navigate("GLP1Companion");
  }, [navigation]);

  const handleNutritionGoals = useCallback(() => {
    navigation.navigate("GoalSetup");
  }, [navigation]);

  const handleLibrary = useCallback(() => {
    navigation.navigate("SavedItems");
  }, [navigation]);

  const handleScanHistory = useCallback(() => {
    navigation.navigate("ScanHistory");
  }, [navigation]);

  const handleCloseUpgradeModal = useCallback(() => {
    setShowUpgradeModal(false);
  }, []);

  const handleSettingsLayout = useCallback((y: number) => {
    settingsYRef.current = y;
  }, []);

  return {
    theme,
    reducedMotion,
    user,
    themePreference,
    showUpgradeModal,
    isUploadingAvatar,
    scrollRef,
    todaySummary,
    featuredRecipes,
    verificationData,
    isInitialLoading,
    handleLogout,
    handleThemeToggle,
    handleAvatarPress,
    handleEditProfile,
    handleGearPress,
    handleRecipePress,
    handleSubscription,
    handleLockedPress,
    handleWeightTracking,
    handleHealthKit,
    handleDietaryProfile,
    handleGLP1Companion,
    handleNutritionGoals,
    handleLibrary,
    handleScanHistory,
    handleCloseUpgradeModal,
    handleSettingsLayout,
  };
}

export type { DailySummary, FeaturedRecipe };
