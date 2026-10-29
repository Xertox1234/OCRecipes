import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  SectionList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import {
  resolvePlaceholder,
  shouldFloatLabel,
} from "@/components/text-input-utils";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";
import Animated from "react-native-reanimated";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useScrollLinkedHeader } from "@/hooks/useScrollLinkedHeader";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import { useSheetHostProps } from "@/hooks/useSheetHostProps";

import { ThemedText } from "@/components/ThemedText";
import {
  SkeletonBox,
  SkeletonLoadingRegion,
  SkeletonProvider,
} from "@/components/SkeletonLoader";
import { EmptyState } from "@/components/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import { useBottomBudget } from "@/hooks/useBottomBudget";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import {
  useFavouriteRecipeIds,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { useRecipeSearch } from "@/hooks/useRecipeSearch";
import { useCreateSuggestionListing } from "@/hooks/useInspiredSuggestions";
import { useMakeSuggestionFlow } from "@/hooks/useMakeSuggestionFlow";
import {
  SearchFilterSheet,
  type SearchFilters,
} from "@/components/meal-plan/SearchFilterSheet";
import { UnifiedRecipeCard } from "@/components/meal-plan/UnifiedRecipeCard";
import { RecipeFilterBar } from "@/components/meal-plan/RecipeFilterBar";
import { OnlineSearchCta } from "@/components/meal-plan/OnlineSearchCta";
import { SuggestionCard } from "@/components/inspired/SuggestionCard";
import { UpgradeModal } from "@/components/UpgradeModal";
import { usePremiumContext } from "@/context/PremiumContext";
import { RecipeDiscoveryFeed } from "@/components/meal-plan/RecipeDiscoveryFeed";
import { isBlankBrowseState } from "@/components/meal-plan/recipe-discovery-utils";
import { getSourceTab } from "./source-tab-utils";
import {
  resolveIdeasCtaState,
  computeActiveFilterCount,
  DEFAULT_FILTERS,
  detailParamsForSearchResult,
  type RecipeFilters,
} from "@/screens/meal-plan/recipe-browser-utils";
import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";
import {
  createListingBodySchema,
  type Suggestion,
} from "@shared/schemas/inspired-recipes";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeBrowserScreenNavigationProp } from "@/types/navigation";
import {
  formatPlanAddSuccess,
  planBannerA11yLabel,
} from "@/components/coach/coach-chat-utils";
import { useDelayedLoadingAnnouncement } from "@/hooks/useDelayedLoadingAnnouncement";

// One 44pt filter row plus the header area's bottom padding.
const RECIPE_HEADER_EXPANDED = 60;
const RECIPE_HEADER_COLLAPSED = 0;
const RECIPE_COLLAPSE_THRESHOLD = 100;

const SEARCH_LABEL = "Search recipes";
const SEARCH_ICON_SIZE = 16;
// The search bar's text starts past its left padding, the icon and the gap.
const SEARCH_LABEL_LEFT = Spacing.md + SEARCH_ICON_SIZE + Spacing.sm;

type RecipeBrowserRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeBrowser"
>;

// ── Item Separator ──────────────────────────────────────────────────

const ItemSeparator = React.memo(function ItemSeparator() {
  return <View style={{ height: Spacing.sm }} />;
});

// ── Main Screen ──────────────────────────────────────────────────────

// Reanimated 4.3 tightened createAnimatedComponent's return type so it no longer
// directly overlaps with `typeof SectionList`; cast through `unknown` so the
// collapsing header's scroll-linked animation (onScroll={scrollHandler}) keeps
// working — a plain SectionList silently breaks it.
const AnimatedSectionList = Animated.createAnimatedComponent(
  SectionList,
) as unknown as typeof SectionList;

