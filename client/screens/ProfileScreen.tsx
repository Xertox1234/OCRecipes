import React, { ComponentProps, useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
  Image,
  AccessibilityInfo,
  Linking,
  Platform,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";

import { usePremiumContext } from "@/context/PremiumContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import {
  getTierLabel,
  getNextTier,
} from "@/components/verification-badge-utils";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
  FAB_CLEARANCE,
} from "@/constants/theme";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { getApiUrl, resolveImageUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import {
  useThemePreference,
  type ThemePreference,
} from "@/context/ThemeContext";
import { useHealthKitSettings } from "@/hooks/useHealthKit";
import { HealthKitSyncIndicator } from "@/components/HealthKitSyncIndicator";

type ProfileScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, "Profile">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList, "ProfileTab">,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

type FeatherIconName = ComponentProps<typeof Feather>["name"];

interface DailySummary {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
}

const COVER_HEIGHT = 153;
const AVATAR_SIZE = 60;
const AVATAR_RING_SIZE = 66;
const GRID_GAP = 16;
const GRID_ITEM_HEIGHT = 141;

function useGridItemWidth() {
  const { width } = useWindowDimensions();
  return (width - Spacing.lg * 2 - GRID_GAP) / 2;
}

interface FeaturedRecipe {
  id: number;
  title: string;
  imageUrl: string | null;
  dietTags: string[];
}

// ---------- Sub-components ----------

const CoverPhotoSection = React.memo(function CoverPhotoSection({
  topInset,
}: {
  topInset: number;
}) {
  const { theme } = useTheme();
  const totalHeight = COVER_HEIGHT + topInset;

  return (
    <View
      style={[styles.coverContainer, { height: totalHeight }]}
      accessibilityElementsHidden={true}
    >
      <Image
        source={require("../../assets/images/login-hero.jpg")}
        style={styles.coverImage}
        resizeMode="cover"
      />
      {/* Top gradient for status bar legibility */}
      <LinearGradient
        colors={[withOpacity("#000000", 0.45), "transparent"]} // hardcoded — dark overlay for status bar legibility
        style={[styles.coverGradientTop, { height: topInset + 24 }]}
      />
      {/* Bottom gradient blending into background */}
      <LinearGradient
        colors={[
          "transparent",
          withOpacity(theme.backgroundRoot, 0.6),
          theme.backgroundRoot,
        ]}
        locations={[0, 0.5, 1]}
        style={[styles.coverGradientBottom, { height: totalHeight }]}
      />
    </View>
  );
});

const AvatarWithRing = React.memo(function AvatarWithRing({
  user,
  isUploading,
  onPress,
}: {
  user: {
    avatarUrl?: string | null;
  } | null;
  isUploading: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Tap to change profile picture"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.avatarRing,
        {
          borderColor: theme.link,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {isUploading ? (
        <ActivityIndicator size="small" color={theme.link} />
      ) : (
        <FallbackImage
          source={{ uri: resolveImageUrl(user?.avatarUrl) ?? undefined }}
          style={styles.avatarImage}
          fallbackStyle={{
            ...styles.avatarPlaceholder,
            backgroundColor: withOpacity(theme.link, 0.12),
          }}
          fallbackIcon="user"
          fallbackIconSize={28}
          fallbackIconColor={theme.link}
          accessible={false}
        />
      )}
      <View
        style={[
          styles.avatarCameraBadge,
          { backgroundColor: theme.link, borderColor: theme.backgroundRoot },
        ]}
      >
        <Feather name="camera" size={10} color={theme.buttonText} />
      </View>
    </Pressable>
  );
});

const UserNameBio = React.memo(function UserNameBio({
  user,
}: {
  user: {
    displayName?: string | null;
    username: string;
  } | null;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.userNameBioContainer}>
      <ThemedText type="h4" style={styles.userNameText}>
        {user?.displayName || user?.username || "User"}
      </ThemedText>
      <ThemedText
        type="caption"
        style={[styles.bioText, { color: theme.textSecondary }]}
      >
        Tracking my nutrition journey
      </ThemedText>
    </View>
  );
});

const StatsRow = React.memo(function StatsRow({
  todaySummary,
  verifiedCount,
  verifyStreak,
}: {
  todaySummary: DailySummary | undefined;
  verifiedCount: number;
  verifyStreak: number;
}) {
  const { theme } = useTheme();
  const calories = todaySummary ? Math.round(todaySummary.totalCalories) : 0;
  const itemCount = todaySummary?.itemCount ?? 0;

  return (
    <View style={styles.statsRow}>
      <View style={styles.statItem}>
        <ThemedText style={styles.statNumber}>
          {calories.toLocaleString()}
        </ThemedText>
        <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>
          Calories
        </ThemedText>
      </View>
      <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
      <View style={styles.statItem}>
        <ThemedText style={styles.statNumber}>
          {verifyStreak > 0
            ? `${verifyStreak} ${verifyStreak === 1 ? "Day" : "Days"}`
            : "—"}
        </ThemedText>
        <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>
          Streak
        </ThemedText>
      </View>
      <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
      <View style={styles.statItem}>
        <ThemedText style={styles.statNumber}>{itemCount}</ThemedText>
        <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>
          Logged
        </ThemedText>
      </View>
      <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
      <View style={styles.statItem}>
        <ThemedText style={styles.statNumber}>{verifiedCount}</ThemedText>
        <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>
          Verified
        </ThemedText>
      </View>
    </View>
  );
});

const ActionButtonsRow = React.memo(function ActionButtonsRow({
  onEditProfile,
  onGearPress,
}: {
  onEditProfile: () => void;
  onGearPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.actionButtonsRow}>
      <Pressable
        onPress={onEditProfile}
        accessibilityLabel="Edit Profile"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.editProfileButton,
          {
            backgroundColor: theme.link,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <ThemedText
          style={[styles.editProfileButtonText, { color: theme.buttonText }]}
        >
          Edit Profile
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={onGearPress}
        accessibilityLabel="Settings"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.gearButton,
          {
            backgroundColor: theme.backgroundSecondary,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Feather name="settings" size={18} color={theme.text} />
      </Pressable>
    </View>
  );
});

const PhotoGridItem = React.memo(function PhotoGridItem({
  item,
  itemWidth,
  onPress,
}: {
  item: FeaturedRecipe;
  itemWidth: number;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const imageUri = resolveImageUrl(item.imageUrl);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={item.title}
      accessibilityRole="button"
      accessibilityHint="View recipe details"
      style={({ pressed }) => [
        styles.gridItem,
        {
          backgroundColor: theme.backgroundSecondary,
          width: itemWidth,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <FallbackImage
        source={{ uri: imageUri ?? undefined }}
        style={StyleSheet.absoluteFill}
        fallback={
          <View style={styles.gridItemContent}>
            <Feather name="image" size={32} color={theme.textSecondary} />
          </View>
        }
        resizeMode="cover"
        accessibilityLabel={`Photo of ${item.title}`}
      />
      <LinearGradient
        colors={["transparent", withOpacity("#000000", 0.6)]} // hardcoded — dark overlay for white text
        style={styles.gridItemGradient}
      />
      {/* Always white over dark gradient overlay, intentionally not theme-dependent */}
      <ThemedText style={styles.gridItemName}>{item.title}</ThemedText>
    </Pressable>
  );
});

const PhotoGrid = React.memo(function PhotoGrid({
  recipes,
  onRecipePress,
}: {
  recipes: FeaturedRecipe[];
  onRecipePress: (recipeId: number) => void;
}) {
  const gridItemWidth = useGridItemWidth();

  if (recipes.length === 0) return null;

  return (
    <View style={styles.photoGrid}>
      {recipes.slice(0, 6).map((item) => (
        <PhotoGridItem
          key={item.id}
          item={item}
          itemWidth={gridItemWidth}
          onPress={() => onRecipePress(item.id)}
        />
      ))}
    </View>
  );
});

const SettingsItem = React.memo(function SettingsItem({
  icon,
  label,
  value,
  onPress,
  showChevron = true,
  danger = false,
  locked = false,
}: {
  icon: FeatherIconName;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  danger?: boolean;
  locked?: boolean;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={
        locked ? `${label} (Premium)` : value ? `${label}: ${value}` : label
      }
      accessibilityRole="button"
      accessibilityHint={
        locked ? "Tap to upgrade" : showChevron ? "Tap to open" : undefined
      }
      style={({ pressed }) => [
        styles.settingsItem,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.settingsIconWrapper}>
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
            accessible={false}
          />
        </View>
        {locked && (
          <View
            style={[
              styles.lockBadge,
              { backgroundColor: theme.backgroundRoot },
            ]}
          >
            <Feather
              name="lock"
              size={10}
              color={theme.textSecondary}
              accessible={false}
            />
          </View>
        )}
      </View>
      <View style={styles.settingsContent}>
        <ThemedText type="body" style={[danger && { color: theme.error }]}>
          {label}
        </ThemedText>
        {value ? (
          <ThemedText type="small" style={styles.settingsValue}>
            {value}
          </ThemedText>
        ) : null}
      </View>
      {showChevron ? (
        <Feather
          name="chevron-right"
          size={20}
          color={theme.textSecondary}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
});

const SettingsSection = React.memo(function SettingsSection({
  themePreference,
  onWeightTracking,
  onHealthKit,
  onDietaryProfile,
  onGLP1Companion,
  onNutritionGoals,
  onLibrary,
  onScanHistory,
  onThemeToggle,
  onSubscription,
  onLogout,
  onLockedPress,
}: {
  themePreference: ThemePreference;
  onWeightTracking: () => void;
  onHealthKit: () => void;
  onDietaryProfile: () => void;
  onGLP1Companion: () => void;
  onNutritionGoals: () => void;
  onLibrary: () => void;
  onScanHistory: () => void;
  onThemeToggle: () => void;
  onSubscription: () => void;
  onLogout: () => void;
  onLockedPress: () => void;
}) {
  const { theme } = useTheme();
  const { data: healthKitSettings } = useHealthKitSettings();
  const weightTrendUnlocked = usePremiumFeature("weightTrend");
  const healthKitUnlocked = usePremiumFeature("healthKitSync");
  const glp1Unlocked = usePremiumFeature("glp1Companion");
  const adaptiveGoalsUnlocked = usePremiumFeature("adaptiveGoals");

  return (
    <View style={styles.settingsSection}>
      <ThemedText type="h4" style={styles.settingsSectionTitle}>
        Settings
      </ThemedText>
      <Card elevation={1} style={styles.settingsCard}>
        <SettingsItem
          icon="trending-down"
          label="Weight Tracking"
          locked={!weightTrendUnlocked}
          onPress={weightTrendUnlocked ? onWeightTracking : onLockedPress}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.healthKitRow}>
          <View style={{ flex: 1 }}>
            <SettingsItem
              icon="heart"
              label="Apple Health"
              locked={!healthKitUnlocked}
              onPress={healthKitUnlocked ? onHealthKit : onLockedPress}
            />
          </View>
          {healthKitSettings && healthKitSettings.length > 0 && (
            <HealthKitSyncIndicator settings={healthKitSettings} />
          )}
        </View>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem
          icon="clipboard"
          label="Dietary Profile"
          onPress={onDietaryProfile}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem
          icon="activity"
          label="GLP-1 Companion"
          locked={!glp1Unlocked}
          onPress={glp1Unlocked ? onGLP1Companion : onLockedPress}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem
          icon="target"
          label="Nutrition Goals"
          locked={!adaptiveGoalsUnlocked}
          onPress={adaptiveGoalsUnlocked ? onNutritionGoals : onLockedPress}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem icon="bookmark" label="My Library" onPress={onLibrary} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem
          icon="clock"
          label="Scan History"
          onPress={onScanHistory}
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
          onPress={onThemeToggle}
          showChevron={false}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem
          icon="star"
          label="Subscription"
          onPress={onSubscription}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingsItem
          icon="log-out"
          label="Sign Out"
          onPress={onLogout}
          showChevron={false}
          danger
        />
      </Card>
    </View>
  );
});

const ProfileSkeleton = React.memo(function ProfileSkeleton({
  topInset,
}: {
  topInset: number;
}) {
  const gridItemWidth = useGridItemWidth();

  return (
    <View accessibilityElementsHidden>
      <SkeletonBox width="100%" height={COVER_HEIGHT + topInset} />
      <View style={styles.skeletonAvatarRow}>
        <SkeletonBox
          width={AVATAR_RING_SIZE}
          height={AVATAR_RING_SIZE}
          borderRadius={AVATAR_RING_SIZE / 2}
        />
      </View>
      <View style={styles.skeletonNameRow}>
        <SkeletonBox width={120} height={20} />
      </View>
      <View style={styles.skeletonStatsRow}>
        <SkeletonBox width={50} height={30} />
        <SkeletonBox width={50} height={30} />
        <SkeletonBox width={50} height={30} />
      </View>
      <View style={styles.skeletonGridRow}>
        <SkeletonBox
          width={gridItemWidth}
          height={GRID_ITEM_HEIGHT}
          borderRadius={BorderRadius.sm}
        />
        <SkeletonBox
          width={gridItemWidth}
          height={GRID_ITEM_HEIGHT}
          borderRadius={BorderRadius.sm}
        />
      </View>
      <View style={styles.skeletonGridRow}>
        <SkeletonBox
          width={gridItemWidth}
          height={GRID_ITEM_HEIGHT}
          borderRadius={BorderRadius.sm}
        />
        <SkeletonBox
          width={gridItemWidth}
          height={GRID_ITEM_HEIGHT}
          borderRadius={BorderRadius.sm}
        />
      </View>
    </View>
  );
});

// ---------- Constants ----------

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

// ---------- Main Screen ----------

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
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
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        `Appearance changed to ${THEME_LABELS[nextPreference]}`,
      );
    }
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
          const errorData = JSON.parse(uploadResult.body || "{}");
          throw new Error(errorData.error || "Failed to upload avatar");
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
  };

  if (isInitialLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={{
          paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
        }}
      >
        <ProfileSkeleton topInset={insets.top} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
    >
      {/* Cover Photo */}
      <CoverPhotoSection topInset={insets.top} />

      {/* Avatar + Name + Bio */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(100).duration(400)
        }
        style={styles.profileInfoContainer}
      >
        <AvatarWithRing
          user={user}
          isUploading={isUploadingAvatar}
          onPress={handleAvatarPress}
        />
        <UserNameBio user={user} />
      </Animated.View>

      {/* Stats Row */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(200).duration(400)
        }
      >
        <StatsRow
          todaySummary={todaySummary}
          verifiedCount={verificationData?.count ?? 0}
          verifyStreak={verificationData?.streak ?? 0}
        />
      </Animated.View>

      {/* Verification Tier Badge */}
      {(() => {
        const score =
          verificationData?.compositeScore ?? verificationData?.count ?? 0;
        const tierLabel = getTierLabel(score);
        const nextTier = getNextTier(score);
        if (!tierLabel) return null;
        return (
          <View
            style={[
              styles.tierBadge,
              { backgroundColor: withOpacity(theme.success, 0.08) },
            ]}
            accessibilityLabel={`Verification rank: ${tierLabel}. ${nextTier ? `${Math.ceil(nextTier - score)} more to reach next tier.` : "Maximum tier reached."}`}
            accessibilityRole="text"
          >
            <Feather
              name="award"
              size={16}
              color={theme.success}
              accessible={false}
            />
            <ThemedText
              type="body"
              style={{ color: theme.success, fontWeight: "600" }}
            >
              {tierLabel}
            </ThemedText>
            {nextTier && (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {Math.ceil(nextTier - score)} more to next rank
              </ThemedText>
            )}
          </View>
        );
      })()}

      {/* Action Buttons */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(250).duration(400)
        }
      >
        <ActionButtonsRow
          onEditProfile={() => navigation.navigate("EditDietaryProfile")}
          onGearPress={() => {
            haptics.impact(Haptics.ImpactFeedbackStyle.Light);
            scrollRef.current?.scrollTo({
              y: settingsYRef.current,
              animated: true,
            });
          }}
        />
      </Animated.View>

      {/* Separator */}
      <View style={[styles.separator, { backgroundColor: theme.border }]} />

      {/* Photo Grid */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(300).duration(400)
        }
      >
        <PhotoGrid
          recipes={featuredRecipes ?? []}
          onRecipePress={(recipeId) => {
            haptics.impact(Haptics.ImpactFeedbackStyle.Light);
            navigation.navigate("FeaturedRecipeDetail", { recipeId });
          }}
        />
      </Animated.View>

      {/* Settings */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(400).duration(400)
        }
        onLayout={(e) => {
          settingsYRef.current = e.nativeEvent.layout.y;
        }}
      >
        <SettingsSection
          themePreference={themePreference}
          onWeightTracking={() => navigation.navigate("WeightTracking")}
          onHealthKit={() => navigation.navigate("HealthKitSettings")}
          onDietaryProfile={() => navigation.navigate("EditDietaryProfile")}
          onGLP1Companion={() => navigation.navigate("GLP1Companion")}
          onNutritionGoals={() => navigation.navigate("GoalSetup")}
          onLibrary={() => navigation.navigate("SavedItems")}
          onScanHistory={() => navigation.navigate("ScanHistory")}
          onThemeToggle={handleThemeToggle}
          onSubscription={() => {
            haptics.impact(Haptics.ImpactFeedbackStyle.Light);
            if (isPremium) {
              if (Platform.OS === "ios") {
                Linking.openURL("https://apps.apple.com/account/subscriptions");
              } else {
                Linking.openURL(
                  "https://play.google.com/store/account/subscriptions",
                );
              }
            } else {
              setShowUpgradeModal(true);
            }
          }}
          onLogout={handleLogout}
          onLockedPress={() => {
            haptics.notification(Haptics.NotificationFeedbackType.Warning);
            setShowUpgradeModal(true);
          }}
        />
      </Animated.View>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Cover photo
  coverContainer: {
    width: "100%",
    position: "relative",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverGradientTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
  coverGradientBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Avatar
  profileInfoContainer: {
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  avatarRing: {
    width: AVATAR_RING_SIZE,
    height: AVATAR_RING_SIZE,
    borderRadius: AVATAR_RING_SIZE / 2,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    marginTop: -(AVATAR_RING_SIZE / 2),
    position: "relative",
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },

  // User name & bio
  userNameBioContainer: {
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  userNameText: {
    textAlign: "center",
  },
  bioText: {
    textAlign: "center",
    marginTop: 2,
  },

  // Stats row
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xl,
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  statLabel: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
  },
  statDivider: {
    width: 1,
    height: 14,
  },

  // Action buttons
  actionButtonsRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  editProfileButton: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  editProfileButtonText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  gearButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },

  // Separator
  separator: {
    height: 1,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },

  // Photo grid
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: GRID_GAP,
  },
  gridItem: {
    height: GRID_ITEM_HEIGHT,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  gridItemContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  gridItemGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
  },
  gridItemName: {
    position: "absolute",
    bottom: 8,
    left: 12,
    color: "#FFFFFF", // hardcoded — always white over dark gradient overlay
    fontSize: 12,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },

  // Settings section
  settingsSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  settingsSectionTitle: {
    marginBottom: Spacing.md,
  },
  settingsCard: {
    padding: 0,
    overflow: "hidden",
  },
  healthKitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: Spacing.md,
  },
  settingsItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  settingsIconWrapper: {
    position: "relative",
  },
  settingsIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  lockBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  settingsContent: {
    flex: 1,
  },
  settingsValue: {
    opacity: 0.6,
  },
  divider: {
    height: 1,
    marginLeft: Spacing.lg + 40 + Spacing.md,
  },

  // Skeleton
  skeletonAvatarRow: {
    alignItems: "center",
    marginTop: -(AVATAR_RING_SIZE / 2),
  },
  skeletonNameRow: {
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  skeletonStatsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing["2xl"],
    marginTop: Spacing.lg,
  },
  skeletonGridRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: GRID_GAP,
    marginTop: GRID_GAP,
  },
});
