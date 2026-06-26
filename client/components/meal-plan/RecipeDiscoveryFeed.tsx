import React from "react";
import { ScrollView } from "react-native";

import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing } from "@/constants/theme";
import { DiscoveryRow } from "./DiscoveryRow";
import { DISCOVERY_PRESETS } from "./recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

interface RecipeDiscoveryFeedProps {
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSeePreset: (key: "pantry" | "quick" | "featured") => void;
  contentBottomInset?: number;
}

export function RecipeDiscoveryFeed({
  onOpenRecipe,
  onSeePreset,
  contentBottomInset = 0,
}: RecipeDiscoveryFeedProps) {
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
    </ScrollView>
  );
}
