import React, { useEffect, useState, type Dispatch } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Chip } from "@/components/Chip";
import { SelectableTile } from "@/components/SelectableTile";
import { EmptyState } from "@/components/EmptyState";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useFavouriteRecipes } from "@/hooks/useFavouriteRecipes";
import { useUnifiedRecipes } from "@/hooks/useMealPlanRecipes";
import { resolveImageUrl } from "@/lib/query-client";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import {
  recipeKey,
  type WizardAction,
  type WizardState,
} from "./cookbook-wizard-utils";
import {
  filterRecipes,
  mergeRecipeSources,
  type RecipeFilter,
  type SourcedRecipe,
} from "./wizard-recipe-source";

const FILTERS: { value: RecipeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "favourites", label: "Favourites" },
  { value: "mine", label: "My recipes" },
];

interface WizardRecipesStepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** Whether the user has any recipe to pick, once both sources have loaded. */
  onAvailability: (hasAnyRecipes: boolean) => void;
}

/**
 * Wizard step 3: pick recipes for the book from the user's favourites and
 * their own recipes, with a title search and source filters.
 */
export function WizardRecipesStep({
  state,
  dispatch,
  onAvailability,
}: WizardRecipesStepProps) {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<RecipeFilter>("all");
  const [query, setQuery] = useState("");

  const favouritesQuery = useFavouriteRecipes();
  const unifiedQuery = useUnifiedRecipes();
  // A failed source settles with no data. It shows a load error with a
  // retry (above any rows the other source loaded) — never the "no saved
  // recipes" empty state, which would claim a false cause. A fetch paused
  // offline stays pending forever, so it counts as failed too: otherwise
  // the step would spin with no way past it.
  const favouritesPaused = favouritesQuery.fetchStatus === "paused";
  const unifiedPaused = unifiedQuery.fetchStatus === "paused";
  const favouritesFailed = favouritesQuery.isError || favouritesPaused;
  const unifiedFailed = unifiedQuery.isError || unifiedPaused;
  const settled =
    (!favouritesQuery.isPending || favouritesPaused) &&
    (!unifiedQuery.isPending || unifiedPaused);
  const loadFailed = favouritesFailed || unifiedFailed;
  const all = mergeRecipeSources(
    favouritesQuery.data ?? [],
    unifiedQuery.data?.personal ?? [],
  );
  // Availability follows the full library, never the filtered view — a
  // search with no match must not make the step skippable.
  const hasAnyRecipes = all.length > 0;
  // A load error reports none, so the step stays skippable and the user is
  // never stranded behind a source that won't load.
  const available = hasAnyRecipes && !loadFailed;

  useEffect(() => {
    if (settled) onAvailability(available);
  }, [settled, available, onAvailability]);

  const retry = () => {
    if (favouritesFailed) void favouritesQuery.refetch();
    if (unifiedFailed) void unifiedQuery.refetch();
  };

  const errorBlock = loadFailed ? (
    <View style={styles.errorBlock}>
      <InlineError message="Couldn't load your recipes. Try again, or skip and add them later." />
      <Button
        variant="outline"
        onPress={retry}
        accessibilityLabel="Try loading your recipes again"
      >
        Try again
      </Button>
    </View>
  ) : null;

  const pickedKeys = new Set(state.recipes.map(recipeKey));
  const visible = filterRecipes(all, filter, query);

  let body: React.ReactNode;
  if (!settled) {
    body = (
      <View style={styles.loading}>
        <ActivityIndicator
          color={theme.link}
          accessibilityLabel="Loading your recipes"
        />
      </View>
    );
  } else if (!hasAnyRecipes && loadFailed) {
    body = errorBlock;
  } else if (!hasAnyRecipes) {
    body = (
      <EmptyState
        variant="firstTime"
        icon="book-open"
        title="No saved recipes yet"
        description="You can add recipes to this cookbook any time after you create it."
      />
    );
  } else {
    body = (
      <>
        {errorBlock}
        <TextInput
          placeholder="Search your recipes"
          accessibilityLabel="Search your recipes"
          leftIcon="search"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
        />
        <View style={styles.filters} accessibilityRole="tablist">
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              variant="tab"
              accessibilityRole="tab"
              selected={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </View>
        {visible.length === 0 ? (
          <ThemedText
            type="small"
            style={[styles.noMatch, { color: theme.textSecondary }]}
          >
            No recipes match
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {visible.map((recipe) => (
              <RecipeRow
                key={recipeKey(recipe)}
                recipe={recipe}
                checked={pickedKeys.has(recipeKey(recipe))}
                onToggle={() =>
                  dispatch({
                    type: "toggleRecipe",
                    // Only the wizard's fields — the source flags stay here.
                    recipe: {
                      recipeId: recipe.recipeId,
                      recipeType: recipe.recipeType,
                      title: recipe.title,
                      imageUrl: recipe.imageUrl,
                    },
                  })
                }
              />
            ))}
          </View>
        )}
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleBlock}>
        <ThemedText type="h3" accessibilityRole="header">
          Choose your recipes
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Pick from your saved recipes and favourites.
        </ThemedText>
      </View>
      {body}
    </View>
  );
}

function RecipeRow({
  recipe,
  checked,
  onToggle,
}: {
  recipe: SourcedRecipe;
  checked: boolean;
  onToggle: () => void;
}) {
  const { theme } = useTheme();
  const uri = resolveImageUrl(recipe.imageUrl);

  return (
    <SelectableTile
      shape="row"
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={recipe.title}
      style={[
        styles.row,
        {
          backgroundColor: checked
            ? withOpacity(theme.link, 0.08)
            : theme.surface,
          borderColor: checked ? theme.link : theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          { backgroundColor: withOpacity(theme.text, 0.06) },
        ]}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessible={false}
          />
        ) : (
          <Feather
            name="book-open"
            size={18}
            color={withOpacity(theme.text, 0.3)}
            accessible={false}
          />
        )}
      </View>
      <ThemedText style={styles.rowTitle} numberOfLines={2}>
        {recipe.title}
      </ThemedText>
      <View
        style={[
          styles.check,
          checked
            ? {
                backgroundColor: theme.accentSolid,
                borderColor: theme.accentSolid,
              }
            : { borderColor: theme.border },
        ]}
      >
        {checked ? (
          <Feather
            name="check"
            size={14}
            color={theme.buttonText}
            accessible={false}
          />
        ) : null}
      </View>
    </SelectableTile>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.lg,
  },
  titleBlock: {
    gap: Spacing.xs,
  },
  loading: {
    paddingVertical: Spacing["3xl"],
    alignItems: "center",
  },
  errorBlock: {
    gap: Spacing.sm,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  noMatch: {
    textAlign: "center",
    paddingVertical: Spacing.xl,
  },
  list: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  thumb: {
    width: 44,
    height: 58,
    borderRadius: 6,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FontFamily.semiBold,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
