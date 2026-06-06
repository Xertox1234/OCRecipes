import { judgeGeneric, DEFAULT_JUDGE_MODEL } from "./lib/judge-generic";
import { sanitizeUserInput } from "../server/lib/ai-safety";

export { DEFAULT_JUDGE_MODEL };

export function formatContextSummary(context: {
  goals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null;
  todayIntake: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  dietaryProfile: {
    dietType: string | null;
    allergies: string[];
    dislikes: string[];
  };
}): string {
  const lines: string[] = [];

  if (context.goals) {
    lines.push(
      `Daily goals: ${context.goals.calories} cal, ${context.goals.protein}g protein, ${context.goals.carbs}g carbs, ${context.goals.fat}g fat`,
    );
  } else {
    lines.push("Daily goals: Not set");
  }

  lines.push(
    `Today's intake: ${context.todayIntake.calories} cal, ${context.todayIntake.protein}g protein, ${context.todayIntake.carbs}g carbs, ${context.todayIntake.fat}g fat`,
  );

  if (context.goals) {
    const rem = {
      cal: context.goals.calories - context.todayIntake.calories,
      protein: context.goals.protein - context.todayIntake.protein,
    };
    if (rem.cal >= 0) {
      lines.push(`Remaining: ${rem.cal} cal, ${rem.protein}g protein`);
    } else {
      lines.push(
        `Remaining: OVER by ${Math.abs(rem.cal)} cal, ${rem.protein >= 0 ? `${rem.protein}g protein needed` : `over by ${Math.abs(rem.protein)}g protein`}`,
      );
    }
  }

  if (context.dietaryProfile.dietType) {
    lines.push(`Diet: ${sanitizeUserInput(context.dietaryProfile.dietType)}`);
  }
  if (context.dietaryProfile.allergies.length > 0) {
    lines.push(
      `Allergies: ${context.dietaryProfile.allergies.map(sanitizeUserInput).join(", ")}`,
    );
  }
  if (context.dietaryProfile.dislikes.length > 0) {
    lines.push(
      `Dislikes: ${context.dietaryProfile.dislikes.map(sanitizeUserInput).join(", ")}`,
    );
  }

  return lines.join("\n");
}
