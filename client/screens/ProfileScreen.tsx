import React, { useRef } from "react";
import { StyleSheet, View, ScrollView } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { SkeletonBox } from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { MiniWidgetRow } from "@/components/profile/MiniWidgetRow";
import { LibraryGrid } from "@/components/profile/LibraryGrid";
import { InlineSettings } from "@/components/profile/InlineSettings";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useProfileData } from "@/hooks/useProfileData";
import { Spacing, FAB_CLEARANCE } from "@/constants/theme";

const STAGGER_DELAY = 80;

export default function ProfileScreen() {
  const {
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
  } = useProfileData();

  const weightUnlocked = usePremiumFeature("weightTrend");
  const tabBarHeight = useBottomTabBarHeight();
  const hasAnimated = useRef(false);

  // Gate entrance animations — play only on first mount
  const getEntering = (index: number) => {
    if (hasAnimated.current || reducedMotion) return undefined;
    return FadeInDown.delay(index * STAGGER_DELAY).duration(400);
  };

  // Mark animated after first render
  React.useEffect(() => {
    hasAnimated.current = true;
  }, []);

  if (!user) return null;

  if (isInitialLoading) {
    return <ProfileSkeleton theme={theme} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: tabBarHeight + FAB_CLEARANCE + Spacing.lg,
        }}
      >
        {/* 1. Profile Card */}
        <Animated.View entering={getEntering(0)}>
          <ProfileCard
            displayName={user.displayName || ""}
            username={user.username}
            avatarUrl={user.avatarUrl || null}
            compositeScore={verificationData?.compositeScore ?? 0}
            isUploadingAvatar={isUploadingAvatar}
            onAvatarPress={handleAvatarPress}
            onGearPress={handleGearPress}
          />
        </Animated.View>

        {/* 2. Mini Widget Row */}
        {widgetData && (
          <Animated.View entering={getEntering(1)} style={styles.widgetSection}>
            <MiniWidgetRow
              widgets={widgetData}
              weightUnlocked={weightUnlocked}
              onCaloriePress={handleCaloriePress}
              onFastingPress={handleFastingPress}
              onWeightPress={
                weightUnlocked ? handleWeightPress : handleLockedPress
              }
            />
          </Animated.View>
        )}

        {/* 3. Library Grid */}
        {libraryCounts && (
          <Animated.View
            entering={getEntering(2)}
            style={styles.librarySection}
          >
            <LibraryGrid
              counts={libraryCounts}
              onLockedPress={handleLockedPress}
            />
          </Animated.View>
        )}

        {/* 4. Inline Settings */}
        <Animated.View entering={getEntering(3)} style={styles.settingsSection}>
          <InlineSettings
            themePreference={themePreference}
            onThemeToggle={handleThemeToggle}
            onDietaryProfile={handleDietaryProfile}
          />
        </Animated.View>
      </ScrollView>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={handleCloseUpgradeModal}
      />
    </View>
  );
}

/** Skeleton loading state matching hub layout */
function ProfileSkeleton({ theme }: { theme: any }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      {/* Profile card skeleton */}
      <View
        style={[
          styles.skeletonCard,
          {
            backgroundColor: theme.backgroundSecondary,
            paddingTop: insets.top + Spacing.lg,
          },
        ]}
      >
        <View style={styles.skeletonRow}>
          <SkeletonBox width={48} height={48} borderRadius={24} />
          <View style={styles.skeletonInfo}>
            <SkeletonBox width={120} height={18} borderRadius={4} />
            <SkeletonBox width={80} height={28} borderRadius={14} />
          </View>
        </View>
      </View>
      {/* Widget row skeleton */}
      <View style={styles.skeletonWidgetRow}>
        <SkeletonBox
          width="100%"
          height={88}
          borderRadius={15}
          style={{ flex: 1 }}
        />
        <SkeletonBox
          width="100%"
          height={88}
          borderRadius={15}
          style={{ flex: 1 }}
        />
        <SkeletonBox
          width="100%"
          height={88}
          borderRadius={15}
          style={{ flex: 1 }}
        />
      </View>
      {/* Grid skeleton */}
      <View style={styles.skeletonGrid}>
        <View style={styles.skeletonGridRow}>
          <SkeletonBox
            width="100%"
            height={72}
            borderRadius={15}
            style={{ flex: 1 }}
          />
          <SkeletonBox
            width="100%"
            height={72}
            borderRadius={15}
            style={{ flex: 1 }}
          />
        </View>
        <View style={styles.skeletonGridRow}>
          <SkeletonBox
            width="100%"
            height={72}
            borderRadius={15}
            style={{ flex: 1 }}
          />
          <SkeletonBox
            width="100%"
            height={72}
            borderRadius={15}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  widgetSection: {
    marginTop: Spacing.xl,
  },
  librarySection: {
    marginTop: Spacing["3xl"],
  },
  settingsSection: {
    marginTop: Spacing["3xl"],
  },
  // Skeleton styles
  skeletonCard: {
    padding: Spacing.lg,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  skeletonInfo: {
    gap: Spacing.sm,
  },
  skeletonWidgetRow: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
  },
  skeletonGrid: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing["3xl"],
  },
  skeletonGridRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
});
