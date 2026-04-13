export interface SearchableRecipe {
  id: string; // "personal:42", "community:17", "spoonacular:654321"
  source: "personal" | "community" | "spoonacular";
  userId: string | null; // owner ID for personal recipes (IDOR protection)
  title: string;
  description: string | null;
  ingredients: string[]; // flattened ingredient names for search
  cuisine: string | null;
  dietTags: string[];
  mealTypes: string[];
  difficulty: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  servings: number | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
}

export interface RecipeSearchParams {
  q?: string;
  ingredients?: string;
  pantry?: boolean;
  cuisine?: string;
  diet?: string;
  mealType?: string;
  difficulty?: string;
  maxPrepTime?: number;
  maxCalories?: number;
  minProtein?: number;
  sort?: "relevance" | "newest" | "quickest" | "calories_asc" | "popular";
  source?: "all" | "personal" | "community" | "spoonacular";
  limit?: number;
  offset?: number;
}

export interface RecipeSearchResponse {
  results: SearchableRecipe[];
  total: number;
  offset: number;
  limit: number;
  query: {
    q: string | null;
    filters: Record<string, string | number | boolean>;
    sort: string;
  };
}
