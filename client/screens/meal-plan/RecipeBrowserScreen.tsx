import React, { useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Image,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { Chip } from "@/components/Chip";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  useCatalogSearch,
  useSaveCatalogRecipe,
  useUnifiedRecipes,
  type CatalogSearchResult,
  type CatalogSearchParams,
} from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import { getApiUrl } from "@/lib/query-client";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeBrowserScreenNavigationProp } from "@/types/navigation";
import type { MealPlanRecipe, CommunityRecipe } from "@shared/schema";

const SPOONACULAR_PAGE_SIZE = 20;

type RecipeBrowserRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeBrowser"
>;

// ── Tagged union for merged list ────────────────────────────────────

type TaggedCommunity = CommunityRecipe & { source: "community" };
type TaggedPersonal = MealPlanRecipe & { source: "personal" };
type UnifiedRecipeItem = TaggedCommunity | TaggedPersonal;

// ── Item Separator ──────────────────────────────────────────────────

function ItemSeparator() {
  return <View style={{ height: Spacing.sm }} />;
}

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
  onPress,
  adding,
  browseOnly,
}: {
  item: UnifiedRecipeItem;
  onPress: (item: UnifiedRecipeItem) => void;
  adding: boolean;
  browseOnly: boolean;
}) {
  const { theme } = useTheme();

  const isCommunity = item.source === "community";

  // Time display
  let timeText: string | null = null;
  if (isCommunity) {
    if (item.timeEstimate) timeText = item.timeEstimate;
  } else {
    const total = (item.prepTimeMinutes || 0) + (item.cookTimeMinutes || 0);
    if (total > 0) timeText = `${total} min`;
  }

  // Calories (personal only)
  const caloriesText =
    !isCommunity && item.caloriesPerServing
      ? `${Math.round(parseFloat(item.caloriesPerServing))} cal`
      : null;

  // Button icon: community always browse, personal depends on mode
  const iconName = isCommunity || browseOnly ? "chevron-right" : "plus";

  const imageUri = item.imageUrl
    ? item.imageUrl.startsWith("http")
      ? item.imageUrl
      : `${getApiUrl()}${item.imageUrl}`
    : null;

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
        isCommunity || browseOnly
          ? `View ${item.title}`
          : `Add ${item.title} to meal plan`
      }
    >
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.recipeCardThumbnail} />
      ) : (
        <View
          style={[
            styles.recipeCardThumbnail,
            { backgroundColor: withOpacity(theme.text, 0.08) },
          ]}
        >
          <Feather name="image" size={20} color={theme.textSecondary} />
        </View>
      )}
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
          {isCommunity && (
            <ThemedText
              style={[
                styles.recipeCardMetaText,
                {
                  color: theme.link,
                  marginLeft: timeText ? Spacing.sm : 0,
                },
              ]}
            >
              Community
            </ThemedText>
          )}
        </View>
      </View>
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

// ── Spoonacular Results (shared between footer and empty state) ──────

