import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  TextInput,
  SectionList,
  Pressable,
  ActivityIndicator,
  ScrollView,
  type GestureResponderEvent,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Feather, Ionicons } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import Animated from "react-native-reanimated";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useScrollLinkedHeader } from "@/hooks/useScrollLinkedHeader";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import { useSheetHostProps } from "@/hooks/useSheetHostProps";

import { ThemedText } from "@/components/ThemedText";
import { Chip } from "@/components/Chip";
import { RecipeAllergenLabel } from "@/components/RecipeAllergenLabel";
import { toRecipeAllergenA11ySuffix } from "@/components/recipe-allergen-label-utils";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { EmptyState } from "@/components/EmptyState";
import { useTheme } from "@/hooks/useTheme";
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
import { useCatalogSearch } from "@/hooks/useCatalogSearch";
import { useCatalogConfig } from "@/hooks/useCatalogConfig";
import {
  SearchFilterSheet,
  type SearchFilters,
} from "@/components/meal-plan/SearchFilterSheet";
import { OnlineSearchCta } from "@/components/meal-plan/OnlineSearchCta";
import { UpgradeModal } from "@/components/UpgradeModal";
import { usePremiumContext } from "@/context/PremiumContext";
import { RecipeDiscoveryFeed } from "@/components/meal-plan/RecipeDiscoveryFeed";
import { isBlankBrowseState } from "@/components/meal-plan/recipe-discovery-utils";
import {
  shouldGatePremiumSource,
  isQuotaExceededError,
  resolveOnlineCtaState,
  computeActiveFilterCount,
  DEFAULT_FILTERS,
  type RecipeFilters,
} from "@/screens/meal-plan/recipe-browser-utils";
import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";
import { resolveImageUrl } from "@/lib/query-client";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeBrowserScreenNavigationProp } from "@/types/navigation";
import { planBannerA11yLabel } from "@/components/coach/coach-chat-utils";

const RECIPE_HEADER_EXPANDED = 160;
const RECIPE_HEADER_COLLAPSED = 0;
const RECIPE_COLLAPSE_THRESHOLD = 100;

type RecipeBrowserRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeBrowser"
>;

// ── Item Separator ──────────────────────────────────────────────────

const ItemSeparator = React.memo(function ItemSeparator() {
  return <View style={{ height: Spacing.sm }} />;
});

const CUISINE_PRESETS = [
  "Italian",
  "Mexican",
  "Asian",
  "Mediterranean",
  "American",
  "Indian",
];
const DIET_PRESETS = ["Vegetarian", "Vegan", "Gluten Free", "Keto", "Paleo"];

// ── Unified Recipe Card ─────────────────────────────────────────────

