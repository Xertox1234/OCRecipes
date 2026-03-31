import React, { useCallback, useState } from "react";
import { ScrollView, RefreshControl, StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import { DailySummaryHeader } from "@/components/home/DailySummaryHeader";
import { RecipeCarousel } from "@/components/home/RecipeCarousel";
import { RecentActionsRow } from "@/components/home/RecentActionsRow";
import { CollapsibleSection } from "@/components/home/CollapsibleSection";
import { ActionRow } from "@/components/home/ActionRow";
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
import { Spacing, FAB_CLEARANCE } from "@/constants/theme";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { HomeScreenNavigationProp } from "@/types/navigation";

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

  const { sections, toggleSection, recentActions, recordAction, usageCounts } =
    useHomeActions();
  const queryClient = useQueryClient();
  const { refetch, isRefetching } = useDailyBudget();

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

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
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
        <DailySummaryHeader onCalorieTap={handleCalorieTap} />

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
              {getActionsByGroup(key).map((action) => (
                <ActionRow
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  subtitle={action.subtitle}
                  onPress={() => handleActionPress(action)}
                  isLocked={action.premium && !isPremium}
                />
              ))}
            </CollapsibleSection>
          </Animated.View>
        ))}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bottomSpacer: {
    height: Spacing.xl,
  },
});
