import React from "react";
import Animated from "react-native-reanimated";

import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing } from "@/constants/theme";
import { DiscoveryRow } from "./DiscoveryRow";
import { DISCOVERY_PRESETS } from "./recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

interface RecipeDiscoveryFeedProps {
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSeePreset: (key: "pantry" | "quick" | "featured") => void;
  contentBottomInset?: number;
  /** Reanimated scroll handler (from `useScrollLinkedHeader`) so scrolling the
   *  feed collapses the browser's header like the search-results list does. */
  onScroll?: React.ComponentProps<typeof Animated.ScrollView>["onScroll"];
}

export function RecipeDiscoveryFeed({
  onOpenRecipe,
  onSeePreset,
  contentBottomInset = 0,
  onScroll,
}: RecipeDiscoveryFeedProps) {
  const { isPremium } = usePremiumContext();

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
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
    </Animated.ScrollView>
  );
}
