import { storage } from "../storage";
import type { PremiumFeatures } from "@shared/types/premium";
import type { CoachNotebookEntry } from "@shared/schema";

export interface CoachContextData {
  goals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null;
  todayIntake: {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    itemCount: number;
  };
  dietaryProfile: {
    dietType: string | null;
    allergies: string[];
    dislikes: string[] | null;
  } | null;
  notebook: {
    id: number;
    type: string;
    content: string;
    status: string;
    followUpDate: Date | null;
    updatedAt: Date | null;
  }[];
  dueCommitments: CoachNotebookEntry[];
  suggestions: string[];
}

/**
 * Aggregate all data needed to render the coach context panel.
 *
 * Pattern: mirrors `getProfileWidgets` in `services/profile-hub.ts` —
 * parallel storage calls, derived logic, and response-shape construction
 * all live in the service so the route handler is a thin wrapper.
 */
export async function buildCoachContext(
  userId: string,
  _features: PremiumFeatures,
): Promise<CoachContextData> {
  const [profile, todayIntake, notebookEntries, dueCommitments, user] =
    await Promise.all([
      storage.getUserProfile(userId),
      storage.getDailySummary(userId, new Date()),
      storage.getActiveNotebookEntries(userId),
      storage.getCommitmentsWithDueFollowUp(userId),
      storage.getUser(userId),
    ]);

  // Generate contextual suggestion chips
  const suggestions: string[] = [];
  if (dueCommitments.length > 0) {
    suggestions.push(`How did "${dueCommitments[0].content}" go?`);
  }
  if (todayIntake) {
    const proteinGoal = user?.dailyProteinGoal ?? 150;
    const proteinLeft = proteinGoal - (todayIntake.totalProtein ?? 0);
    if (proteinLeft > 30) {
      suggestions.push(`I need ${Math.round(proteinLeft)}g more protein today`);
    }
  }
  const hour = new Date().getHours();
  if (hour < 11) {
    suggestions.push("Quick breakfast ideas");
  } else if (hour >= 17) {
    suggestions.push("How was my day?");
  }
  if (suggestions.length < 3) {
    suggestions.push("What should I eat next?");
  }

  return {
    goals: user?.dailyCalorieGoal
      ? {
          calories: user.dailyCalorieGoal,
          protein: user.dailyProteinGoal || 0,
          carbs: user.dailyCarbsGoal || 0,
          fat: user.dailyFatGoal || 0,
        }
      : null,
    todayIntake,
    dietaryProfile: profile
      ? {
          dietType: profile.dietType,
          allergies: (profile.allergies || [])
            .map((a) => a.name)
            .filter(Boolean),
          dislikes: profile.foodDislikes,
        }
      : null,
    notebook: notebookEntries.map((e) => ({
      id: e.id,
      type: e.type,
      content: e.content,
      status: e.status,
      followUpDate: e.followUpDate,
      updatedAt: e.updatedAt,
    })),
    dueCommitments,
    suggestions: suggestions.slice(0, 5),
  };
}
