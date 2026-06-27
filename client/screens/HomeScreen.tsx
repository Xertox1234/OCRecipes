import React, { useCallback, useMemo, useState } from "react";
import {
  RefreshControl,
  StyleSheet,
  View,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  useAnimatedRef,
  measure,
  runOnUI,
  scrollTo,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";

import { collapseTimingConfig } from "@/constants/animations";
import {
  glideToTopOffset,
  nextOpenDrawer,
} from "@/components/home/inline-drawer-utils";
import { HomeInlineDrawer } from "@/components/home/HomeInlineDrawer";
import { DailySummaryHeader } from "@/components/home/DailySummaryHeader";
import { RecipeSearchEntry } from "@/components/home/RecipeSearchEntry";
import { ThemedText } from "@/components/ThemedText";
import { RecipeCarousel } from "@/components/home/RecipeCarousel";
import { CuratedRecipeCarousel } from "@/components/home/CuratedRecipeCarousel";
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
  // DailySummaryHeader receives budget data as props — there is one observer of
  // this query key. The `meta` flag suppresses the global error toast so the
  // inline CarouselError in DailySummaryHeader is the only error surface.
  const {
    data: budget,
    refetch,
    isRefetching,
    isLoading: budgetIsLoading,
    isError: budgetIsError,
  } = useDailyBudget(undefined, { meta: { silentError: true } });

  const {
    scrollHandler,
    scrollY,
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

  const { height: screenHeight } = useWindowDimensions();
  const DRAWER_MAX_HEIGHT = Math.round(screenHeight * 0.75);
  const collapsedBarHeight = insets.top + HOME_HEADER_COLLAPSED;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const searchRowRef = useAnimatedRef<Animated.View>();
  const generateRowRef = useAnimatedRef<Animated.View>();
  const drawerRowRefs: Record<string, typeof searchRowRef> = {
    "search-recipes": searchRowRef,
    "generate-recipe": generateRowRef,
  };

  const [openDrawerId, setOpenDrawerId] = useState<string | null>(null);

  const scrollContentContainerStyle = useMemo(
    () => ({
      paddingTop: insets.top + Spacing.lg,
      paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
    }),
    [insets.top, tabBarHeight],
  );

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["/api/carousel"],
    });
    void queryClient.invalidateQueries({ queryKey: ["/api/curated-recipes"] });
    void refetch().then(() => haptics.impact());
  }, [queryClient, refetch, haptics]);

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

  const glideRowToTop = useCallback(
    (actionId: string) => {
      const rowRef = drawerRowRefs[actionId];
      if (!rowRef) return;
      const currentY = scrollY.value;
      runOnUI(() => {
        "worklet";
        const m = measure(rowRef);
        if (m === null) return;
        scrollTo(
          scrollRef,
          0,
          glideToTopOffset(currentY, m.pageY, collapsedBarHeight),
          true,
        );
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animated refs + shared value are stable
    [collapsedBarHeight],
  );

  const handleDrawerToggle = useCallback(
    (action: HomeAction) => {
      // Premium gate reimplemented here (inline path bypasses handleActionPress)
      const opening = openDrawerId !== action.id;
      if (opening && action.premium && !isPremium) {
        haptics.notification(Haptics.NotificationFeedbackType.Warning);
        setShowUpgradeModal(true);
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      const { next, isSwitch } = nextOpenDrawer(openDrawerId, action.id);
      if (isSwitch) {
        // Collapse the open one first, then open + glide the new one (avoids
        // three concurrent animations racing a moving target).
        setOpenDrawerId(null);
        setTimeout(() => {
          setOpenDrawerId(next);
          if (next) glideRowToTop(next);
        }, collapseTimingConfig.duration ?? 250);
      } else {
        setOpenDrawerId(next);
        if (next) glideRowToTop(next);
      }
    },
    [openDrawerId, isPremium, haptics, glideRowToTop],
  );

  useFocusEffect(
    useCallback(() => {
      return () => setOpenDrawerId(null); // close when Home loses focus
    }, []),
  );

  const renderInlineAction = (action: HomeAction) => {
    if (action.id === "quick-log") {
      return <QuickLogDrawer key={action.id} action={action} />;
    }
    const rowRef = drawerRowRefs[action.id];
    const isLocked = !!action.premium && !isPremium;
    // Wrap with Animated.View to carry the animatedRef for measurement — the
    // forwardRef in HomeInlineDrawer resolves to `never` for its ComponentRef,
    // so we keep the ref on the wrapper (identical bounding box, measure works).
    return (
      <Animated.View key={action.id} ref={rowRef}>
        <HomeInlineDrawer
          icon={action.icon}
          label={action.label}
          isOpen={openDrawerId === action.id}
          onToggle={() => handleDrawerToggle(action)}
          maxHeight={DRAWER_MAX_HEIGHT}
          isLocked={isLocked}
        >
          <ThemedText type="small">Coming soon</ThemedText>
        </HomeInlineDrawer>
      </Animated.View>
    );
  };

  // Budget failed and nothing cached — the collapsed bar (a separate surface
  // that appears on scroll, below the DailySummaryHeader's own error UI) must
  // not show an empty "/ cal" string. Surface a recoverable affordance here too.
  const budgetErrored = budgetIsError && !budget;

  const handleCalorieTap = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    if (budgetErrored) {
      void refetch();
      return;
    }
    navigation.navigate("DailyNutritionDetail");
  }, [haptics, navigation, budgetErrored, refetch]);

  const calorieText = budget
    ? `${Math.round(budget.foodCalories).toLocaleString()} / ${Math.round(budget.calorieGoal).toLocaleString()} cal`
    : budgetErrored
      ? "Couldn't load — tap to retry"
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
        // pointerEvents="none" does NOT remove the bar from the a11y tree —
        // hide it explicitly or screen readers focus an invisible button.
        accessibilityElementsHidden={!isBarVisible}
        importantForAccessibility={
          isBarVisible ? "auto" : "no-hide-descendants"
        }
      >
        <Pressable
          onPress={handleCalorieTap}
          style={styles.collapsedBarContent}
          accessibilityRole="button"
          accessibilityLabel={
            budgetErrored
              ? calorieText
              : calorieText
                ? `${calorieText}. Tap for details.`
                : "Calorie summary loading"
          }
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
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={scrollContentContainerStyle}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        onScrollBeginDrag={() => {
          if (openDrawerId !== null) setOpenDrawerId(null);
        }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
      >
        <Animated.View
          style={[styles.expandableHeader, headerAnimatedStyle]}
          // Inverse of the collapsed bar: when the bar takes over, the faded
          // header is visually gone but still in the a11y tree — hide it.
          accessibilityElementsHidden={isBarVisible}
          importantForAccessibility={
            isBarVisible ? "no-hide-descendants" : "auto"
          }
        >
          <DailySummaryHeader
            onCalorieTap={handleCalorieTap}
            budget={budget}
            isLoading={budgetIsLoading}
            isError={budgetIsError}
            refetch={refetch}
          />
        </Animated.View>

        <RecipeSearchEntry />

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

        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInDown.delay(150).duration(400)
          }
        >
          <CuratedRecipeCarousel />
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
                  renderInlineAction(action)
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
