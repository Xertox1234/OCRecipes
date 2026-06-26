import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";

import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, FontFamily } from "@/constants/theme";
import { DiscoveryRow } from "./DiscoveryRow";
import { DISCOVERY_PRESETS } from "./recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const CUISINES = [
  "Italian",
  "Mexican",
  "Asian",
  "Mediterranean",
  "American",
  "Indian",
];

interface RecipeDiscoveryFeedProps {
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSelectCuisine: (cuisine: string) => void;
  onSeePreset: (key: "pantry" | "quick" | "featured") => void;
  contentBottomInset?: number;
}

export function RecipeDiscoveryFeed({
  onOpenRecipe,
  onSelectCuisine,
  onSeePreset,
  contentBottomInset = 0,
}: RecipeDiscoveryFeedProps) {
  const { theme } = useTheme();
  const { isPremium } = usePremiumContext();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: Spacing.md,
        paddingBottom: contentBottomInset + Spacing.xl,
      }}
      showsVerticalScrollIndicator={false}
    >
      {DISCOVERY_PRESETS.filter((p) => !p.premiumOnly || isPremium).map((p) => (
        <DiscoveryRow
          key={p.key}
          title={p.title}
          params={p.params}
          onOpenRecipe={onOpenRecipe}
          onSeeAll={() => onSeePreset(p.key)}
        />
      ))}

      <View style={styles.cuisineSection}>
        <ThemedText type="body" style={[styles.header, { color: theme.text }]}>
          Browse by cuisine
        </ThemedText>
        <View style={styles.chipRow}>
          {CUISINES.map((c) => (
            <Chip
              key={c}
              label={c}
              variant="filter"
              selected={false}
              onPress={() => onSelectCuisine(c)}
              accessibilityLabel={`Browse ${c} recipes`}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cuisineSection: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  header: {
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    marginBottom: Spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
});
