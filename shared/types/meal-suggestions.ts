export interface MealSuggestion {
  title: string;
  description: string;
  reasoning: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  prepTimeMinutes: number;
  difficulty: "Easy" | "Medium" | "Hard";
  ingredients: { name: string; quantity?: string; unit?: string }[];
  instructions: string;
  dietTags: string[];
}

export interface MealSuggestionResponse {
  suggestions: MealSuggestion[];
  remainingToday: number;
}
