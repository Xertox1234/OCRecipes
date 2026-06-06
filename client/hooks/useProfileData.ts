import { useState, useRef, useCallback, useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import {
  useThemePreference,
  type ThemePreference,
} from "@/context/ThemeContext";
import { useProfileWidgets } from "@/hooks/useProfileWidgets";
import { useLibraryCounts } from "@/hooks/useLibraryCounts";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

export function useProfileData() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { user } = useAuthContext();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { preference: themePreference, setPreference: setThemePreference } =
    useThemePreference();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { isUploading: isUploadingAvatar, upload: handleAvatarPress } =
    useAvatarUpload();

  // New aggregated hooks
  const {
    data: widgetData,
    isLoading: widgetsLoading,
    isError: widgetsError,
    refetch: refetchWidgets,
  } = useProfileWidgets();
  const {
    data: libraryCounts,
    isError: libraryCountsError,
    refetch: refetchLibraryCounts,
  } = useLibraryCounts();

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
  // Full-screen error gate: only the primary widget/library queries block the
  // whole screen. The verification query feeds a single badge (compositeScore)
  // and falls back to 0, so it is allowed to fail silently rather than hide the
  // entire profile.
  const isError = widgetsError || libraryCountsError;
  const refetch = useCallback(() => {
    void refetchWidgets();
    void refetchLibraryCounts();
  }, [refetchWidgets, refetchLibraryCounts]);
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
    navigation.navigate("FastingModal");
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
    isError,
    refetch,
    handleThemeToggle,
    handleAvatarPress,

    handleGearPress,
    handleLockedPress,
    handleCaloriePress,
    handleFastingPress,
    handleDietaryProfile,
    handleCloseUpgradeModal,
  };
}
