import React, { useCallback } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import Slider from "@react-native-community/slider";

import { ThemedText } from "@/components/ThemedText";
import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

type SortOption =
  | "relevance"
  | "newest"
  | "quickest"
  | "calories_asc"
  | "popular";
type SourceOption = "all" | "personal" | "community" | "spoonacular";

export interface SearchFilters {
  sort: SortOption;
  maxPrepTime: number | undefined;
  maxCalories: number | undefined;
  minProtein: number | undefined;
  source: SourceOption;
}

interface SearchFilterSheetProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  onReset: () => void;
  activeFilterCount: number;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "quickest", label: "Quickest" },
  { value: "calories_asc", label: "Lowest Calories" },
  { value: "popular", label: "Most Popular" },
];

// TODO: Add { value: "spoonacular", label: "Online" } when Spoonacular inline integration lands
const SOURCE_OPTIONS: { value: SourceOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "personal", label: "My Recipes" },
  { value: "community", label: "Community" },
];

export function SearchFilterSheet({
  filters,
  onFiltersChange,
  onReset,
  activeFilterCount,
}: SearchFilterSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const updateFilter = useCallback(
    <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
      haptics.selection();
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange, haptics],
  );

  return (
    <View style={styles.container}>
      {/* Sort */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Sort by
      </ThemedText>
      <View style={styles.chipRow}>
        {SORT_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            variant="filter"
            selected={filters.sort === opt.value}
            onPress={() => updateFilter("sort", opt.value)}
          />
        ))}
      </View>

      {/* Prep Time */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Max prep time:{" "}
        {filters.maxPrepTime ? `${filters.maxPrepTime} min` : "Any"}
      </ThemedText>
      <Slider
        testID="prep-time-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={120}
        step={5}
        value={filters.maxPrepTime ?? 0}
        onSlidingComplete={(val: number) =>
          updateFilter("maxPrepTime", val > 0 ? val : undefined)
        }
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
      />

      {/* Calories */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Max calories:{" "}
        {filters.maxCalories ? `${filters.maxCalories} cal` : "Any"}
      </ThemedText>
      <Slider
        testID="calories-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={1000}
        step={50}
        value={filters.maxCalories ?? 0}
        onSlidingComplete={(val: number) =>
          updateFilter("maxCalories", val > 0 ? val : undefined)
        }
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
      />

      {/* Protein */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Min protein: {filters.minProtein ? `${filters.minProtein}g` : "Any"}
      </ThemedText>
      <Slider
        testID="protein-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={60}
        step={5}
        value={filters.minProtein ?? 0}
        onSlidingComplete={(val: number) =>
          updateFilter("minProtein", val > 0 ? val : undefined)
        }
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
      />

      {/* Source */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Source
      </ThemedText>
      <View style={styles.chipRow}>
        {SOURCE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            variant="filter"
            selected={filters.source === opt.value}
            onPress={() => updateFilter("source", opt.value)}
          />
        ))}
      </View>

      {/* Reset */}
      {activeFilterCount > 0 && (
        <Pressable
          onPress={() => {
            haptics.selection();
            onReset();
          }}
          style={[
            styles.resetButton,
            { borderColor: withOpacity(theme.text, 0.15) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Reset filters"
        >
          <ThemedText style={[styles.resetText, { color: theme.link }]}>
            Reset filters
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  resetButton: {
    marginTop: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    alignItems: "center",
  },
  resetText: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
  },
});
