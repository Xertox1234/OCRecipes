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

  // Calculate actual TDEE from weight change
  // 1 kg of body weight ≈ 7700 kcal
  const dailyCalorieFromWeightChange = (weightChange * 7700) / daySpan;

  // Get average daily intake over same period
  // We'd need daily summaries for each day — approximate with current goal as baseline
  const currentCalories = user.dailyCalorieGoal || 2000;
  const currentProtein = user.dailyProteinGoal || 150;
  const currentCarbs = user.dailyCarbsGoal || 250;
  const currentFat = user.dailyFatGoal || 67;

  // Estimated actual TDEE
  const estimatedTDEE = currentCalories - dailyCalorieFromWeightChange;

  // Get user's goal
  const profile = await storage.getUserProfile(userId);
  const goal = profile?.primaryGoal || "maintain";

  // Determine target deficit/surplus
  let targetAdjustment = 0;
  if (goal === "lose_weight") {
    targetAdjustment = -500; // 0.5 kg/week deficit
  } else if (goal === "gain_weight" || goal === "build_muscle") {
    targetAdjustment = 300; // lean bulk surplus
  }

  const recommendedCalories = Math.round(estimatedTDEE + targetAdjustment);

  // Check if deviation is significant (>10%)
  const deviation =
    Math.abs(recommendedCalories - currentCalories) / currentCalories;
  if (deviation < 0.1) return null; // Current goals are close enough

  // Safety bounds
  const safeCalories = Math.max(1200, Math.min(5000, recommendedCalories));

  // Recompute macros maintaining same ratio
  const totalCurrentMacroCalories =
    currentProtein * 4 + currentCarbs * 4 + currentFat * 9;
  const proteinRatio = (currentProtein * 4) / totalCurrentMacroCalories;
  const carbsRatio = (currentCarbs * 4) / totalCurrentMacroCalories;
  const fatRatio = (currentFat * 9) / totalCurrentMacroCalories;

  const newProtein = Math.round((safeCalories * proteinRatio) / 4);
  const newCarbs = Math.round((safeCalories * carbsRatio) / 4);
  const newFat = Math.round((safeCalories * fatRatio) / 9);

  // Determine reason
  let reason: string;
  let explanation: string;
  if (goal === "lose_weight" && weightChange > 0) {
    reason = "exceeding_target";
    explanation = `You've gained ${Math.abs(weightChange).toFixed(1)} kg over ${Math.round(daySpan)} days. Your estimated TDEE is higher than expected. Adjusting calories to ${safeCalories} to better support your weight loss goal.`;
  } else if (goal === "lose_weight" && Math.abs(weeklyRate) < 0.1) {
    reason = "weight_stall";
    explanation = `Your weight has been stable (${weeklyRate.toFixed(2)} kg/week). Reducing calories slightly to restart progress.`;
  } else if (goal === "gain_weight" && weightChange < 0) {
    reason = "undereating";
    explanation = `You've lost ${Math.abs(weightChange).toFixed(1)} kg but your goal is to gain weight. Increasing calories to ${safeCalories}.`;
  } else {
    reason = "scheduled";
    explanation = `Based on ${Math.round(daySpan)} days of data, your actual TDEE appears to be ~${Math.round(estimatedTDEE)} kcal. Adjusting your target to ${safeCalories} kcal for optimal progress.`;
  }

  return {
    previousCalories: currentCalories,
    newCalories: safeCalories,
    previousProtein: currentProtein,
    newProtein,
    previousCarbs: currentCarbs,
    newCarbs,
    previousFat: currentFat,
    newFat,
    reason,
    weightTrendRate: Math.round(weeklyRate * 100) / 100,
    explanation,
  };
}
