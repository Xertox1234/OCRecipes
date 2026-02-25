import { storage } from "../storage";

export interface AdaptiveGoalRecommendation {
  previousCalories: number;
  newCalories: number;
  previousProtein: number;
  newProtein: number;
  previousCarbs: number;
  newCarbs: number;
  previousFat: number;
  newFat: number;
  reason: string;
  weightTrendRate: number | null;
  explanation: string;
}

export interface CurrentMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Estimates actual TDEE from weight change over a period.
 * 1 kg of body weight ≈ 7700 kcal.
 */
export function estimateTDEE(
  currentCalories: number,
  weightChangeKg: number,
  daySpan: number,
): number {
  const dailyCalorieFromWeightChange = (weightChangeKg * 7700) / daySpan;
  return currentCalories - dailyCalorieFromWeightChange;
}

/**
 * Returns the calorie adjustment for a given goal.
 */
export function getGoalAdjustment(
  goal: string,
): number {
  if (goal === "lose_weight") return -500;
  if (goal === "gain_weight" || goal === "build_muscle") return 300;
  return 0;
}

/**
 * Clamps calories to safe bounds: min 1200, max 5000.
 */
export function clampCalories(calories: number): number {
  return Math.max(1200, Math.min(5000, calories));
}

/**
 * Recomputes macros for a new calorie target while preserving
 * the same protein/carbs/fat calorie ratios.
 */
export function recomputeMacros(
  current: CurrentMacros,
  newCalories: number,
): { protein: number; carbs: number; fat: number } {
  const totalCurrentMacroCalories =
    current.protein * 4 + current.carbs * 4 + current.fat * 9;
  const proteinRatio = (current.protein * 4) / totalCurrentMacroCalories;
  const carbsRatio = (current.carbs * 4) / totalCurrentMacroCalories;
  const fatRatio = (current.fat * 9) / totalCurrentMacroCalories;

  return {
    protein: Math.round((newCalories * proteinRatio) / 4),
    carbs: Math.round((newCalories * carbsRatio) / 4),
    fat: Math.round((newCalories * fatRatio) / 9),
  };
}

/**
 * Determines the reason and explanation for an adaptive goal change.
 */
export function determineReason(
  goal: string,
  weightChange: number,
  weeklyRate: number,
  daySpan: number,
  estimatedTDEE: number,
  safeCalories: number,
): { reason: string; explanation: string } {
  if (goal === "lose_weight" && weightChange > 0) {
    return {
      reason: "exceeding_target",
      explanation: `You've gained ${Math.abs(weightChange).toFixed(1)} kg over ${Math.round(daySpan)} days. Your estimated TDEE is higher than expected. Adjusting calories to ${safeCalories} to better support your weight loss goal.`,
    };
  } else if (goal === "lose_weight" && Math.abs(weeklyRate) < 0.1) {
    return {
      reason: "weight_stall",
      explanation: `Your weight has been stable (${weeklyRate.toFixed(2)} kg/week). Reducing calories slightly to restart progress.`,
    };
  } else if (goal === "gain_weight" && weightChange < 0) {
    return {
      reason: "undereating",
      explanation: `You've lost ${Math.abs(weightChange).toFixed(1)} kg but your goal is to gain weight. Increasing calories to ${safeCalories}.`,
    };
  }
  return {
    reason: "scheduled",
    explanation: `Based on ${Math.round(daySpan)} days of data, your actual TDEE appears to be ~${Math.round(estimatedTDEE)} kcal. Adjusting your target to ${safeCalories} kcal for optimal progress.`,
  };
}

/**
 * Computes an adaptive goal recommendation based on:
 * 1. Actual TDEE = avgIntake - (weightChangeKg * 7700 / days) over 2-4 weeks
 * 2. Compare to estimated TDEE from Mifflin-St Jeor
 * 3. If >10% deviation, recommend adjustment
 * 4. Apply user's goal modifier (lose/gain/maintain)
 * 5. Clamp to safety bounds (min 1200 kcal)
 */
export async function computeAdaptiveGoals(
  userId: string,
): Promise<AdaptiveGoalRecommendation | null> {
  const user = await storage.getUser(userId);
  if (!user) return null;

  // Get weight logs from last 28 days
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const weightLogs = await storage.getWeightLogs(userId, {
    from: fourWeeksAgo,
  });

  if (weightLogs.length < 4) return null; // Need at least 4 entries over 2+ weeks

  const sorted = [...weightLogs].sort(
    (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
  );

  const firstWeight = parseFloat(sorted[0].weight);
  const lastWeight = parseFloat(sorted[sorted.length - 1].weight);
  const firstDate = new Date(sorted[0].loggedAt);
  const lastDate = new Date(sorted[sorted.length - 1].loggedAt);
  const daySpan =
    (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daySpan < 14) return null; // Need at least 2 weeks of data

  const weightChange = lastWeight - firstWeight;
  const weeklyRate = (weightChange / daySpan) * 7;

  // Get average daily intake over same period
  // We'd need daily summaries for each day — approximate with current goal as baseline
  const currentCalories = user.dailyCalorieGoal || 2000;
  const currentProtein = user.dailyProteinGoal || 150;
  const currentCarbs = user.dailyCarbsGoal || 250;
  const currentFat = user.dailyFatGoal || 67;

  // Estimated actual TDEE
  const tdee = estimateTDEE(currentCalories, weightChange, daySpan);

  // Get user's goal
  const profile = await storage.getUserProfile(userId);
  const goal = profile?.primaryGoal || "maintain";

  // Determine target deficit/surplus
  const targetAdjustment = getGoalAdjustment(goal);
  const recommendedCalories = Math.round(tdee + targetAdjustment);

  // Check if deviation is significant (>10%)
  const deviation =
    Math.abs(recommendedCalories - currentCalories) / currentCalories;
  if (deviation < 0.1) return null; // Current goals are close enough

  // Safety bounds
  const safeCalories = clampCalories(recommendedCalories);

  // Recompute macros maintaining same ratio
  const currentMacros: CurrentMacros = {
    calories: currentCalories,
    protein: currentProtein,
    carbs: currentCarbs,
    fat: currentFat,
  };
  const newMacros = recomputeMacros(currentMacros, safeCalories);

  // Determine reason
  const { reason, explanation } = determineReason(
    goal,
    weightChange,
    weeklyRate,
    daySpan,
    tdee,
    safeCalories,
  );

  return {
    previousCalories: currentCalories,
    newCalories: safeCalories,
    previousProtein: currentProtein,
    newProtein: newMacros.protein,
    previousCarbs: currentCarbs,
    newCarbs: newMacros.carbs,
    previousFat: currentFat,
    newFat: newMacros.fat,
    reason,
    weightTrendRate: Math.round(weeklyRate * 100) / 100,
    explanation,
  };
}
