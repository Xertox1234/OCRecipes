import { DEFAULT_JUDGE_MODEL } from "./lib/judge-generic";
import { sanitizeUserInput } from "../server/lib/ai-safety";
import { formatAboutUserLines } from "../server/services/nutrition-coach";
import type { CoachContext } from "../server/services/nutrition-coach";

export { DEFAULT_JUDGE_MODEL };

/**
 * Context summary shown to the LLM judge. Typed as the real CoachContext —
 * a hand-duplicated inline shape here let `aboutUser` drift out of the
 * judge's view while the model was being scored on using it.
 */
export function formatContextSummary(context: CoachContext): string {
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
    // Mirror the coach prompt's rendering so the judge sees what the model saw.
    lines.push(
      `Allergies: ${context.dietaryProfile.allergies
        .map((a) =>
          a.severity
            ? `${sanitizeUserInput(a.name)} (${a.severity})`
            : sanitizeUserInput(a.name),
        )
        .join(", ")}`,
    );
  }
  if (context.dietaryProfile.dislikes.length > 0) {
    lines.push(
      `Dislikes: ${context.dietaryProfile.dislikes.map(sanitizeUserInput).join(", ")}`,
    );
  }

  if (context.aboutUser) {
    // Shared renderer — the judge must see exactly what the model saw.
    const aboutLines = formatAboutUserLines(context.aboutUser);
    if (aboutLines.length > 0) {
      lines.push("ABOUT THIS USER:", ...aboutLines);
    }
  }

  return lines.join("\n");
}
