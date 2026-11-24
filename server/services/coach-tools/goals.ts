import { setGoalsCardArgsSchema } from "../write-cards/tool-args";
import { goalsCardResult } from "../write-cards/results";
import { defineTool, type CoachToolEntry } from "./types";

// set_nutrition_goals is offered, and run, only for an app that can draw the
// goals card (it lists the kind).
const setNutritionGoalsTool = defineTool({
  name: "set_nutrition_goals",
  available: (opts) => !!opts.writeCards && !!opts.goalsCard,
  definition: () => ({
    type: "function",
    function: {
      name: "set_nutrition_goals",
      description:
        "Show the user a card to change their daily nutrition goals. Nothing changes until the user taps the card. Call this when the user asks to set or change a daily calorie, protein, carbs or fat goal, or agrees to a goal you suggested. Give only the goals to change. Use this instead of a set_goal action card.",
      parameters: {
        type: "object",
        properties: {
          calories: {
            type: "number",
            description: "Daily calories, 1200 to 10000.",
          },
          protein: {
            type: "number",
            description: "Daily protein in grams, 0 to 500.",
          },
          carbs: {
            type: "number",
            description: "Daily carbs in grams, 0 to 1000.",
          },
          fat: { type: "number", description: "Daily fat in grams, 0 to 500." },
        },
      },
    },
  }),
  argsSchema: setGoalsCardArgsSchema,
  run: async (args, { opts }) =>
    goalsCardResult(await opts.onWriteCardProposal?.({ kind: "goals", args })),
});

export const GOALS_TOOLS: CoachToolEntry[] = [setNutritionGoalsTool];
