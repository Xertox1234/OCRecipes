export interface RecipeCandidate {
  id: number;
  title: string;
  imageUrl: string;
  cuisineOrigin: string | null;
}

export interface TastePickEntry {
  recipeId: number;
  title: string;
  imageUrl: string;
  cuisineOrigin: string | null;
}

export interface TastePickCandidatesResponse {
  candidates: RecipeCandidate[];
  total: number;
  page: number;
}

export interface TastePicksResponse {
  picks: TastePickEntry[];
}

export interface SetTastePicksResponse {
  picks: TastePickEntry[];
  cuisinePreferences: string[];
}
