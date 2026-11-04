/**
 * Drivers for the 21 text-only rows in `npm run ai:backup-gate` (PR 3 of the
 * Vertex backup rollout; owner 2026-11-03). Each calls the row's REAL service
 * function with one realistic input. Most of these services catch a bad reply
 * and return a stand-in value, which the call record cannot show — so each
 * driver compares the result with that stand-in and sets `degraded`.
 *
 * Imported lazily by ai-backup-gate.ts after dotenv has loaded.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AiFeature } from "../server/lib/ai-models";

export type DriverOutcome = {
  text: string;
  toolRounds: number;
  degraded?: string;
};
type Driver = () => Promise<DriverOutcome>;

const out = (value: unknown, degraded?: string): DriverOutcome => ({
  text: typeof value === "string" ? value : JSON.stringify(value),
  toolRounds: 0,
  ...(degraded ? { degraded } : {}),
});

const RECIPE_INGREDIENTS = [
  { name: "salmon fillets", quantity: "2", unit: "" },
  { name: "baby potatoes", quantity: "400", unit: "g" },
  { name: "lemon", quantity: "1", unit: "" },
  { name: "garlic cloves", quantity: "3", unit: "" },
  { name: "olive oil", quantity: "2", unit: "tbsp" },
];
const RECIPE_TITLE = "Lemon garlic salmon traybake";

export async function textRowDrivers(): Promise<
  Partial<Record<AiFeature, Driver>>
> {
  const fs = await import("node:fs");
  const read = (name: string): Record<string, unknown>[] =>
    JSON.parse(fs.readFileSync(`evals/datasets/${name}.json`, "utf8"));

  const { extractNotebookEntries } = await import(
    "../server/services/notebook-extraction"
  );
  const { structureRecipeFromText, refineAnalysis } = await import(
    "../server/services/photo-analysis"
  );
  const { generateMealSuggestions } = await import(
    "../server/services/meal-suggestions"
  );
  const { generateMealPlanFromPantry } = await import(
    "../server/services/pantry-meal-plan"
  );
  const { getSubstitutions } = await import(
    "../server/services/ingredient-substitution"
  );
  const { generateEditorialContent } = await import(
    "../server/services/canonical-enrichment"
  );
  const { generateSuggestions, generateInstructions } = await import(
    "../server/services/suggestion-generation"
  );
  const { parseNaturalLanguageFood } = await import(
    "../server/services/food-nlp"
  );
  const { classifyTurnDetailed } = await import(
    "../server/services/recipe-finder/classify-turn"
  );
  const { askClarifying, FALLBACK_QUESTIONS } = await import(
    "../server/services/recipe-finder/ask-clarifying"
  );
  const { extractQuery, extractOfferDetails, rawQuery } = await import(
    "../server/services/recipe-finder/extract-query"
  );
  const { askDishFollowUps } = await import(
    "../server/services/recipe-finder/ask-follow-ups"
  );
  const { suggestListing } = await import(
    "../server/services/inspired-recipes/suggest-listing"
  );
  const { resolveArtDirection, selectDeterministicArtDirection } = await import(
    "../server/services/image-art-direction"
  );
  const { deriveCoverSubject, deriveCoverSubjects, FALLBACK_COVER_SUBJECT } =
    await import("../server/services/cookbook-cover");
  const seed = await import("../server/scripts/seed-recipes");
  const backfill = await import(
    "../server/scripts/backfill-community-nutrition"
  );
  const { askSpiceLevels } = await import(
    "../server/scripts/backfill-recipe-spice-level"
  );

  type Profile = Parameters<typeof generateMealSuggestions>[0]["userProfile"];
  const mealCase = read("meal-suggestion-cases")[0].input as {
    mealType: string;
    userProfile: { allergies: string[] } & Record<string, unknown>;
    dailyTargets: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
    existingMeals: { title: string; calories: number; mealType: string }[];
    remainingBudget: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
  const mealProfile = {
    ...mealCase.userProfile,
    allergies: mealCase.userProfile.allergies.map((name) => ({
      name,
      severity: "moderate",
    })),
  } as unknown as Profile;
  const inspiredCase = read("inspired-suggestions-cases")[0] as {
    request: string;
    inspirationTitles: string[];
    profile: Record<string, unknown>;
  };

  const coverInput = {
    name: "Weeknight Mediterranean",
    description: "Quick dinners with lemon, herbs and olive oil",
  };
  const artCtx = {
    title: RECIPE_TITLE,
    cuisine: "Mediterranean",
    mealTypes: ["dinner"],
    ingredients: RECIPE_INGREDIENTS.map((i) => i.name),
  };
  const macros = (m: unknown) =>
    out(m, m === null ? "returned null" : undefined);

  return {
    "coach-notebook-extract": async () => {
      const entries = await extractNotebookEntries(
        [
          {
            role: "user",
            content:
              "I want to get to 140 g of protein a day, and I'll weigh in every Friday morning.",
          },
          {
            role: "assistant",
            content:
              "Great plan. Let's aim for 140 g of protein daily and a Friday weigh-in — I'll check in with you then.",
          },
        ] as Parameters<typeof extractNotebookEntries>[0],
        randomUUID(),
        0,
        { tz: "America/New_York" },
      );
      return out(entries, entries.length === 0 ? "no entries" : undefined);
    },
    "photo-recipe-text": async () =>
      out(
        await structureRecipeFromText([
          `${RECIPE_TITLE}\nServes 2\n\nIngredients\n2 salmon fillets\n400 g baby potatoes, halved\n1 lemon\n3 garlic cloves\n2 tbsp olive oil\n\nMethod\n1. Roast the potatoes at 200C for 20 minutes.\n2. Add the salmon, lemon slices and garlic; roast 12 minutes more.`,
        ]),
      ),
    "photo-refine": async () => {
      const previous = {
        foods: [
          {
            name: "rice",
            quantity: "1 cup",
            confidence: 0.6,
            needsClarification: true,
            clarificationQuestion: "Which rice?",
          },
        ],
        overallConfidence: 0.6,
        followUpQuestions: ["Which rice?"],
      };
      const result = await refineAnalysis(
        previous,
        "Which rice?",
        "brown rice",
      );
      return out(
        result,
        result === previous ? "returned previousResult" : undefined,
      );
    },
    "meal-suggestions": async () =>
      out(
        await generateMealSuggestions({
          userId: "backup-gate",
          date: new Date().toISOString().slice(0, 10),
          mealType: mealCase.mealType,
          userProfile: mealProfile,
          dailyTargets: mealCase.dailyTargets,
          existingMeals: mealCase.existingMeals,
          remainingBudget: mealCase.remainingBudget,
        }),
      ),
    "pantry-meal-plan": async () => {
      const soon = new Date(Date.now() + 3 * 86_400_000);
      const item = (
        id: number,
        name: string,
        quantity: string,
        unit: string,
        category: string,
      ) =>
        ({
          id,
          userId: "backup-gate",
          name,
          quantity,
          unit,
          category,
          expiresAt: soon,
          addedAt: new Date(),
          updatedAt: new Date(),
        }) as unknown as Parameters<
          typeof generateMealPlanFromPantry
        >[0]["pantryItems"][number];
      return out(
        await generateMealPlanFromPantry({
          pantryItems: [
            item(1, "Chicken breast", "2", "lb", "meat"),
            item(2, "Brown rice", "3", "cup", "grains"),
            item(3, "Broccoli", "2", "head", "produce"),
            item(4, "Eggs", "12", "", "dairy"),
          ],
          userProfile: null,
          dailyTargets: { calories: 2000, protein: 140, carbs: 200, fat: 65 },
          days: 1,
          householdSize: 2,
        }),
      );
    },
    "ingredient-substitution": async () => {
      // Tahini is not in the static table, so this reaches the AI.
      const result = await getSubstitutions(
        [
          {
            id: "i1",
            name: "tahini",
            quantity: 2,
            unit: "tbsp",
            confidence: 1,
            category: "condiment",
            photoId: "p1",
            userEdited: false,
          },
        ] as unknown as Parameters<typeof getSubstitutions>[0],
        null,
      );
      const fromAi = result.suggestions.filter(
        (s) => s.originalIngredientId === "i1",
      );
      return out(result, fromAi.length === 0 ? "no AI suggestion" : undefined);
    },
    "canonical-editorial": async () => {
      const result = await generateEditorialContent({
        title: RECIPE_TITLE,
        ingredients: RECIPE_INGREDIENTS,
        instructions: [
          "Roast the potatoes at 200C for 20 minutes.",
          "Add the salmon, lemon slices and garlic; roast 12 minutes more.",
        ],
      });
      const empty =
        result.chefTips.length === 0 && result.instructionDetails.length === 0;
      return out(result, empty ? "returned EDITORIAL_FALLBACK" : undefined);
    },
    "suggestion-generate": async () =>
      out(
        await generateSuggestions({
          productName: "Greek yogurt",
          brandName: "Fage",
          userProfile: null,
        }),
      ),
    "suggestion-instructions": async () => {
      const text = await generateInstructions({
        productName: "Greek yogurt",
        suggestionTitle: "Tzatziki",
        suggestionType: "recipe",
        userProfile: null,
      });
      return out(
        text,
        text === "Unable to generate instructions." ? "empty reply" : undefined,
      );
    },
    "food-nlp-parse": async () =>
      out(
        await parseNaturalLanguageFood(
          "two scrambled eggs and a slice of whole wheat toast with butter",
        ),
      ),
    "finder-classify-turn": async () => {
      const r = await classifyTurnDetailed(
        "Can you make it vegetarian instead?",
        "Chicken tikka masala",
      );
      return out(r, r.fallback ? `fallback: ${r.fallback}` : undefined);
    },
    "finder-ask-clarifying": async () => {
      const q = await askClarifying("something warm for dinner", []);
      return out(
        q,
        q === FALLBACK_QUESTIONS ? "returned FALLBACK_QUESTIONS" : undefined,
      );
    },
    "finder-extract-query": async () => {
      const text = "quick vegan lunch with chickpeas under 20 minutes";
      const q = await extractQuery(text, { dietType: "vegan" });
      return out(
        q,
        isDeepStrictEqual(q, rawQuery(text)) ? "returned rawQuery" : undefined,
      );
    },
    "finder-extract-offer": async () => {
      const r = await extractOfferDetails("Yes please!", [
        { role: "user", content: "I have salmon and potatoes, any ideas?" },
        {
          role: "assistant",
          content: `How about a ${RECIPE_TITLE.toLowerCase()}? Want me to write you the recipe?`,
        },
      ] as Parameters<typeof extractOfferDetails>[1]);
      return out(r, r.dish === null ? "dish null" : undefined);
    },
    "finder-dish-follow-ups": async () => {
      const q = await askDishFollowUps(
        RECIPE_TITLE,
        { ingredients: [], fromConversation: false } as Parameters<
          typeof askDishFollowUps
        >[1],
        [
          {
            role: "user",
            content: `I'd like a ${RECIPE_TITLE.toLowerCase()}.`,
          },
        ],
      );
      return out(q, q.length === 0 ? "no questions" : undefined);
    },
    "inspired-suggestions": async () => {
      const cards = await suggestListing({
        request: inspiredCase.request,
        inspirationTitles: inspiredCase.inspirationTitles,
        profile: inspiredCase.profile as unknown as Profile,
        count: 8,
      });
      return out(cards, cards === null ? "returned null" : undefined);
    },
    "image-art-direction": async () => {
      const d = await resolveArtDirection(artCtx, "hero");
      const same = isDeepStrictEqual(
        d,
        selectDeterministicArtDirection(artCtx, "hero"),
      );
      return out(d, same ? "returned the deterministic direction" : undefined);
    },
    // Both call sites share the row: the 120-token single subject and the
    // 400-token multi-subject pre-pass (which throws on failure).
    "cookbook-cover-subject": async () => {
      const subject = await deriveCoverSubject(
        coverInput.name,
        coverInput.description,
      );
      const many = await deriveCoverSubjects({
        ...coverInput,
        coverPrompt: "a rustic table with lemons and herbs",
      });
      return out(
        { subject, many },
        subject === FALLBACK_COVER_SUBJECT
          ? "returned FALLBACK_COVER_SUBJECT"
          : undefined,
      );
    },
    "script-seed-macros": async () =>
      macros(await seed.estimateMacros(RECIPE_TITLE, RECIPE_INGREDIENTS, 2)),
    "script-backfill-macros": async () =>
      macros(
        await backfill.estimateMacros(RECIPE_TITLE, RECIPE_INGREDIENTS, 2),
      ),
    "script-backfill-spice": async () => {
      const levels = await askSpiceLevels([
        {
          id: 1,
          title: "Mild chicken korma",
          ingredients: ["chicken", "cream", "almonds"],
        },
        {
          id: 2,
          title: "Sichuan mapo tofu",
          ingredients: ["tofu", "chili bean paste", "Sichuan pepper"],
        },
        {
          id: 3,
          title: "Vindaloo",
          ingredients: ["pork", "dried red chilies", "vinegar"],
        },
      ]);
      return out(
        Object.fromEntries(levels),
        levels.size === 0 ? "empty result" : undefined,
      );
    },
  };
}
