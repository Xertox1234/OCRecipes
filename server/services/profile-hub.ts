import { storage } from "../storage";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

export interface ProfileWidgetData {
  dailyBudget: {
    calorieGoal: number;
    foodCalories: number;
    remaining: number;
  };
}

export async function getProfileWidgets(
  userId: string,
  tz: string = "UTC",
): Promise<ProfileWidgetData | null> {
  const date = new Date();

  const [user, dailySummary] = await Promise.all([
    storage.getUser(userId),
    storage.getDailySummary(userId, date, tz),
  ]);

  if (!user) return null;

  const calorieGoal = user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;
  const foodCalories = Number(dailySummary.totalCalories) || 0;

  return {
    dailyBudget: {
      calorieGoal,
      foodCalories,
      remaining: calorieGoal - foodCalories,
    },
  };
}
