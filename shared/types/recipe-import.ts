export interface ParsedIngredient {
  name: string;
  quantity: string | null;
  unit: string | null;
}

export interface ImportedRecipeData {
  title: string;
  description: string | null;
  servings: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  cuisine: string | null;
  dietTags: string[];
  ingredients: ParsedIngredient[];
  instructions: string | null;
  imageUrl: string | null;
  caloriesPerServing: string | null;
  proteinPerServing: string | null;
  carbsPerServing: string | null;
  fatPerServing: string | null;
  sourceUrl: string;
}
