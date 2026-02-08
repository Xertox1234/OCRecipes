import React, { useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  ScrollView,
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
  useUserMealPlanRecipes,
  type CatalogSearchResult,
  type CatalogSearchParams,
} from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeBrowserScreenNavigationProp } from "@/types/navigation";
import type { MealPlanRecipe } from "@shared/schema";

type RecipeBrowserRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeBrowser"
>;

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

// ── Catalog Card ─────────────────────────────────────────────────────

const CatalogCard = React.memo(function CatalogCard({
  item,
  onAdd,
  adding,
}: {
  item: CatalogSearchResult;
  onAdd: (item: CatalogSearchResult) => void;
  adding: boolean;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.recipeCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
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
      <Pressable
        onPress={() => onAdd(item)}
        disabled={adding}
        style={[styles.addButton, { backgroundColor: theme.link }]}
        accessibilityRole="button"
        accessibilityLabel={`Add ${item.title} to meal plan`}
      >
        {adding ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Feather name="plus" size={18} color="#FFFFFF" />
        )}
      </Pressable>
    </View>
  );
});

// ── My Recipe Card ───────────────────────────────────────────────────

const MyRecipeCard = React.memo(function MyRecipeCard({
  recipe,
  onAdd,
  adding,
}: {
  recipe: MealPlanRecipe;
  onAdd: (recipe: MealPlanRecipe) => void;
  adding: boolean;
}) {
  const { theme } = useTheme();
  const totalTime =
    (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0);

  return (
    <View
      style={[
        styles.recipeCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      <View style={styles.recipeCardContent}>
        <ThemedText style={styles.recipeCardTitle} numberOfLines={2}>
          {recipe.title}
        </ThemedText>
        <View style={styles.recipeCardMeta}>
          {totalTime > 0 && (
            <>
              <Feather name="clock" size={12} color={theme.textSecondary} />
              <ThemedText
                style={[
                  styles.recipeCardMetaText,
                  { color: theme.textSecondary },
                ]}
              >
                {totalTime} min
              </ThemedText>
            </>
          )}
          {recipe.caloriesPerServing && (
            <ThemedText
              style={[
                styles.recipeCardMetaText,
                {
                  color: theme.textSecondary,
                  marginLeft: totalTime > 0 ? Spacing.sm : 0,
                },
              ]}
            >
              {Math.round(parseFloat(recipe.caloriesPerServing))} cal
            </ThemedText>
          )}
        </View>
      </View>
      <Pressable
        onPress={() => onAdd(recipe)}
        disabled={adding}
        style={[styles.addButton, { backgroundColor: theme.link }]}
        accessibilityRole="button"
        accessibilityLabel={`Add ${recipe.title} to meal plan`}
      >
        {adding ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Feather name="plus" size={18} color="#FFFFFF" />
        )}
      </Pressable>
    </View>
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

  const { mealType, plannedDate } = route.params || {};

  const [tab, setTab] = useState<"catalog" | "my">("catalog");
  const [searchText, setSearchText] = useState("");
  const [activeCuisine, setActiveCuisine] = useState<string | undefined>();
  const [activeDiet, setActiveDiet] = useState<string | undefined>();
  const [addingId, setAddingId] = useState<number | null>(null);

  // Debounce search
  const [debouncedQuery, setDebouncedQuery] = useState("");
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

  const searchParams: CatalogSearchParams | null = useMemo(() => {
    if (!debouncedQuery) return null;
    return {
      query: debouncedQuery,
      cuisine: activeCuisine,
      diet: activeDiet,
      number: 20,
    };
  }, [debouncedQuery, activeCuisine, activeDiet]);

  const { data: catalogData, isLoading: catalogLoading } = useCatalogSearch(
    tab === "catalog" ? searchParams : null,
  );

  const { data: myRecipes, isLoading: myRecipesLoading } =
    useUserMealPlanRecipes();

  const saveCatalogMutation = useSaveCatalogRecipe();
  const addItemMutation = useAddMealPlanItem();

  const filteredMyRecipes = useMemo(() => {
    if (!myRecipes) return [];
    if (!searchText.trim()) return myRecipes;
    const q = searchText.toLowerCase();
    return myRecipes.filter((r) => r.title.toLowerCase().includes(q));
  }, [myRecipes, searchText]);

  const handleAddCatalogRecipe = useCallback(
    async (item: CatalogSearchResult) => {
      if (!plannedDate || !mealType) return;
      haptics.selection();
      setAddingId(item.id);
      try {
        const saved = await saveCatalogMutation.mutateAsync(item.id);
        await addItemMutation.mutateAsync({
          recipeId: saved.id,
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
    [
      haptics,
      saveCatalogMutation,
      addItemMutation,
      plannedDate,
      mealType,
      navigation,
    ],
  );

  const handleAddMyRecipe = useCallback(
    async (recipe: MealPlanRecipe) => {
      if (!plannedDate || !mealType) return;
      haptics.selection();
      setAddingId(recipe.id);
      try {
        await addItemMutation.mutateAsync({
          recipeId: recipe.id,
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
    [haptics, addItemMutation, plannedDate, mealType, navigation],
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

  const renderCatalogItem = useCallback(
    ({ item }: { item: CatalogSearchResult }) => (
      <CatalogCard
        item={item}
        onAdd={handleAddCatalogRecipe}
        adding={addingId === item.id}
      />
    ),
    [handleAddCatalogRecipe, addingId],
  );

  const renderMyRecipeItem = useCallback(
    ({ item }: { item: MealPlanRecipe }) => (
      <MyRecipeCard
        recipe={item}
        onAdd={handleAddMyRecipe}
        adding={addingId === item.id}
      />
    ),
    [handleAddMyRecipe, addingId],
  );

  const catalogKeyExtractor = useCallback(
    (item: CatalogSearchResult) => String(item.id),
    [],
  );
  const myRecipeKeyExtractor = useCallback(
    (item: MealPlanRecipe) => String(item.id),
    [],
  );

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
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          <Chip
            label="Catalog"
            variant="tab"
            selected={tab === "catalog"}
            onPress={() => setTab("catalog")}
          />
          <Chip
            label="My Recipes"
            variant="tab"
            selected={tab === "my"}
            onPress={() => setTab("my")}
          />
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

        {/* Filter chips (catalog only) */}
        {tab === "catalog" && (
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
        )}
      </View>

      {/* Results */}
      {tab === "catalog" ? (
        <>
          {catalogLoading && debouncedQuery ? (
            <View style={styles.loadingContainer}>
              <SkeletonBox width="100%" height={64} borderRadius={12} />
              <View style={{ height: Spacing.sm }} />
              <SkeletonBox width="100%" height={64} borderRadius={12} />
              <View style={{ height: Spacing.sm }} />
              <SkeletonBox width="100%" height={64} borderRadius={12} />
            </View>
          ) : !debouncedQuery ? (
            <View style={styles.emptyContainer}>
              <Feather
                name="search"
                size={40}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                Search for recipes to add to your meal plan
              </ThemedText>
            </View>
          ) : catalogData?.results.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather
                name="inbox"
                size={40}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No recipes found
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={catalogData?.results || []}
              renderItem={renderCatalogItem}
              keyExtractor={catalogKeyExtractor}
              contentContainerStyle={{
                paddingHorizontal: Spacing.lg,
                paddingBottom: insets.bottom + Spacing.xl,
              }}
              ItemSeparatorComponent={ItemSeparator}
            />
          )}
        </>
      ) : (
        <>
          {myRecipesLoading ? (
            <View style={styles.loadingContainer}>
              <SkeletonBox width="100%" height={64} borderRadius={12} />
              <View style={{ height: Spacing.sm }} />
              <SkeletonBox width="100%" height={64} borderRadius={12} />
            </View>
          ) : filteredMyRecipes.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather
                name="book-open"
                size={40}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                {searchText
                  ? "No matching recipes"
                  : "No recipes yet. Create or import one!"}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={filteredMyRecipes}
              renderItem={renderMyRecipeItem}
              keyExtractor={myRecipeKeyExtractor}
              contentContainerStyle={{
                paddingHorizontal: Spacing.lg,
                paddingBottom: insets.bottom + Spacing.xl,
              }}
              ItemSeparatorComponent={ItemSeparator}
            />
          )}
        </>
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
  tabRow: {
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
});
