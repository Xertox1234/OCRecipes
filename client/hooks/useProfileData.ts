import { useState, useRef, useCallback, useEffect } from "react";
import { AccessibilityInfo, Platform, ScrollView } from "react-native";
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
import { useProfileWidgets } from "@/hooks/useProfileWidgets";
import { useLibraryCounts } from "@/hooks/useLibraryCounts";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

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

  // New aggregated hooks
  const { data: widgetData, isLoading: widgetsLoading } = useProfileWidgets();
  const { data: libraryCounts, isLoading: countsLoading } = useLibraryCounts();

  // Verification data (still separate — used for badge)
  const { data: verificationData } = useQuery<{
    count: number;
    frontLabelCount: number;
    compositeScore: number;
    streak: number;
  }>({
    queryKey: ["/api/verification/user-count"],
    enabled: !!user,
  });

  const isInitialLoading = widgetsLoading;
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

  const handleThemeToggle = useCallback(async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    const nextPreference: ThemePreference =
      themePreference === "system"
        ? "light"
        : themePreference === "light"
          ? "dark"
          : "system";
    await setThemePreference(nextPreference);
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

  const handleGearPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Settings");
  }, [haptics, navigation]);

  const handleLockedPress = useCallback(() => {
    haptics.notification(Haptics.NotificationFeedbackType.Warning);
    setShowUpgradeModal(true);
  }, [haptics]);

  const handleCaloriePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("DailyNutritionDetail");
  }, [haptics, navigation]);

  const handleFastingPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("HomeTab", { screen: "Fasting" });
  }, [haptics, navigation]);

  const handleWeightPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("WeightTracking");
  }, [haptics, navigation]);

  const handleDietaryProfile = useCallback(() => {
    navigation.navigate("EditDietaryProfile");
  }, [navigation]);

  const handleCloseUpgradeModal = useCallback(() => {
    setShowUpgradeModal(false);
  }, []);

  return {
    theme,
    reducedMotion,
    user,
    themePreference,
    showUpgradeModal,
    isUploadingAvatar,
    widgetData,
    libraryCounts,
    verificationData,
    isInitialLoading,
    handleThemeToggle,
    handleAvatarPress,

    handleGearPress,
    handleLockedPress,
    handleCaloriePress,
    handleFastingPress,
    handleWeightPress,
    handleDietaryProfile,
    handleCloseUpgradeModal,
  };
}
