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
  tz: string = "UTC",
): Promise<CoachContextData> {
  const [profile, todayIntake, notebookEntries, dueCommitments, user] =
    await Promise.all([
      storage.getUserProfile(userId),
      storage.getDailySummary(userId, new Date(), tz),
      storage.getActiveNotebookEntries(userId),
      storage.getCommitmentsWithDueFollowUp(userId),
      storage.getUser(userId),
    ]);

  // Generate contextual suggestion chips
  const suggestions: string[] = [];
  if (dueCommitments.length > 0) {
    suggestions.push(`How did "${dueCommitments[0].content}" go?`);
  }
  // No fabricated default: the system prompt forbids the model from citing
  // numbers absent from USER CONTEXT, so a chip may only quote a real goal.
  if (todayIntake && user?.dailyProteinGoal != null) {
    const proteinLeft = user.dailyProteinGoal - (todayIntake.totalProtein ?? 0);
    if (proteinLeft > 30) {
      suggestions.push(`I need ${Math.round(proteinLeft)}g more protein today`);
    }
  }
  // The USER's hour, not the server's. `new Date().getHours()` reads the host
  // zone — UTC on Railway — so an LA user at 8am PDT (15:00 UTC) matched
  // neither branch and got no chip, while at 6pm PDT (01:00 UTC the next day)
  // they were offered breakfast ideas. `tz` has been a parameter of this
  // function all along.
  //
  // `hourCycle: "h23"` rather than `hour12: false`: the latter renders midnight
  // as "24" under some ICU versions, which would fall through both branches.
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
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
