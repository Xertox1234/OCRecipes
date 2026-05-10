export type MealTimeHint = "breakfast" | "lunch" | "dinner" | "snack";

export function inferMealTimeHint(hour: number): MealTimeHint {
  if (hour >= 6 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 17 && hour < 21) return "dinner";
  return "snack";
}
