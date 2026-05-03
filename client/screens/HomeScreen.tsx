import React, { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View, Pressable } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";

import { DailySummaryHeader } from "@/components/home/DailySummaryHeader";
import { ThemedText } from "@/components/ThemedText";
import { RecipeCarousel } from "@/components/home/RecipeCarousel";
import { RecentActionsRow } from "@/components/home/RecentActionsRow";
import { DiscoveryCarousel } from "@/components/home/DiscoveryCarousel";
import { CollapsibleSection } from "@/components/home/CollapsibleSection";
import { ActionRow } from "@/components/home/ActionRow";
import { QuickLogDrawer } from "@/components/home/QuickLogDrawer";
import {
  HOME_ACTIONS,
  getActionsByGroup,
  navigateAction,
  type HomeAction,
} from "@/components/home/action-config";
import type { SectionKey } from "@/lib/home-actions-storage";
import { useHomeActions } from "@/hooks/useHomeActions";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { useDailyBudget } from "@/hooks/useDailyBudget";
import { useTheme } from "@/hooks/useTheme";
import { useScrollLinkedHeader } from "@/hooks/useScrollLinkedHeader";
import { Spacing, FAB_CLEARANCE, FontFamily } from "@/constants/theme";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const HOME_HEADER_EXPANDED = 100;
const HOME_HEADER_COLLAPSED = 44;
const HOME_COLLAPSE_THRESHOLD = 80;

const SECTIONS: { key: SectionKey; title: string; delay: number }[] = [
  { key: "nutrition", title: "Nutrition & Health", delay: 150 },
  { key: "recipes", title: "Recipes", delay: 200 },
  { key: "planning", title: "Planning", delay: 250 },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { user } = useAuthContext();
  const { theme } = useTheme();

  const { sections, toggleSection, recentActions, recordAction, usageCounts } =
    useHomeActions();
  const queryClient = useQueryClient();
  const { data: budget, refetch, isRefetching } = useDailyBudget();

  const {
    scrollHandler,
    headerAnimatedStyle,
    collapsedBarAnimatedStyle,
    isBarVisible,
  } = useScrollLinkedHeader({
    expandedHeight: HOME_HEADER_EXPANDED,
    collapsedHeight: HOME_HEADER_COLLAPSED,
    collapseThreshold: HOME_COLLAPSE_THRESHOLD,
    reducedMotion,
  });

  const isPremium = user?.subscriptionTier === "premium";
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const handleActionPress = useCallback(
    (action: HomeAction) => {
      if (action.premium && !isPremium) {
        haptics.notification(Haptics.NotificationFeedbackType.Warning);
        setShowUpgradeModal(true);
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      recordAction(action.id);
      navigateAction(action, navigation);
    },
    [isPremium, haptics, recordAction, navigation],
  );

  const handleCalorieTap = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("DailyNutritionDetail");
  }, [haptics, navigation]);

  const calorieText = budget
    ? `${Math.round(budget.foodCalories).toLocaleString()} / ${Math.round(budget.calorieGoal).toLocaleString()} cal`
    : "";

  return (
    <>
      {/* Collapsed summary bar (visible when scrolled) */}
      <Animated.View
        style={[
          styles.collapsedBar,
          collapsedBarAnimatedStyle,
          {
            paddingTop: insets.top,
            backgroundColor: theme.backgroundRoot,
            borderBottomColor: theme.border,
          },
        ]}
        pointerEvents={isBarVisible ? "auto" : "none"}
      >
        <Pressable
          onPress={handleCalorieTap}
          style={styles.collapsedBarContent}
          accessibilityRole="button"
          accessibilityLabel={`${calorieText}. Tap for details.`}
        >
          <ThemedText style={[styles.collapsedBarText, { color: theme.text }]}>
            {calorieText}
          </ThemedText>
          <Feather
            name="chevron-right"
            size={14}
            color={theme.textSecondary}
            accessible={false}
          />
        </Pressable>
      </Animated.View>

      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              queryClient.invalidateQueries({
                queryKey: ["/api/carousel"],
              });
              refetch().then(() => haptics.impact());
            }}
          />
        }
      >
        <Animated.View style={[styles.expandableHeader, headerAnimatedStyle]}>
          <DailySummaryHeader onCalorieTap={handleCalorieTap} />
        </Animated.View>

        <DiscoveryCarousel
          onActionPress={handleActionPress}
          usageCounts={usageCounts}
        />

        <RecentActionsRow
          recentActionIds={recentActions}
          allActions={HOME_ACTIONS}
          onActionPress={handleActionPress}
          usageCounts={usageCounts}
        />

        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(100).duration(400)
          }
        >
          <RecipeCarousel />
        </Animated.View>

        {SECTIONS.map(({ key, title, delay }) => (
          <Animated.View
            key={key}
            entering={
              reducedMotion ? undefined : FadeInDown.delay(delay).duration(400)
            }
          >
            <CollapsibleSection
              title={title}
              isExpanded={sections[key]}
              onToggle={() => toggleSection(key)}
            >
              {getActionsByGroup(key).map((action) =>
                action.renderInline ? (
                  <QuickLogDrawer key={action.id} action={action} />
                ) : (
                  <ActionRow
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    subtitle={action.subtitle}
                    onPress={() => handleActionPress(action)}
                    isLocked={action.premium && !isPremium}
                  />
                ),
              )}
            </CollapsibleSection>
          </Animated.View>
        ))}

        <View style={styles.bottomSpacer} />
      </Animated.ScrollView>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    minHeight: HOME_HEADER_COLLAPSED,
  },
  collapsedBarText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  expandableHeader: {
    overflow: "hidden",
  },
  bottomSpacer: {
    height: Spacing.xl,
  },
});
