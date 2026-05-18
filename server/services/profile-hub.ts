import { storage } from "../storage";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import type { FastingSchedule, FastingLog } from "@shared/schema";
import { weightFromKg, weightUnitLabel } from "@shared/lib/units";

export interface ProfileWidgetData {
  dailyBudget: {
    calorieGoal: number;
    foodCalories: number;
    remaining: number;
  };
  fasting: {
    schedule: FastingSchedule | null;
    currentFast: FastingLog | null;
  };
  latestWeight: {
    value: number;
    unit: string;
    date: string;
  } | null;
}

export async function getProfileWidgets(
  userId: string,
): Promise<ProfileWidgetData | null> {
  const date = new Date();

  const [user, dailySummary, schedule, currentFast, latestWeight] =
    await Promise.all([
      storage.getUser(userId),
      storage.getDailySummary(userId, date),
      storage.getFastingSchedule(userId),
      storage.getActiveFastingLog(userId),
      storage.getLatestWeight(userId),
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
    fasting: {
      schedule: schedule ?? null,
      currentFast: currentFast ?? null,
    },
    latestWeight: latestWeight
      ? {
          // Body weight is stored in kg; convert to the user's preferred unit
          // for display. Round to 1 decimal at this leaf — the widget renders
          // the value verbatim.
          value: Number(
            weightFromKg(
              Number(latestWeight.weight),
              user.measurementUnit,
            ).toFixed(1),
          ),
          unit: weightUnitLabel(user.measurementUnit),
          date: new Date(latestWeight.loggedAt).toISOString(),
        }
      : null,
  };
}
