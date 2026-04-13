import React, { useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  FlatList,
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
import Animated from "react-native-reanimated";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useScrollLinkedHeader } from "@/hooks/useScrollLinkedHeader";
import { useAccessibility } from "@/hooks/useAccessibility";

import { ThemedText } from "@/components/ThemedText";
import { Chip } from "@/components/Chip";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { EmptyState } from "@/components/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
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
import {
  SearchFilterSheet,
  type SearchFilters,
} from "@/components/meal-plan/SearchFilterSheet";
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

  const handleFavourite = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation();
      haptics.impact();
      const numericId = parseInt(item.id.split(":")[1], 10);
      const recipeType = item.source === "community" ? "community" : "mealPlan";
      onFavourite(numericId, recipeType);
    },
    [haptics, onFavourite, item.id, item.source],
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

  return (
    <Pressable
      onPress={() => onPress(item)}
      disabled={adding}
      style={[
        styles.recipeCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        isCommunity || isOnline || browseOnly
          ? `View ${item.title}`
          : `Add ${item.title} to meal plan`
      }
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
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            isFavourited ? "Remove from favourites" : "Add to favourites"
          }
          style={{ marginRight: Spacing.sm }}
        >
          <Ionicons
            name={isFavourited ? "heart" : "heart-outline"}
            size={20}
            color={isFavourited ? theme.error : theme.textSecondary}
          />
        </Pressable>
      )}
      <View style={[styles.addButton, { backgroundColor: theme.link }]}>
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

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList,
) as typeof FlatList;