export default function RecipeBrowserScreen() {
  const navigation = useNavigation<RecipeBrowserScreenNavigationProp>();
  const route = useRoute<RecipeBrowserRouteProp>();
  const headerHeight = useHeaderHeight();
  const bottomBudget = useBottomBudget();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { reducedMotion } = useAccessibility();

  const { scrollHandler, headerAnimatedStyle, isBarVisible } =
    useScrollLinkedHeader({
      expandedHeight: RECIPE_HEADER_EXPANDED,
      collapsedHeight: RECIPE_HEADER_COLLAPSED,
      collapseThreshold: RECIPE_COLLAPSE_THRESHOLD,
      reducedMotion,
    });

  const { mealType, plannedDate, searchQuery, planDays } = route.params || {};

  const [searchText, setSearchText] = useState(searchQuery || "");
  const searchFocus = useFieldFocus();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<RecipeFilters>(DEFAULT_FILTERS);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const filterSheetRef = React.useRef<BottomSheetModal>(null);

  // Host prop bundle (backdrop, themed background, handle indicator, and the
  // accessible={false} iOS a11y fix — see useSheetHostProps' own JSDoc). No
  // backdropOpacity/backdropPressBehavior override, matching this sheet's
  // pre-existing behavior of using gorhom's own backdrop defaults.
  const sheetHostProps = useSheetHostProps({
    backgroundColor: theme.backgroundRoot,
    handleIndicatorColor: withOpacity(theme.text, 0.3),
  });

  // Imperative host — see useSheetBackHandler's JSDoc for onSheetChange/onSheetAnimate semantics.
  const {
    onSheetChange: handleFilterSheetChange,
    onSheetAnimate: handleFilterSheetAnimate,
  } = useSheetBackHandler(filterSheetRef);

  // Android TalkBack background focus trap (iOS already trapped via
  // accessibilityViewIsModal on the filter sheet's own content root — the
  // BottomSheetView inside the BottomSheetModal below). Opened synchronously
  // alongside .present() where the filter icon is pressed; released only once
  // BottomSheetModal's own onDismiss confirms the sheet has fully closed
  // (post close-animation, the same asymmetric bias useSheetBackHandler
  // uses) — never released early.
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const handleFilterSheetClosed = useCallback(() => {
    setIsFilterSheetOpen(false);
  }, []);

  const { isPremium } = usePremiumContext();

  // Debounce search
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery || "");
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(text.trim());
    }, 300);
  }, []);

  // Flush the debounce immediately when the user presses the keyboard's
  // "Search" key. Without this, returnKeyType="search" is a no-op and the
  // query only commits 300ms after the last keystroke.
  const handleSubmitSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setDebouncedQuery(searchText.trim());
  }, [searchText]);

  // Cleanup debounce timer on unmount
  React.useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Unified search params
  const searchParams: RecipeSearchParams = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      cuisine: filters.activeCuisine,
      diet: filters.activeDiet,
      curatedOnly: filters.curatedOnly || undefined,
      safeForMe: filters.safeForMe || undefined,
      mealType: mealType || undefined,
      difficulty: filters.activeDifficulty,
      pantry: filters.pantryMode || undefined,
      sort: filters.advanced.sort,
      source: filters.advanced.source,
      maxPrepTime: filters.advanced.maxPrepTime,
      maxCalories: filters.advanced.maxCalories,
      minProtein: filters.advanced.minProtein,
    }),
    [debouncedQuery, mealType, filters],
  );

  // Destructure rather than depend on the mutation object itself —
  // useMutation returns a new object identity every render, which would
  // make handleRecipePress (and renderItem, which depends on it) re-create
  // on every RecipeBrowserScreen render, including one caused by a single
  // search keystroke (see CoachChat.tsx for the same pattern).
  const { mutateAsync: addMealPlanItem } = useAddMealPlanItem();
  const { data: favouriteData } = useFavouriteRecipeIds();
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();

  const favouriteIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const f of favouriteData?.ids ?? []) {
      set.add(`${f.recipeType}:${f.recipeId}`);
    }
    return set;
  }, [favouriteData]);

  const isBrowseOnly = !plannedDate || !mealType;

  const activeFilterCount = useMemo(
    () => computeActiveFilterCount(filters),
    [filters],
  );

  // Show the curated Discover feed when the user has not typed a query or
  // activated any chip/filter. While the feed is shown the full-list query is
  // disabled (null) to protect the 20/min /api/recipes/search budget.
  const showDiscovery = isBlankBrowseState({
    debouncedQuery,
    activeCuisine: filters.activeCuisine,
    activeDiet: filters.activeDiet,
    activeDifficulty: filters.activeDifficulty,
    curatedOnly: filters.curatedOnly,
    safeForMe: filters.safeForMe,
    pantryMode: filters.pantryMode,
    activeFilterCount,
  });

  // Local search is always primary (still suppressed by the Phase-1 discovery feed).
  const localSearch = useRecipeSearch(showDiscovery ? null : searchParams);

  // "Ideas for you": AI-written idea cards for the current query, requested on
  // demand from the CTA under the local results. Destructured for the same
  // reason as useAddMealPlanItem above — mutate/reset/mutateAsync are stable,
  // the wrapper object is not.
  const {
    data: ideasData,
    isPending: ideasPending,
    error: ideasError,
    mutate: requestIdeas,
    reset: resetIdeas,
  } = useCreateSuggestionListing();
  const { make: makeSuggestion, makingId } = useMakeSuggestionFlow();

  const ideas: Suggestion[] = useMemo(() => ideasData ?? [], [ideasData]);

  // A new query or filter starts local-first — drop ideas written for the
  // previous one.
  useEffect(() => {
    resetIdeas();
  }, [
    debouncedQuery,
    filters.activeCuisine,
    filters.activeDiet,
    filters.advanced.maxPrepTime,
    mealType,
    resetIdeas,
  ]);

  const {
    data: searchData,
    isLoading,
    loadMore,
    isFetchingNextPage,
  } = localSearch;

  const localResults: SearchableRecipe[] = useMemo(
    () => searchData?.results ?? [],
    [searchData],
  );

  const ideasCtaState = resolveIdeasCtaState({
    isPremium,
    pending: ideasPending,
    error: ideasError,
    hasIdeas: ideas.length > 0,
  });
  // Ideas are written for a query — nothing to ask for without one.
  const showIdeasCta = debouncedQuery.length > 0 && ideasCtaState !== "hidden";
  // The daily idea cap can't be retried today, so say so instead of "retry".
  const ideasLimitReached = ideasError?.status === 429;
  const ideasErrorText = ideasLimitReached
    ? "You've reached today's limit for recipe ideas."
    : undefined;

  // Tell screen-reader users the local search results are loading. Delayed
  // 500ms to match the modal-safe pattern (docs/solutions/conventions/on-open-
  // announce-must-delay-past-modal-present-focus-shift-2026-06-25.md) — this
  // screen is only pushed today (its root-modal copy was removed 2026-10-01),
  // where the delay is harmless.
  useDelayedLoadingAnnouncement(isLoading);

  const onPressIdeasCta = useCallback(() => {
    haptics.selection();
    // Ideas are premium — free users get the upgrade hook.
    if (!isPremium) {
      setShowUpgradeModal(true);
      return;
    }
    // The focused CTA swaps to a spinner and then unmounts when the cards
    // land, so screen-reader users need both edges spoken.
    AccessibilityInfo.announceForAccessibility("Finding ideas for you");
    // Ideas honour the same filters as the local search. Empty values are
    // left out (the body's strings are min(1)); a meal type the listing
    // doesn't know is dropped rather than failing the request.
    const ideasMealType = createListingBodySchema.shape.mealType.safeParse(
      mealType || undefined,
    );
    requestIdeas(
      {
        query: debouncedQuery,
        ...(filters.activeCuisine ? { cuisine: filters.activeCuisine } : {}),
        ...(filters.activeDiet ? { diet: filters.activeDiet } : {}),
        ...(ideasMealType.success && ideasMealType.data
          ? { mealType: ideasMealType.data }
          : {}),
        ...(filters.advanced.maxPrepTime
          ? { maxReadyTime: filters.advanced.maxPrepTime }
          : {}),
      },
      {
        onSuccess: (suggestions) => {
          AccessibilityInfo.announceForAccessibility(
            suggestions.length === 0
              ? "No ideas found"
              : `${suggestions.length} recipe idea${suggestions.length === 1 ? "" : "s"}`,
          );
        },
        // Announced here (once per failure) rather than from an effect.
        onError: (error) => {
          AccessibilityInfo.announceForAccessibility(
            error.status === 429
              ? "You've reached today's limit for recipe ideas."
              : "Couldn't come up with ideas.",
          );
        },
      },
    );
  }, [
    haptics,
    isPremium,
    requestIdeas,
    debouncedQuery,
    filters.activeCuisine,
    filters.activeDiet,
    filters.advanced.maxPrepTime,
    mealType,
  ]);

  // A 410 means this idea list expired; clear it so the CTA can re-ask.
  const handleMakeIdea = useCallback(
    (suggestion: Suggestion) => makeSuggestion(suggestion.id, resetIdeas),
    [makeSuggestion, resetIdeas],
  );

  const handleRecipePress = useCallback(
    async (item: SearchableRecipe) => {
      haptics.selection();
      const detailParams = detailParamsForSearchResult(item);
      const numericId = detailParams.recipeId;

      if (item.source === "community") {
        navigation.navigate("FeaturedRecipeDetail", detailParams);
        return;
      }

      // Personal recipe
      if (isBrowseOnly) {
        navigation.navigate("FeaturedRecipeDetail", detailParams);
        return;
      }

      setAddingId(item.id);
      try {
        await addMealPlanItem({
          recipeId: numericId,
          plannedDate,
          mealType,
        });
        // The screen closes, so confirm with a toast (fires its own Success).
        toast.success(formatPlanAddSuccess(plannedDate, mealType));
        navigation.goBack();
      } catch {
        toast.error("Couldn't add the recipe to your plan. Please try again.");
      } finally {
        setAddingId(null);
      }
    },
    [
      haptics,
      toast,
      navigation,
      isBrowseOnly,
      addMealPlanItem,
      plannedDate,
      mealType,
    ],
  );

  const handleFavourite = useCallback(
    (recipeId: number, recipeType: "mealPlan" | "community") => {
      toggleFavourite({ recipeId, recipeType });
    },
    [toggleFavourite],
  );

  // No haptic here: every sheet control that calls this has already ticked
  // (Chip on a selectable press, the sliders on release).
  const handleFiltersChange = useCallback((next: SearchFilters) => {
    setFilters((prev) => ({ ...prev, advanced: next }));
  }, []);

  const handleOpenAdvancedFilters = useCallback(() => {
    filterSheetRef.current?.present();
    setIsFilterSheetOpen(true);
  }, []);

  const handleAddRecipe = useCallback(() => {
    // Root-qualified: this screen is also registered in the Profile
    // and Coach stacks, where a bare "RecipeEntryHub" resolves
    // nowhere. "Main" is visible from all three; `pop: true`
    // returns to the existing Main instead of pushing a second one
    // (see AllConversationsNavigationProp in types/navigation.ts).
    // Adding a recipe from Profile or the Coach therefore switches
    // to Plan (`returnToTab` makes the hub's Back return to the tab
    // it came from, QA sweep #10);
    // `initial: false` keeps Plan home underneath when the Plan
    // stack wasn't mounted yet (otherwise Add Recipe would be its
    // only screen, with no way back to Plan home).
    navigation.navigate(
      "Main",
      {
        screen: "MealPlanTab",
        params: {
          screen: "RecipeEntryHub",
          params: { returnToTab: getSourceTab(navigation) },
          initial: false,
        },
      },
      { pop: true },
    );
  }, [navigation]);

  const handleClearFilters = useCallback(() => {
    haptics.selection();
    setSearchText("");
    setDebouncedQuery("");
    setFilters(DEFAULT_FILTERS);
  }, [haptics]);

  const renderItem = useCallback(
    ({ item }: { item: SearchableRecipe | Suggestion }) => {
      // Idea cards ("Ideas for you" section) carry no `source`.
      if (!("source" in item)) {
        return (
          <SuggestionCard
            suggestion={item}
            making={makingId === item.id}
            onMake={() => handleMakeIdea(item)}
          />
        );
      }
      const recipeKey =
        item.source === "personal"
          ? `mealPlan:${item.id.split(":")[1]}`
          : `community:${item.id.split(":")[1]}`;
      return (
        <UnifiedRecipeCard
          item={item}
          isFavourited={favouriteIdSet.has(recipeKey)}
          onPress={handleRecipePress}
          onFavourite={handleFavourite}
          adding={addingId === item.id}
          browseOnly={isBrowseOnly}
        />
      );
    },
    [
      handleRecipePress,
      handleFavourite,
      addingId,
      isBrowseOnly,
      favouriteIdSet,
      makingId,
      handleMakeIdea,
    ],
  );

  return (
    <View
      testID="recipe-browser-root"
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
      // Android TalkBack background focus trap while the filter sheet is
      // open — see docs/solutions/conventions/
      // in-screen-overlay-needs-android-focus-trap-2026-06-22.md. Unrelated
      // to the pre-existing accessibilityViewIsModal above (an iOS-only prop
      // for a different mechanism); no accessibilityElementsHidden here
      // since that mechanism already traps VoiceOver on this screen.
      importantForAccessibility={
        isFilterSheetOpen ? "no-hide-descendants" : "auto"
      }
    >
      <View
        style={[
          styles.headerAreaOuter,
          { paddingTop: headerHeight + Spacing.sm },
        ]}
      >
        {/* Search bar always visible */}
        <FocusField
          focus={searchFocus}
          testID="recipe-search-bar"
          label={SEARCH_LABEL}
          hasValue={searchText.length > 0}
          labelLeft={SEARCH_LABEL_LEFT}
          style={[
            styles.searchBar,
            {
              backgroundColor: withOpacity(theme.text, 0.06),
              marginHorizontal: Spacing.lg,
            },
          ]}
        >
          <Feather
            name="search"
            size={SEARCH_ICON_SIZE}
            color={theme.textSecondary}
          />
          <FocusTextInput
            focusRing={false}
            onFocus={searchFocus.onFocus}
            onBlur={searchFocus.onBlur}
            style={[styles.searchInput, { color: theme.text }]}
            // The label rests where the placeholder would; it shows once floated.
            placeholder={resolvePlaceholder(
              SEARCH_LABEL,
              "e.g. pasta or high protein",
              shouldFloatLabel(searchFocus.focused, searchText),
            )}
            placeholderTextColor={theme.textSecondary}
            value={searchText}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={handleSubmitSearch}
            accessibilityLabel={SEARCH_LABEL}
          />
          {searchText.length > 0 && (
            <Pressable
              onPress={() => {
                setSearchText("");
                setDebouncedQuery("");
              }}
              style={({ pressed }) => [
                styles.clearSearchButton,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </FocusField>
      </View>
      <Animated.View
        // When the header collapses (opacity interpolates to 0), the invisible
        // chips still intercept taps at the boundary. Flip pointerEvents to
        // "none" once the collapsed bar is visible so cards below receive
        // those taps cleanly. `isBarVisible` transitions at 50% of the
        // collapse threshold (see useScrollLinkedHeader), after which header
        // opacity is < 0.2 — early enough to prevent visible-but-untappable
        // chips, late enough that expanded-state taps are unaffected.
        pointerEvents={isBarVisible ? "none" : "auto"}
        style={[styles.headerArea, headerAnimatedStyle, { overflow: "hidden" }]}
      >
        {/* Filter chips, with Add pinned at the end of the row. The button
            used to sit alone on a row of its own above them (visual QA
            sweep #8). */}
        <RecipeFilterBar
          filters={filters}
          onChange={setFilters}
          activeFilterCount={activeFilterCount}
          onOpenAdvancedFilters={handleOpenAdvancedFilters}
          onAddRecipe={handleAddRecipe}
        />
      </Animated.View>

      {/* AI meal plan summary banner */}
      {planDays && planDays.length > 0 && (
        <View
          style={[
            styles.planBanner,
            { backgroundColor: withOpacity(theme.link, 0.08) },
          ]}
          accessibilityRole="summary"
          accessibilityLabel={planBannerA11yLabel(planDays)}
        >
          <ThemedText style={[styles.planBannerTitle, { color: theme.link }]}>
            AI Meal Plan
          </ThemedText>
          {planDays.map((day) => (
            <View key={day.label} style={styles.planBannerDay}>
              <ThemedText
                style={[
                  styles.planBannerDayLabel,
                  { color: theme.textSecondary },
                ]}
              >
                {day.label}
              </ThemedText>
              {day.meals.map((meal, mi) => (
                <ThemedText
                  key={`${day.label}-${meal.type}-${mi}`}
                  style={[styles.planBannerMeal, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {meal.type}: {meal.title} ({meal.calories} cal)
                </ThemedText>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Results */}
      {showDiscovery ? (
        <RecipeDiscoveryFeed
          onOpenRecipe={handleRecipePress}
          onSeePreset={(key) => {
            haptics.selection();
            if (key === "pantry")
              setFilters((prev) => ({ ...prev, pantryMode: true }));
            else if (key === "featured")
              setFilters((prev) => ({ ...prev, curatedOnly: true }));
            else
              setFilters((prev) => ({
                ...prev,
                advanced: {
                  ...prev.advanced,
                  maxPrepTime: 20,
                  sort: "quickest",
                },
              }));
          }}
          contentBottomInset={bottomBudget}
          onScroll={scrollHandler}
        />
      ) : isLoading ? (
        <SkeletonProvider>
          <SkeletonLoadingRegion
            style={styles.loadingContainer}
            testID="recipe-browser-loading-skeleton"
          >
            <SkeletonBox width="100%" height={64} borderRadius={12} />
            <View style={{ height: Spacing.sm }} />
            <SkeletonBox width="100%" height={64} borderRadius={12} />
            <View style={{ height: Spacing.sm }} />
            <SkeletonBox width="100%" height={64} borderRadius={12} />
          </SkeletonLoadingRegion>
        </SkeletonProvider>
      ) : localResults.length === 0 && ideas.length === 0 ? (
        <View style={styles.emptyContainer}>
          {debouncedQuery ||
          filters.activeCuisine ||
          filters.activeDiet ||
          filters.activeDifficulty ||
          filters.curatedOnly ||
          filters.safeForMe ||
          filters.pantryMode ||
          activeFilterCount > 0 ? (
            <EmptyState
              variant="noResults"
              icon="search"
              title="No recipes match your search"
              description="Try different search terms or clear your filters."
              actionLabel="Clear Filters"
              onAction={handleClearFilters}
            />
          ) : (
            <EmptyState
              variant="firstTime"
              icon="book-open"
              title="No recipes yet"
              description="Create or import a recipe to get started."
            />
          )}
          {showIdeasCta && (
            <OnlineSearchCta
              state={ideasCtaState}
              onPress={onPressIdeasCta}
              errorText={ideasErrorText}
              retryable={!ideasLimitReached}
            />
          )}
        </View>
      ) : (
        <AnimatedSectionList
          {...FLATLIST_DEFAULTS}
          sections={[
            ...(localResults.length > 0
              ? [{ key: "local", title: "From OCRecipes", data: localResults }]
              : []),
            ...(ideas.length > 0
              ? [{ key: "ideas", title: "Ideas for you", data: ideas }]
              : []),
          ]}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          keyExtractor={(item) => {
            const row = item as SearchableRecipe | Suggestion;
            return "source" in row ? row.id : `idea:${row.id}`;
          }}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <ThemedText
              type="caption"
              style={[styles.sectionHeader, { color: theme.textSecondary }]}
            >
              {(section as { title: string }).title}
            </ThemedText>
          )}
          renderSectionFooter={({ section }) =>
            (section as { key: string }).key === "local" && showIdeasCta ? (
              <OnlineSearchCta
                state={ideasCtaState}
                onPress={onPressIdeasCta}
                errorText={ideasErrorText}
                retryable={!ideasLimitReached}
              />
            ) : null
          }
          ItemSeparatorComponent={ItemSeparator}
          onEndReached={loadMore ? () => loadMore() : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator
                style={{ paddingVertical: Spacing.lg }}
                color={theme.link}
              />
            ) : null
          }
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: bottomBudget + Spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomSheetModal
        ref={filterSheetRef}
        snapPoints={["70%"]}
        onChange={handleFilterSheetChange}
        onAnimate={handleFilterSheetAnimate}
        onDismiss={handleFilterSheetClosed}
        {...sheetHostProps}
      >
        <BottomSheetView accessibilityViewIsModal>
          <SearchFilterSheet
            filters={filters.advanced}
            onFiltersChange={handleFiltersChange}
            onReset={() => {
              setFilters((prev) => ({
                ...prev,
                advanced: DEFAULT_FILTERS.advanced,
              }));
            }}
            activeFilterCount={activeFilterCount}
          />
        </BottomSheetView>
      </BottomSheetModal>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerAreaOuter: {
    paddingBottom: Spacing.sm,
  },
  headerArea: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  // Labelled: FocusField makes it 56 tall, which also leaves room for the
  // Clear search button's 44pt box (below), so the bar keeps its height when
  // that button appears on the first keystroke. No vertical padding — the
  // input's own padding puts the value under the floated label.
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  // 44pt touch target for a 16pt icon — a real box, not a hitSlop, which RN
  // clips to the parent's bounds. It fits inside the labelled bar's 56pt
  // height (searchBar above), so the bar keeps its height when it appears.
  // The negative right margin lets the box sit in the bar's right padding;
  // the negative vertical margin keeps it out of the bar's height sum.
  clearSearchButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -Spacing.sm,
    marginRight: -Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    padding: 0,
    ...LABELLED_INPUT_TEXT,
  },
  loadingContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  planBanner: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
  },
  planBannerTitle: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.sm,
  },
  planBannerDay: {
    marginBottom: Spacing.xs,
  },
  planBannerDayLabel: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  planBannerMeal: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    marginLeft: Spacing.sm,
  },
  sectionHeader: {
    fontFamily: FontFamily.semiBold,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
});
