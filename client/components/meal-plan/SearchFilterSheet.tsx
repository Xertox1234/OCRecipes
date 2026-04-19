import React, { useCallback, useEffect, useState } from "react";
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

  // Live slider values for SR announcements during drag. onSlidingComplete
  // commits the final value to the parent; onValueChange updates local state
  // so accessibilityValue reflects the current thumb position in real time,
  // letting VoiceOver/TalkBack read the value during the drag gesture.
  const [liveMaxPrepTime, setLiveMaxPrepTime] = useState(
    filters.maxPrepTime ?? 0,
  );
  const [liveMaxCalories, setLiveMaxCalories] = useState(
    filters.maxCalories ?? 0,
  );
  const [liveMinProtein, setLiveMinProtein] = useState(filters.minProtein ?? 0);

  // Sync live state when committed filter values change externally (e.g., Reset).
  // Without this, onReset() resets parent state but live values remain stale,
  // causing accessibilityValue.text to mismatch the slider's visual position.
  useEffect(() => {
    setLiveMaxPrepTime(filters.maxPrepTime ?? 0);
  }, [filters.maxPrepTime]);
  useEffect(() => {
    setLiveMaxCalories(filters.maxCalories ?? 0);
  }, [filters.maxCalories]);
  useEffect(() => {
    setLiveMinProtein(filters.minProtein ?? 0);
  }, [filters.minProtein]);

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
        onValueChange={(val: number) => setLiveMaxPrepTime(val)}
        onSlidingComplete={(val: number) => {
          setLiveMaxPrepTime(val);
          updateFilter("maxPrepTime", val > 0 ? val : undefined);
        }}
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
        accessibilityLabel="Maximum prep time in minutes"
        accessibilityHint="Adjust to filter recipes by prep time. Zero means no limit."
        accessibilityValue={{
          min: 0,
          max: 120,
          now: liveMaxPrepTime,
          text:
            liveMaxPrepTime > 0
              ? `${liveMaxPrepTime} minutes`
              : "Any prep time",
        }}
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
        onValueChange={(val: number) => setLiveMaxCalories(val)}
        onSlidingComplete={(val: number) => {
          setLiveMaxCalories(val);
          updateFilter("maxCalories", val > 0 ? val : undefined);
        }}
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
        accessibilityLabel="Maximum calories per serving"
        accessibilityHint="Adjust to filter recipes by calories. Zero means no limit."
        accessibilityValue={{
          min: 0,
          max: 1000,
          now: liveMaxCalories,
          text:
            liveMaxCalories > 0
              ? `${liveMaxCalories} calories`
              : "Any calories",
        }}
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
        onValueChange={(val: number) => setLiveMinProtein(val)}
        onSlidingComplete={(val: number) => {
          setLiveMinProtein(val);
          updateFilter("minProtein", val > 0 ? val : undefined);
        }}
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
        accessibilityLabel="Minimum protein in grams"
        accessibilityHint="Adjust to filter recipes by protein. Zero means no minimum."
        accessibilityValue={{
          min: 0,
          max: 60,
          now: liveMinProtein,
          text: liveMinProtein > 0 ? `${liveMinProtein} grams` : "Any protein",
        }}
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