export default function RecipeBrowserScreen() {
  const navigation = useNavigation<RecipeBrowserScreenNavigationProp>();
  const route = useRoute<RecipeBrowserRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();

  const { scrollHandler, headerAnimatedStyle } = useScrollLinkedHeader({
    expandedHeight: RECIPE_HEADER_EXPANDED,
    collapsedHeight: RECIPE_HEADER_COLLAPSED,
    collapseThreshold: RECIPE_COLLAPSE_THRESHOLD,
    reducedMotion,
  });

  const { mealType, plannedDate, searchQuery, planDays } = route.params || {};

  const [searchText, setSearchText] = useState(searchQuery || "");
  const [activeCuisine, setActiveCuisine] = useState<string | undefined>();
  const [activeDiet, setActiveDiet] = useState<string | undefined>();
  // TODO: Re-add "Safe for me" allergen filter once search service supports it
  const [addingId, setAddingId] = useState<string | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<SearchFilters>({
    sort: "relevance",
    maxPrepTime: undefined,
    maxCalories: undefined,
    minProtein: undefined,
    source: "all",
  });
  const [activeDifficulty, setActiveDifficulty] = useState<
    string | undefined
  >();
  const [pantryMode, setPantryMode] = useState(false);
  const filterSheetRef = React.useRef<BottomSheetModal>(null);

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
      cuisine: activeCuisine,
      diet: activeDiet,
      mealType: mealType || undefined,
      difficulty: activeDifficulty,
      pantry: pantryMode || undefined,
      sort: advancedFilters.sort,
      source: advancedFilters.source,
      maxPrepTime: advancedFilters.maxPrepTime,
      maxCalories: advancedFilters.maxCalories,
      minProtein: advancedFilters.minProtein,
    }),
    [
      debouncedQuery,
      activeCuisine,
      activeDiet,
      mealType,
      activeDifficulty,
      pantryMode,
      advancedFilters,
    ],
  );

  const {
    data: searchData,
    isLoading,
    loadMore,
    isFetchingNextPage,
  } = useRecipeSearch(searchParams);

  const addItemMutation = useAddMealPlanItem();
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

  const allRecipes: SearchableRecipe[] = useMemo(
    () => searchData?.results ?? [],
    [searchData],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (advancedFilters.sort !== "relevance") count++;
    if (advancedFilters.maxPrepTime !== undefined) count++;
    if (advancedFilters.maxCalories !== undefined) count++;
    if (advancedFilters.minProtein !== undefined) count++;
    if (advancedFilters.source !== "all") count++;
    return count;
  }, [advancedFilters]);

  const handleRecipePress = useCallback(
    async (item: SearchableRecipe) => {
      haptics.selection();
      const numericId = parseInt(item.id.split(":")[1], 10);

      if (item.source === "community") {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: numericId,
          recipeType: "community",
        });
        return;
      }

      if (item.source === "spoonacular") {
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
        await addItemMutation.mutateAsync({
          recipeId: numericId,
          plannedDate,
          mealType,
        });
        navigation.goBack();
      } catch {
        // Error handled by mutation
      } finally {
        setAddingId(null);
      }
    },
    [haptics, navigation, isBrowseOnly, addItemMutation, plannedDate, mealType],
  );

  const handleFavourite = useCallback(
    (recipeId: number, recipeType: "mealPlan" | "community") => {
      toggleFavourite({ recipeId, recipeType });
    },
    [toggleFavourite],
  );

  const handleToggleCuisine = useCallback(
    (cuisine: string) => {
      haptics.selection();
      setActiveCuisine((prev) => (prev === cuisine ? undefined : cuisine));
    },
    [haptics],
  );

  const handleToggleDiet = useCallback(
    (diet: string) => {
      haptics.selection();
      setActiveDiet((prev) => (prev === diet ? undefined : diet));
    },
    [haptics],
  );

  const handleClearFilters = useCallback(() => {
    haptics.selection();
    setSearchText("");
    setDebouncedQuery("");
    setActiveCuisine(undefined);
    setActiveDiet(undefined);
    setActiveDifficulty(undefined);
    setPantryMode(false);
    setAdvancedFilters({
      sort: "relevance",
      maxPrepTime: undefined,
      maxCalories: undefined,
      minProtein: undefined,
      source: "all",
    });
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

  const keyExtractor = useCallback((item: SearchableRecipe) => item.id, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
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
            accessibilityLabel="Search recipes"
          />
          {searchText.length > 0 && (
            <Pressable
              onPress={() => {
                setSearchText("");
                setDebouncedQuery("");
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
      <Animated.View
        style={[styles.headerArea, headerAnimatedStyle, { overflow: "hidden" }]}
      >
        {/* Action row (no tabs) */}
        <View style={styles.actionRow}>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => navigation.navigate("RecipeCreate", {})}
            style={[
              styles.headerAction,
              { borderColor: withOpacity(theme.text, 0.15) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create recipe"
          >
            <Feather name="edit-3" size={14} color={theme.link} />
            <ThemedText
              style={[styles.headerActionText, { color: theme.link }]}
            >
              Create
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("RecipeImport")}
            style={[
              styles.headerAction,
              {
                borderColor: withOpacity(theme.text, 0.15),
                marginLeft: Spacing.xs,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Import recipe from URL"
          >
            <Feather name="link" size={14} color={theme.link} />
            <ThemedText
              style={[styles.headerActionText, { color: theme.link }]}
            >
              Import
            </ThemedText>
          </Pressable>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {CUISINE_PRESETS.map((c) => (
            <Chip
              key={c}
              label={c}
              variant="filter"
              selected={activeCuisine === c}
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
              selected={activeDiet === d}
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
              selected={activeDifficulty === d.toLowerCase()}
              onPress={() => {
                haptics.selection();
                setActiveDifficulty((prev) =>
                  prev === d.toLowerCase() ? undefined : d.toLowerCase(),
                );
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
            selected={pantryMode}
            onPress={() => {
              haptics.selection();
              setPantryMode((prev) => !prev);
            }}
            accessibilityLabel="Filter recipes by pantry items"
          />
          <Chip
            label="Quick meals"
            variant="filter"
            selected={advancedFilters.maxPrepTime === 30}
            onPress={() => {
              haptics.selection();
              setAdvancedFilters((prev) => ({
                ...prev,
                maxPrepTime: prev.maxPrepTime === 30 ? undefined : 30,
              }));
            }}
            accessibilityLabel="Filter quick meals under 30 minutes"
          />
          <Pressable
            onPress={() => filterSheetRef.current?.present()}
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
                style={[styles.filterBadge, { backgroundColor: theme.link }]}
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
      {isLoading ? (
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
      ) : allRecipes.length === 0 ? (
        <View style={styles.emptyContainer}>
          {debouncedQuery ||
          activeCuisine ||
          activeDiet ||
          activeDifficulty ||
          pantryMode ||
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
        </View>
      ) : (
        <AnimatedFlatList
          {...FLATLIST_DEFAULTS}
          data={allRecipes}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          }}
          ItemSeparatorComponent={ItemSeparator}
          scrollEventThrottle={16}
          onScroll={scrollHandler}
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
        />
      )}

      <BottomSheetModal
        ref={filterSheetRef}
        snapPoints={["70%"]}
        backdropComponent={(props: BottomSheetBackdropProps) => (
          <BottomSheetBackdrop
            {...props}
            disappearsOnIndex={-1}
            appearsOnIndex={0}
          />
        )}
        backgroundStyle={{ backgroundColor: theme.backgroundRoot }}
        handleIndicatorStyle={{ backgroundColor: withOpacity(theme.text, 0.3) }}
      >
        <BottomSheetView>
          <SearchFilterSheet
            filters={advancedFilters}
            onFiltersChange={setAdvancedFilters}
            onReset={() => {
              setAdvancedFilters({
                sort: "relevance",
                maxPrepTime: undefined,
                maxCalories: undefined,
                minProtein: undefined,
                source: "all",
              });
            }}
            activeFilterCount={activeFilterCount}
          />
        </BottomSheetView>
      </BottomSheetModal>
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
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
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
});
