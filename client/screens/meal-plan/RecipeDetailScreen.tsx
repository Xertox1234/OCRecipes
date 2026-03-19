import React, { useMemo } from "react";
import { StyleSheet, View, ScrollView, ActivityIndicator } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { AllergenBadge } from "@/components/AllergenBadge";
import { AllergenWarningBanner } from "@/components/AllergenWarningBanner";
import { InlineSubstitution } from "@/components/InlineSubstitution";
import { useTheme } from "@/hooks/useTheme";
import { useAllergenCheck } from "@/hooks/useAllergenCheck";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useMealPlanRecipeDetail } from "@/hooks/useMealPlanRecipes";
import {
  ALLERGEN_INGREDIENT_MAP,
  type AllergySeverity,
} from "@shared/constants/allergens";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type RecipeDetailRouteProp = RouteProp<MealPlanStackParamList, "RecipeDetail">;

function NutritionRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.nutritionRow}>
      <View style={[styles.nutritionDot, { backgroundColor: color }]} />
      <ThemedText style={styles.nutritionLabel}>{label}</ThemedText>
      <ThemedText
        style={[styles.nutritionValue, { color: theme.textSecondary }]}
      >
        {value}
      </ThemedText>
    </View>
  );
}

export default function RecipeDetailScreen() {
  const route = useRoute<RecipeDetailRouteProp>();
  const { recipeId } = route.params;
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();

  const { data: recipe, isLoading, error } = useMealPlanRecipeDetail(recipeId);

  // Extract ingredient names for allergen checking
  const ingredientNames = useMemo(
    () => (recipe?.ingredients ?? []).map((ing) => ing.name),
    [recipe?.ingredients],
  );
  const { data: allergenResult } = useAllergenCheck(ingredientNames);

  // Build a lookup: ingredient name → allergen match (for per-row badges)
  const allergenMatchMap = useMemo(() => {
    const map = new Map<
      string,
      { allergenId: string; severity: AllergySeverity; label: string }
    >();
    if (!allergenResult?.matches) return map;
    for (const m of allergenResult.matches) {
      if (!map.has(m.ingredientName)) {
        const def = ALLERGEN_INGREDIENT_MAP[m.allergenId];
        map.set(m.ingredientName, {
          allergenId: m.allergenId,
          severity: m.severity,
          label: def?.label ?? m.allergenId,
        });
      }
    }
    return map;
  }, [allergenResult?.matches]);

  // Build a lookup: ingredient name → substitution suggestions
  // The allergen-check endpoint uses `allergen-check-{i}` IDs where i maps
  // to the order of unique matched ingredient names
  const substitutionsByName = useMemo(() => {
    type SubArray = NonNullable<typeof allergenResult>["substitutions"];
    const map = new Map<string, SubArray>();
    if (!allergenResult?.substitutions || !allergenResult?.matches) return map;

    // Rebuild the same uniqueIngredients order the endpoint used
    const uniqueNames: string[] = [];
    const seen = new Set<string>();
    for (const m of allergenResult.matches) {
      if (!seen.has(m.ingredientName)) {
        seen.add(m.ingredientName);
        uniqueNames.push(m.ingredientName);
      }
    }

    for (const s of allergenResult.substitutions) {
      // Extract index from "allergen-check-{i}"
      const idxStr = s.originalIngredientId.replace("allergen-check-", "");
      const idx = parseInt(idxStr, 10);
      const name = !isNaN(idx) ? uniqueNames[idx] : undefined;
      if (!name) continue;

      const existing = map.get(name) ?? [];
      existing.push(s);
      map.set(name, existing);
    }
    return map;
  }, [allergenResult?.substitutions, allergenResult?.matches]);

  const timeDisplay = useMemo(() => {
    if (!recipe) return null;
    const prep = recipe.prepTimeMinutes;
    const cook = recipe.cookTimeMinutes;
    const total = (prep || 0) + (cook || 0);
    if (total === 0) return null;

    const parts = [];
    if (prep) parts.push(`${prep} min prep`);
    if (cook) parts.push(`${cook} min cook`);
    return parts.join(" · ");
  }, [recipe]);

  if (isLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { paddingTop: headerHeight, backgroundColor: theme.backgroundRoot },
        ]}
      >
        <ActivityIndicator size="large" color={theme.link} />
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { paddingTop: headerHeight, backgroundColor: theme.backgroundRoot },
        ]}
      >
        <Feather name="alert-circle" size={32} color={theme.error} />
        <ThemedText
          style={{ marginTop: Spacing.md, color: theme.textSecondary }}
        >
          Recipe not found
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.sm,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Meta */}
        <View style={styles.section}>
          <ThemedText style={styles.title}>{recipe.title}</ThemedText>
          {recipe.description && (
            <ThemedText
              style={[styles.description, { color: theme.textSecondary }]}
            >
              {recipe.description}
            </ThemedText>
          )}

          {/* Meta pills */}
          <View style={styles.metaRow}>
            {timeDisplay && (
              <View
                style={[
                  styles.metaPill,
                  { backgroundColor: withOpacity(theme.text, 0.06) },
                ]}
              >
                <Feather name="clock" size={12} color={theme.textSecondary} />
                <ThemedText
                  style={[styles.metaText, { color: theme.textSecondary }]}
                >
                  {timeDisplay}
                </ThemedText>
              </View>
            )}
            {recipe.difficulty && (
              <View
                style={[
                  styles.metaPill,
                  { backgroundColor: withOpacity(theme.text, 0.06) },
                ]}
              >
                <Feather
                  name="bar-chart-2"
                  size={12}
                  color={theme.textSecondary}
                />
                <ThemedText
                  style={[styles.metaText, { color: theme.textSecondary }]}
                >
                  {recipe.difficulty}
                </ThemedText>
              </View>
            )}
            {recipe.servings && (
              <View
                style={[
                  styles.metaPill,
                  { backgroundColor: withOpacity(theme.text, 0.06) },
                ]}
              >
                <Feather name="users" size={12} color={theme.textSecondary} />
                <ThemedText
                  style={[styles.metaText, { color: theme.textSecondary }]}
                >
                  {recipe.servings} servings
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* Nutrition */}
        {recipe.caloriesPerServing && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>
              Nutrition per serving
            </ThemedText>
            <View
              style={[
                styles.nutritionCard,
                { backgroundColor: withOpacity(theme.text, 0.04) },
              ]}
            >
              <NutritionRow
                label="Calories"
                value={`${Math.round(parseFloat(recipe.caloriesPerServing))} kcal`}
                color={theme.calorieAccent}
              />
              {recipe.proteinPerServing && (
                <NutritionRow
                  label="Protein"
                  value={`${Math.round(parseFloat(recipe.proteinPerServing))}g`}
                  color={theme.proteinAccent}
                />
              )}
              {recipe.carbsPerServing && (
                <NutritionRow
                  label="Carbs"
                  value={`${Math.round(parseFloat(recipe.carbsPerServing))}g`}
                  color={theme.carbsAccent}
                />
              )}
              {recipe.fatPerServing && (
                <NutritionRow
                  label="Fat"
                  value={`${Math.round(parseFloat(recipe.fatPerServing))}g`}
                  color={theme.fatAccent}
                />
              )}
            </View>
          </View>
        )}

        {/* Ingredients */}
        {recipe.ingredients && recipe.ingredients.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Ingredients</ThemedText>

            {allergenResult?.matches && allergenResult.matches.length > 0 && (
              <View style={{ marginBottom: Spacing.md }}>
                <AllergenWarningBanner matches={allergenResult.matches} />
              </View>
            )}

            {recipe.ingredients.map((ing, idx) => {
              const match = allergenMatchMap.get(ing.name);
              const borderColor = match
                ? match.severity === "severe"
                  ? theme.error
                  : match.severity === "moderate"
                    ? theme.warning
                    : theme.info
                : undefined;

              return (
                <View
                  key={ing.id || idx}
                  style={[
                    styles.ingredientRow,
                    borderColor && {
                      borderLeftWidth: 3,
                      borderLeftColor: borderColor,
                      paddingLeft: Spacing.sm,
                    },
                  ]}
                >
                  {!borderColor && (
                    <View
                      style={[
                        styles.ingredientBullet,
                        { backgroundColor: theme.link },
                      ]}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.ingredientText}>
                      {ing.quantity && ing.unit
                        ? `${ing.quantity} ${ing.unit} `
                        : ing.quantity
                          ? `${ing.quantity} `
                          : ""}
                      {ing.name}
                    </ThemedText>
                    {match && (
                      <View style={{ marginTop: 2 }}>
                        <AllergenBadge
                          allergenLabel={match.label}
                          severity={match.severity}
                        />
                      </View>
                    )}
                    {/* Substitution suggestions for flagged ingredients */}
                    {substitutionsByName.get(ing.name)?.map((sub, si) => (
                      <InlineSubstitution
                        key={`${ing.name}-sub-${si}`}
                        substitute={sub.substitute}
                        reason={sub.reason}
                        ratio={sub.ratio}
                        macroDelta={sub.macroDelta}
                        confidence={sub.confidence}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Instructions */}
        {recipe.instructions && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Instructions</ThemedText>
            <ThemedText
              style={[styles.instructions, { color: theme.textSecondary }]}
            >
              {recipe.instructions}
            </ThemedText>
          </View>
        )}

        {/* Diet Tags */}
        {recipe.dietTags && recipe.dietTags.length > 0 && (
          <View style={styles.section}>
            <View style={styles.tagRow}>
              {recipe.dietTags.map((tag) => (
                <View
                  key={tag}
                  style={[
                    styles.tag,
                    { backgroundColor: withOpacity(theme.link, 0.1) },
                  ]}
                >
                  <ThemedText style={[styles.tagText, { color: theme.link }]}>
                    {tag}
                  </ThemedText>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: 24,
    fontFamily: FontFamily.bold,
    marginBottom: Spacing.sm,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  metaText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  nutritionCard: {
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  nutritionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  nutritionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  nutritionLabel: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    flex: 1,
  },
  nutritionValue: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  ingredientBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    marginRight: Spacing.md,
  },
  ingredientText: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  instructions: {
    fontSize: 15,
    lineHeight: 24,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  tag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.tag,
  },
  tagText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
