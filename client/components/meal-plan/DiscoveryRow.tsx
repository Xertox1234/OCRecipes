import React from "react";
import { useRecipeSearch } from "@/hooks/useRecipeSearch";
import { PresetRecipeRow } from "./PresetRecipeRow";
import { DISCOVERY_STALE_TIME_MS } from "./recipe-discovery-utils";
import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";

interface DiscoveryRowProps {
  title: string;
  params: RecipeSearchParams;
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSeeAll?: () => void;
}

export function DiscoveryRow({
  title,
  params,
  onOpenRecipe,
  onSeeAll,
}: DiscoveryRowProps) {
  const { data, isLoading, isError, refetch } = useRecipeSearch(params, {
    staleTime: DISCOVERY_STALE_TIME_MS,
  });
  return (
    <PresetRecipeRow
      title={title}
      recipes={data?.results ?? []}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      onOpenRecipe={onOpenRecipe}
      onSeeAll={onSeeAll}
    />
  );
}
