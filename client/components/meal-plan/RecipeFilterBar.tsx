import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import type { RecipeFilters } from "@/screens/meal-plan/recipe-browser-utils";

const CUISINE_PRESETS = [
  "Italian",
  "Mexican",
  "Asian",
  "Mediterranean",
  "American",
  "Indian",
];
const DIET_PRESETS = ["Vegetarian", "Vegan", "Gluten Free", "Keto", "Paleo"];

interface RecipeFilterBarProps {
  filters: RecipeFilters;
  /** Functional-update setter (a React `setState`), so toggles never read stale filters. */
  onChange: (updater: (prev: RecipeFilters) => RecipeFilters) => void;
  activeFilterCount: number;
  onOpenAdvancedFilters: () => void;
  onAddRecipe: () => void;
}

export function RecipeFilterBar({
  filters,
  onChange: setFilters,
  activeFilterCount,
  onOpenAdvancedFilters,
  onAddRecipe,
}: RecipeFilterBarProps) {
  const { theme } = useTheme();

  const handleToggleCuisine = (cuisine: string) => {
    setFilters((prev) => ({
      ...prev,
      activeCuisine: prev.activeCuisine === cuisine ? undefined : cuisine,
    }));
  };

  const handleToggleDiet = (diet: string) => {
    setFilters((prev) => ({
      ...prev,
      activeDiet: prev.activeDiet === diet ? undefined : diet,
    }));
  };

  return (
    <View style={styles.filterBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        <Chip
          label="Curated"
          variant="filter"
          selected={filters.curatedOnly}
          onPress={() => {
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
            setFilters((prev) => ({
              ...prev,
              advanced: {
                ...prev.advanced,
                maxPrepTime: prev.advanced.maxPrepTime === 30 ? undefined : 30,
              },
            }));
          }}
          accessibilityLabel="Filter quick meals under 30 minutes"
        />
        <PressableScale
          scaleTo={0.95}
          onPress={onOpenAdvancedFilters}
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
        </PressableScale>
      </ScrollView>
      <PressableScale
        onPress={onAddRecipe}
        style={[
          styles.headerAction,
          { borderColor: withOpacity(theme.text, 0.15) },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add recipe"
      >
        <Feather name="plus" size={14} color={theme.link} />
        <ThemedText style={[styles.headerActionText, { color: theme.link }]}>
          Add
        </ThemedText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  filterScroll: {
    flex: 1,
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
});