const SpoonacularResults = React.memo(function SpoonacularResults({
  loading,
  data: spData,
  onAdd,
  addingId,
  browseOnly,
}: {
  loading: boolean;
  data: { results: CatalogSearchResult[] } | undefined;
  onAdd: (item: CatalogSearchResult) => void;
  addingId: string | null;
  browseOnly: boolean;
}) {
  const { theme } = useTheme();

  if (loading) {
    return (
      <View style={styles.footerLoading}>
        <SkeletonBox width="100%" height={64} borderRadius={12} />
        <View style={{ height: Spacing.sm }} />
        <SkeletonBox width="100%" height={64} borderRadius={12} />
      </View>
    );
  }

  if (spData && spData.results.length > 0) {
    return (
      <View>
        <ThemedText
          style={[styles.sectionHeader, { color: theme.textSecondary }]}
        >
          Online Results
        </ThemedText>
        {spData.results.map((item) => (
          <View key={`spoon-${item.id}`}>
            <CatalogCard
              item={item}
              onAdd={onAdd}
              adding={addingId === `catalog-${item.id}`}
              browseOnly={browseOnly}
            />
            <View style={{ height: Spacing.sm }} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <ThemedText
      style={[styles.footerNoResults, { color: theme.textSecondary }]}
    >
      No online results found
    </ThemedText>
  );
});

// ── Catalog Card (kept for Spoonacular fallback) ────────────────────

const CatalogCard = React.memo(function CatalogCard({
  item,
  onAdd,
  adding,
  browseOnly,
}: {
  item: CatalogSearchResult;
  onAdd: (item: CatalogSearchResult) => void;
  adding: boolean;
  browseOnly?: boolean;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={() => onAdd(item)}
      disabled={adding}
      style={[
        styles.recipeCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        browseOnly ? `View ${item.title}` : `Add ${item.title} to meal plan`
      }
    >
      <View style={styles.recipeCardContent}>
        <ThemedText style={styles.recipeCardTitle} numberOfLines={2}>
          {item.title}
        </ThemedText>
        {item.readyInMinutes !== undefined && (
          <View style={styles.recipeCardMeta}>
            <Feather name="clock" size={12} color={theme.textSecondary} />
            <ThemedText
              style={[
                styles.recipeCardMetaText,
                { color: theme.textSecondary },
              ]}
            >
              {item.readyInMinutes} min
            </ThemedText>
          </View>
        )}
      </View>
      <View style={[styles.addButton, { backgroundColor: theme.link }]}>
        {adding ? (
          <ActivityIndicator size="small" color={theme.buttonText} />
        ) : (
          <Feather
            name={browseOnly ? "chevron-right" : "plus"}
            size={18}
            color={theme.buttonText}
          />
        )}
      </View>
    </Pressable>
  );
});

// ── Main Screen ──────────────────────────────────────────────────────

export default function RecipeBrowserScreen() {
  const navigation = useNavigation<RecipeBrowserScreenNavigationProp>();
  const route = useRoute<RecipeBrowserRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const { mealType, plannedDate, searchQuery } = route.params || {};

  const [searchText, setSearchText] = useState(searchQuery || "");
  const [activeCuisine, setActiveCuisine] = useState<string | undefined>();
  const [activeDiet, setActiveDiet] = useState<string | undefined>();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [showSpoonacular, setShowSpoonacular] = useState(false);

  // Debounce search
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery || "");
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    setShowSpoonacular(false);
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

  // Unified local data
  const browseParams = useMemo(
    () => ({
      query: debouncedQuery || undefined,
      cuisine: activeCuisine,
      diet: activeDiet,
    }),
    [debouncedQuery, activeCuisine, activeDiet],
  );

  const { data, isLoading } = useUnifiedRecipes(browseParams);

  // Spoonacular fallback (only when user explicitly triggers it)
  const spoonacularParams: CatalogSearchParams | null = useMemo(() => {
    if (!showSpoonacular || !debouncedQuery) return null;
    return {
      query: debouncedQuery,
      cuisine: activeCuisine,
      diet: activeDiet,
      number: SPOONACULAR_PAGE_SIZE,
    };
  }, [showSpoonacular, debouncedQuery, activeCuisine, activeDiet]);

  const { data: spoonacularData, isLoading: spoonacularLoading } =
    useCatalogSearch(spoonacularParams);

  const saveCatalogMutation = useSaveCatalogRecipe();
  const addItemMutation = useAddMealPlanItem();

  const isBrowseOnly = !plannedDate || !mealType;

  // Merge and sort community + personal recipes
  const allRecipes = useMemo(() => {
    const tagged: UnifiedRecipeItem[] = [
      ...(data?.community || []).map((r) => ({
        ...r,
        source: "community" as const,
      })),
      ...(data?.personal || []).map((r) => ({
        ...r,
        source: "personal" as const,
      })),
    ];
    return tagged.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [data]);

  const handleRecipePress = useCallback(
    async (item: UnifiedRecipeItem) => {
      haptics.selection();

      if (item.source === "community") {
        navigation.navigate("FeaturedRecipeDetail", { recipeId: item.id });
        return;
      }

      // Personal recipe
      if (isBrowseOnly) {
        navigation.navigate("RecipeDetail", { recipeId: item.id });
        return;
      }

      setAddingId(`personal-${item.id}`);
      try {
        await addItemMutation.mutateAsync({
          recipeId: item.id,
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

  const handleAddCatalogRecipe = useCallback(
    async (item: CatalogSearchResult) => {
      haptics.selection();
      setAddingId(`catalog-${item.id}`);
      try {
        const saved = await saveCatalogMutation.mutateAsync(item.id);
        if (isBrowseOnly) {
          navigation.navigate("RecipeDetail", { recipeId: saved.id });
        } else {
          await addItemMutation.mutateAsync({
            recipeId: saved.id,
            plannedDate,
            mealType,
          });
          navigation.goBack();
        }
      } catch {
        // Error handled by mutation
      } finally {
        setAddingId(null);
      }
    },
    [
      haptics,
      saveCatalogMutation,
      addItemMutation,
      plannedDate,
      mealType,
      navigation,
      isBrowseOnly,
    ],
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

  const renderItem = useCallback(
    ({ item }: { item: UnifiedRecipeItem }) => (
      <UnifiedRecipeCard
        item={item}
        onPress={handleRecipePress}
        adding={addingId === `${item.source}-${item.id}`}
        browseOnly={isBrowseOnly}
      />
    ),
    [handleRecipePress, addingId, isBrowseOnly],
  );

  const keyExtractor = useCallback(
    (item: UnifiedRecipeItem) => `${item.source}-${item.id}`,
    [],
  );

  // Spoonacular fallback footer
  const renderFooter = useCallback(() => {
    if (!debouncedQuery) return null;

    return (
      <View style={styles.footerContainer}>
        {!showSpoonacular ? (
          <Pressable
            onPress={() => setShowSpoonacular(true)}
            style={[
              styles.onlineSearchButton,
              { borderColor: withOpacity(theme.text, 0.15) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Search online for more recipes"
          >
            <Feather name="globe" size={16} color={theme.link} />
            <ThemedText
              style={[styles.onlineSearchText, { color: theme.link }]}
            >
              Search online
            </ThemedText>
          </Pressable>
        ) : (
          <SpoonacularResults
            loading={spoonacularLoading}
            data={spoonacularData}
            onAdd={handleAddCatalogRecipe}
            addingId={addingId}
            browseOnly={isBrowseOnly}
          />
        )}
      </View>
    );
  }, [
    debouncedQuery,
    showSpoonacular,
    spoonacularLoading,
    spoonacularData,
    theme,
    handleAddCatalogRecipe,
    addingId,
    isBrowseOnly,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[styles.headerArea, { paddingTop: headerHeight + Spacing.sm }]}
      >
        {/* Search bar */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: withOpacity(theme.text, 0.06) },
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
                setShowSpoonacular(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

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

        {/* Filter chips (always visible) */}
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
          <View style={styles.filterDivider} />
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
        </ScrollView>
      </View>

      {/* Results */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <SkeletonBox width="100%" height={64} borderRadius={12} />
          <View style={{ height: Spacing.sm }} />
          <SkeletonBox width="100%" height={64} borderRadius={12} />
          <View style={{ height: Spacing.sm }} />
          <SkeletonBox width="100%" height={64} borderRadius={12} />
        </View>
      ) : allRecipes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather
            name={debouncedQuery ? "search" : "book-open"}
            size={40}
            color={withOpacity(theme.text, 0.2)}
          />
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            {debouncedQuery
              ? "No matching recipes"
              : "No recipes yet. Create or import one!"}
          </ThemedText>
          {debouncedQuery && (
            <Pressable
              onPress={() => setShowSpoonacular(true)}
              style={[
                styles.onlineSearchButton,
                {
                  borderColor: withOpacity(theme.text, 0.15),
                  marginTop: Spacing.md,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Search online for more recipes"
            >
              <Feather name="globe" size={16} color={theme.link} />
              <ThemedText
                style={[styles.onlineSearchText, { color: theme.link }]}
              >
                Search online
              </ThemedText>
            </Pressable>
          )}
          {/* Show spoonacular results inline in empty state */}
          {showSpoonacular && debouncedQuery && (
            <View style={styles.emptySpoonacular}>
              <SpoonacularResults
                loading={spoonacularLoading}
                data={spoonacularData}
                onAdd={handleAddCatalogRecipe}
                addingId={addingId}
                browseOnly={isBrowseOnly}
              />
            </View>
          )}
        </View>
      ) : (
        <FlatList
          data={allRecipes}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          }}
          ItemSeparatorComponent={ItemSeparator}
          ListFooterComponent={renderFooter}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  },
  headerActionText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  filterRow: {
    gap: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  filterDivider: {
    width: 1,
    height: 20,
    marginHorizontal: Spacing.xs,
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
  },
  recipeCardMetaText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    marginTop: Spacing.md,
    lineHeight: 20,
  },
  emptySpoonacular: {
    width: "100%",
    marginTop: Spacing.lg,
  },
  footerContainer: {
    paddingTop: Spacing.lg,
  },
  onlineSearchButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
    alignSelf: "center",
  },
  onlineSearchText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  sectionHeader: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  footerLoading: {
    paddingTop: Spacing.sm,
  },
  footerNoResults: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
});