const UnifiedRecipeCard = React.memo(function UnifiedRecipeCard({
  item,
  isFavourited,
  onPress,
  onFavourite,
  adding,
  browseOnly,
}: {
  item: SearchableRecipe;
  isFavourited: boolean;
  onPress: (item: SearchableRecipe) => void;
  onFavourite: (recipeId: number, recipeType: "mealPlan" | "community") => void;
  adding: boolean;
  browseOnly: boolean;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const triggerFavourite = useCallback(() => {
    haptics.impact();
    const numericId = parseInt(item.id.split(":")[1], 10);
    const recipeType = item.source === "community" ? "community" : "mealPlan";
    onFavourite(numericId, recipeType);
  }, [haptics, onFavourite, item.id, item.source]);

  const handleFavourite = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation();
      triggerFavourite();
    },
    [triggerFavourite],
  );

  // The card Pressable is accessible by default, which collapses its whole
  // subtree into a single VoiceOver/TalkBack focus stop — the nested
  // favourite Pressable below is never independently reachable. Expose it as
  // an accessibilityAction on the card instead (same pattern as
  // BatchSummaryScreen's BatchItemRow) so the primary "open recipe" label
  // stays the single focus stop while the favourite toggle is still
  // independently activatable via the screen reader's actions/rotor.
  const accessibilityActions = useMemo(
    () =>
      item.source === "spoonacular"
        ? undefined
        : [
            {
              name: "toggleFavourite",
              label: isFavourited
                ? "Remove from favourites"
                : "Add to favourites",
            },
          ],
    [item.source, isFavourited],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "toggleFavourite") {
        triggerFavourite();
      }
    },
    [triggerFavourite],
  );

  const isCommunity = item.source === "community";
  const isOnline = item.source === "spoonacular";

  // Time display
  const timeText = item.totalTimeMinutes
    ? `${item.totalTimeMinutes} min`
    : null;

  // Calories
  const caloriesText = item.caloriesPerServing
    ? `${Math.round(item.caloriesPerServing)} cal`
    : null;

  // Button icon: community/online always browse, personal depends on mode
  const iconName =
    isCommunity || isOnline || browseOnly ? "chevron-right" : "plus";

  const imageUri = resolveImageUrl(item.imageUrl);

  // Source badge label
  const sourceBadgeLabel = isOnline
    ? "Online"
    : isCommunity
      ? "Community"
      : "My Recipe";
  const sourceBadgeColor = isOnline
    ? theme.textSecondary
    : isCommunity
      ? theme.link
      : (theme.success ?? theme.link);

  // The card Pressable is accessible={true}, which collapses its whole subtree
  // into a single focus stop — the nested RecipeAllergenLabel's own container
  // label is never reached by VoiceOver/TalkBack (see the toast-action-button
  // precedent). Fold the recipe's derived allergens into the card's own label
  // so the safety-critical allergen info still reaches screen-reader users; the
  // visible chips (RecipeAllergenLabel below) remain for sighted users.
  const allergenA11ySuffix = toRecipeAllergenA11ySuffix(item.allergens);
  const baseA11yLabel =
    isCommunity || isOnline || browseOnly
      ? `View ${item.title}`
      : `Add ${item.title} to meal plan`;

  return (
    <Pressable
      onPress={() => onPress(item)}
      disabled={adding}
      style={[
        styles.recipeCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: adding }}
      accessibilityLabel={`${baseA11yLabel}${allergenA11ySuffix}`}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
    >
      <FallbackImage
        source={{ uri: imageUri ?? undefined }}
        style={styles.recipeCardThumbnail}
        fallbackStyle={{ backgroundColor: withOpacity(theme.text, 0.08) }}
        fallbackIcon="image"
        fallbackIconSize={20}
        accessible={false}
      />
      <View style={styles.recipeCardContent}>
        <ThemedText style={styles.recipeCardTitle} numberOfLines={2}>
          {item.title}
        </ThemedText>
        <RecipeAllergenLabel allergens={item.allergens} />
        <View style={styles.recipeCardMeta}>
          {timeText && (
            <>
              <Feather name="clock" size={12} color={theme.textSecondary} />
              <ThemedText
                style={[
                  styles.recipeCardMetaText,
                  { color: theme.textSecondary },
                ]}
              >
                {timeText}
              </ThemedText>
            </>
          )}
          {caloriesText && (
            <ThemedText
              style={[
                styles.recipeCardMetaText,
                {
                  color: theme.textSecondary,
                  marginLeft: timeText ? Spacing.sm : 0,
                },
              ]}
            >
              {caloriesText}
            </ThemedText>
          )}
          <View
            style={[
              styles.sourceBadge,
              {
                backgroundColor: withOpacity(sourceBadgeColor, 0.12),
                marginLeft: timeText || caloriesText ? Spacing.sm : 0,
              },
            ]}
          >
            <ThemedText
              style={[styles.sourceBadgeText, { color: sourceBadgeColor }]}
            >
              {sourceBadgeLabel}
            </ThemedText>
          </View>
        </View>
      </View>
      {item.source !== "spoonacular" && (
        <Pressable
          onPress={handleFavourite}
          accessibilityRole="button"
          accessibilityLabel={
            isFavourited ? "Remove from favourites" : "Add to favourites"
          }
          style={{
            width: 44,
            height: 44,
            justifyContent: "center",
            alignItems: "center",
            marginRight: Spacing.sm,
          }}
        >
          <Ionicons
            name={isFavourited ? "heart" : "heart-outline"}
            size={20}
            color={isFavourited ? theme.error : theme.textSecondary}
          />
        </Pressable>
      )}
      <View style={[styles.addButton, { backgroundColor: theme.accentSolid }]}>
        {adding ? (
          <ActivityIndicator size="small" color={theme.buttonText} />
        ) : (
          <Feather name={iconName} size={18} color={theme.buttonText} />
        )}
      </View>
    </Pressable>
  );
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
  const insets = useSafeAreaInsets();
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
  // accessibilityViewIsModal on the screen's own root View below). Opened
  // synchronously alongside .present() where the filter icon is pressed;
  // released only once BottomSheetModal's own onDismiss confirms the sheet
  // has fully closed (post close-animation, the same asymmetric bias
  // useSheetBackHandler uses) — never released early.
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

  const catalogConfig = useCatalogConfig();
  // Only treat the catalog as disabled once the probe has confirmed it (avoid
  // hiding the CTA during the initial load); undefined while loading → shown.
  const catalogDisabled = catalogConfig.data?.enabled === false;

  const [onlineRequested, setOnlineRequested] = useState(false);
  // A new query starts local-first — reset any prior online request.
  useEffect(() => {
    setOnlineRequested(false);
  }, [debouncedQuery]);

  // Local search is always primary (still suppressed by the Phase-1 discovery feed).
  const localSearch = useRecipeSearch(showDiscovery ? null : searchParams);
  const catalogEnabled =
    onlineRequested &&
    isPremium &&
    !catalogDisabled &&
    debouncedQuery.length > 0;
  const catalogSearch = useCatalogSearch(searchParams, catalogEnabled);

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
  const onlineResults: SearchableRecipe[] = useMemo(
    () => catalogSearch.data?.results ?? [],
    [catalogSearch.data],
  );
  const quotaExhausted = isQuotaExceededError(catalogSearch.error);

  const ctaState = resolveOnlineCtaState({
    catalogDisabled,
    isPremium,
    hasQuery: debouncedQuery.length > 0,
    onlineRequested,
    onlineLoading: catalogSearch.isLoading,
    quotaExhausted,
  });

  // Announce the online-search error to screen readers (restores the a11y
  // announcement removed with the old source-toggle branch). Imperative + ref-
  // guarded so it fires once per transition into the error state — works on iOS
  // and Android, and avoids the accessibilityLiveRegion double-announce gotcha.
  const announcedOnlineErrorRef = React.useRef(false);
  useEffect(() => {
    if (ctaState !== "quota-exhausted") {
      announcedOnlineErrorRef.current = false;
      return;
    }
    if (announcedOnlineErrorRef.current) return;
    AccessibilityInfo.announceForAccessibility(
      "Online search is temporarily unavailable",
    );
    announcedOnlineErrorRef.current = true;
  }, [ctaState]);

  const onPressOnlineCta = useCallback(() => {
    haptics.selection();
    // Reuse the shared premium gate (spec §5.4) — free users get the upgrade hook.
    if (shouldGatePremiumSource("spoonacular", isPremium)) {
      setShowUpgradeModal(true);
      return;
    }
    setOnlineRequested(true);
  }, [haptics, isPremium]);

  const handleRecipePress = useCallback(
    async (item: SearchableRecipe) => {
      haptics.selection();
      const numericId = parseInt(item.id.split(":")[1], 10);

      if (item.source === "community" || item.source === "spoonacular") {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: numericId,
          recipeType: "community",
        });
        return;
      }

      // Personal recipe
      if (isBrowseOnly) {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: numericId,
          recipeType: "mealPlan",
        });
        return;
      }

      setAddingId(item.id);
      try {
        await addMealPlanItem({
          recipeId: numericId,
          plannedDate,
          mealType,
        });
        navigation.goBack();
      } catch {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
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

  // Gate the "Online" (Spoonacular) source behind premium. When a free user
  // selects it, surface the upgrade prompt and keep the source unchanged so
  // the filter state stays honest. Premium users proceed normally.
  const handleFiltersChange = useCallback(
    (next: SearchFilters) => {
      if (shouldGatePremiumSource(next.source, isPremium)) {
        haptics.selection();
        setShowUpgradeModal(true);
        return;
      }
      setFilters((prev) => ({ ...prev, advanced: next }));
    },
    [isPremium, haptics],
  );

  const handleToggleCuisine = useCallback(
    (cuisine: string) => {
      haptics.selection();
      setFilters((prev) => ({
        ...prev,
        activeCuisine: prev.activeCuisine === cuisine ? undefined : cuisine,
      }));
    },
    [haptics],
  );

  const handleToggleDiet = useCallback(
    (diet: string) => {
      haptics.selection();
      setFilters((prev) => ({
        ...prev,
        activeDiet: prev.activeDiet === diet ? undefined : diet,
      }));
    },
    [haptics],
  );

  const handleClearFilters = useCallback(() => {
    haptics.selection();
    setSearchText("");
    setDebouncedQuery("");
    setFilters(DEFAULT_FILTERS);
  }, [haptics]);

  const renderItem = useCallback(
    ({ item }: { item: SearchableRecipe }) => {
      const recipeKey =
        item.source === "personal"
          ? `mealPlan:${item.id.split(":")[1]}`
          : item.source === "community"
            ? `community:${item.id.split(":")[1]}`
            : null;
      return (
        <UnifiedRecipeCard
          item={item}
          isFavourited={recipeKey !== null && favouriteIdSet.has(recipeKey)}
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
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: withOpacity(theme.text, 0.06),
              marginHorizontal: Spacing.lg,
            },
          ]}
        >
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search recipes..."
            placeholderTextColor={theme.textSecondary}
            value={searchText}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={handleSubmitSearch}
            accessibilityLabel="Search recipes"
          />
          {searchText.length > 0 && (
            <Pressable
              onPress={() => {
                setSearchText("");
                setDebouncedQuery("");
              }}
              style={styles.clearSearchButton}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
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
        {/* Action row (no tabs) */}
        <View style={styles.actionRow}>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => navigation.navigate("RecipeEntryHub", {})}
            style={[
              styles.headerAction,
              { borderColor: withOpacity(theme.text, 0.15) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add recipe"
          >
            <Feather name="plus" size={14} color={theme.link} />
            <ThemedText
              style={[styles.headerActionText, { color: theme.link }]}
            >
              Add
            </ThemedText>
          </Pressable>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Chip
            label="Curated"
            variant="filter"
            selected={filters.curatedOnly}
            onPress={() => {
              haptics.selection();
              setFilters((prev) => ({
                ...prev,
                curatedOnly: !prev.curatedOnly,
              }));
            }}
            accessibilityLabel="Filter curated recipes only"
          />
          <Chip
            label="Safe for me"
            variant="filter"
            selected={filters.safeForMe}
            onPress={() => {
              haptics.selection();
              setFilters((prev) => ({
                ...prev,
                safeForMe: !prev.safeForMe,
              }));
            }}
            accessibilityLabel="Filter recipes safe for my allergies"
          />
          <View
            style={[
              styles.filterDivider,
              { backgroundColor: withOpacity(theme.text, 0.15) },
            ]}
          />
          {CUISINE_PRESETS.map((c) => (
            <Chip
              key={c}
              label={c}
              variant="filter"
              selected={filters.activeCuisine === c}
              onPress={() => handleToggleCuisine(c)}
              accessibilityLabel={`Filter by ${c}`}
            />
          ))}
          <View
            style={[
              styles.filterDivider,
              { backgroundColor: withOpacity(theme.text, 0.15) },
            ]}
          />
          {DIET_PRESETS.map((d) => (
            <Chip
              key={d}
              label={d}
              variant="filter"
              selected={filters.activeDiet === d}
              onPress={() => handleToggleDiet(d)}
              accessibilityLabel={`Filter by ${d}`}
            />
          ))}
          <View
            style={[
              styles.filterDivider,
              { backgroundColor: withOpacity(theme.text, 0.15) },
            ]}
          />
          {["Easy", "Medium", "Hard"].map((d) => (
            <Chip
              key={`diff-${d}`}
              label={d}
              variant="filter"
              selected={filters.activeDifficulty === d.toLowerCase()}
              onPress={() => {
                haptics.selection();
                setFilters((prev) => ({
                  ...prev,
                  activeDifficulty:
                    prev.activeDifficulty === d.toLowerCase()
                      ? undefined
                      : d.toLowerCase(),
                }));
              }}
              accessibilityLabel={`Filter by ${d} difficulty`}
            />
          ))}
          <View
            style={[
              styles.filterDivider,
              { backgroundColor: withOpacity(theme.text, 0.15) },
            ]}
          />
          <Chip
            label="From my pantry"
            variant="filter"
            selected={filters.pantryMode}
            onPress={() => {
              haptics.selection();
              setFilters((prev) => ({
                ...prev,
                pantryMode: !prev.pantryMode,
              }));
            }}
            accessibilityLabel="Filter recipes by pantry items"
          />
          <Chip
            label="Quick meals"
            variant="filter"
            selected={filters.advanced.maxPrepTime === 30}
            onPress={() => {
              haptics.selection();
              setFilters((prev) => ({
                ...prev,
                advanced: {
                  ...prev.advanced,
                  maxPrepTime:
                    prev.advanced.maxPrepTime === 30 ? undefined : 30,
                },
              }));
            }}
            accessibilityLabel="Filter quick meals under 30 minutes"
          />
          <Pressable
            onPress={() => {
              filterSheetRef.current?.present();
              setIsFilterSheetOpen(true);
            }}
            style={[
              styles.filterIconButton,
              { borderColor: withOpacity(theme.text, 0.15) },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Advanced filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
          >
            <Feather name="sliders" size={16} color={theme.link} />
            {activeFilterCount > 0 && (
              <View
                style={[
                  styles.filterBadge,
                  { backgroundColor: theme.accentSolid },
                ]}
              >
                <ThemedText
                  style={[styles.filterBadgeText, { color: theme.buttonText }]}
                >
                  {activeFilterCount}
                </ThemedText>
              </View>
            )}
          </Pressable>
        </ScrollView>
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
          contentBottomInset={insets.bottom}
        />
      ) : isLoading ? (
        <SkeletonProvider>
          <View
            style={styles.loadingContainer}
            accessibilityLabel="Loading..."
            accessibilityElementsHidden
          >
            <SkeletonBox width="100%" height={64} borderRadius={12} />
            <View style={{ height: Spacing.sm }} />
            <SkeletonBox width="100%" height={64} borderRadius={12} />
            <View style={{ height: Spacing.sm }} />
            <SkeletonBox width="100%" height={64} borderRadius={12} />
          </View>
        </SkeletonProvider>
      ) : localResults.length === 0 && onlineResults.length === 0 ? (
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
          {ctaState !== "hidden" && (
            <OnlineSearchCta
              state={ctaState}
              onPress={onPressOnlineCta}
              onRetry={() => void catalogSearch.refetch()}
            />
          )}
        </View>
      ) : (
        <AnimatedSectionList
          {...FLATLIST_DEFAULTS}
          sections={[
            { key: "local", title: "From OCRecipes", data: localResults },
            ...(onlineResults.length > 0
              ? [
                  {
                    key: "web",
                    title: "From the web · Spoonacular",
                    data: onlineResults,
                  },
                ]
              : []),
          ]}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          keyExtractor={(item) => (item as SearchableRecipe).id}
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
            (section as { key: string }).key === "local" &&
            ctaState !== "hidden" ? (
              <OnlineSearchCta
                state={ctaState}
                onPress={onPressOnlineCta}
                onRetry={() => void catalogSearch.refetch()}
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
            paddingBottom: insets.bottom + Spacing.xl,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    // Room for the Clear search button's 44pt box (below) without the bar
    // changing height when that button appears on the first keystroke.
    minHeight: 44,
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  // 44pt touch target for a 16pt icon. A hitSlop can't do it here: RN clips
  // hitSlop to the parent's bounds, and the bar is only ~36pt of content +
  // padding. The negative margins let the box fill the bar's padding instead
  // of growing it (bar stays at its 44pt minHeight).
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
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  headerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
    minHeight: 44,
  },
  headerActionText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  filterRow: {
    gap: Spacing.xs,
    paddingBottom: Spacing.xs,
    alignItems: "center",
  },
  filterDivider: {
    width: 1,
    height: 20,
    marginHorizontal: Spacing.xs,
  },
  filterIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.semiBold,
  },
  recipeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
  },
  recipeCardThumbnail: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  recipeCardContent: {
    flex: 1,
    marginRight: Spacing.md,
  },
  recipeCardTitle: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
    marginBottom: 2,
  },
  recipeCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    flexWrap: "wrap",
  },
  recipeCardMetaText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  sourceBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
    alignSelf: "flex-start",
  },
  sourceBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
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
