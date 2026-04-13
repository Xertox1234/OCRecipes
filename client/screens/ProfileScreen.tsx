import React, { useRef } from "react";
import { StyleSheet, View, Pressable, Image } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { MiniWidgetRow } from "@/components/profile/MiniWidgetRow";
import { LibraryGrid } from "@/components/profile/LibraryGrid";
import { InlineSettings } from "@/components/profile/InlineSettings";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useProfileData } from "@/hooks/useProfileData";
import { useScrollLinkedHeader } from "@/hooks/useScrollLinkedHeader";
import { resolveImageUrl } from "@/lib/query-client";
import {
  Spacing,
  FAB_CLEARANCE,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

const PROFILE_HEADER_EXPANDED = 120;
const PROFILE_HEADER_COLLAPSED = 52;
const PROFILE_COLLAPSE_THRESHOLD = 80;

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
  const insets = useSafeAreaInsets();
  const hasAnimated = useRef(false);

  const {
    scrollHandler,
    headerAnimatedStyle,
    collapsedBarAnimatedStyle,
    isBarVisible,
  } = useScrollLinkedHeader({
    expandedHeight: PROFILE_HEADER_EXPANDED,
    collapsedHeight: PROFILE_HEADER_COLLAPSED,
    collapseThreshold: PROFILE_COLLAPSE_THRESHOLD,
    reducedMotion,
  });

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

  const displayName = user.displayName || user.username;

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      {/* Compact collapsed header bar */}
      <Animated.View
        style={[
          styles.collapsedBar,
          collapsedBarAnimatedStyle,
          {
            paddingTop: insets.top,
            backgroundColor: theme.backgroundSecondary,
            borderBottomColor: theme.border,
          },
        ]}
        pointerEvents={isBarVisible ? "auto" : "none"}
      >
        <View style={styles.collapsedBarContent}>
          {user.avatarUrl && resolveImageUrl(user.avatarUrl) ? (
            <Image
              source={{ uri: resolveImageUrl(user.avatarUrl)! }}
              style={styles.collapsedAvatar}
            />
          ) : (
            <View
              style={[
                styles.collapsedAvatarPlaceholder,
                { backgroundColor: theme.backgroundTertiary },
              ]}
            >
              <Feather name="user" size={12} color={theme.textSecondary} />
            </View>
          )}
          <ThemedText
            style={[styles.collapsedName, { color: theme.text }]}
            numberOfLines={1}
          >
            {displayName}
          </ThemedText>
          <Pressable
            onPress={handleGearPress}
            accessibilityLabel="Settings"
            accessibilityRole="button"
            style={[
              styles.collapsedGear,
              { backgroundColor: withOpacity(theme.textSecondary, 0.08) },
            ]}
            hitSlop={8}
          >
            <Feather name="settings" size={16} color={theme.textSecondary} />
          </Pressable>
        </View>
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={{
          paddingBottom: tabBarHeight + FAB_CLEARANCE + Spacing.lg,
        }}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
      >
        {/* 1. Profile Card */}
        <Animated.View
          entering={getEntering(0)}
          style={[styles.expandableHeader, headerAnimatedStyle]}
        >
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
      </Animated.ScrollView>

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

const COLLAPSED_AVATAR_SIZE = 24;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  collapsedBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  collapsedBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: PROFILE_HEADER_COLLAPSED,
    gap: Spacing.sm,
  },
  collapsedAvatar: {
    width: COLLAPSED_AVATAR_SIZE,
    height: COLLAPSED_AVATAR_SIZE,
    borderRadius: COLLAPSED_AVATAR_SIZE / 2,
  },
  collapsedAvatarPlaceholder: {
    width: COLLAPSED_AVATAR_SIZE,
    height: COLLAPSED_AVATAR_SIZE,
    borderRadius: COLLAPSED_AVATAR_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  collapsedName: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.medium,
  },
  collapsedGear: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  expandableHeader: {
    overflow: "hidden",
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
