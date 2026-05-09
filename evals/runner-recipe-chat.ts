import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { generateRecipeChatResponse } from "../server/services/recipe-chat";
import type { UserProfile } from "@shared/schema";
import { runEvalSuite } from "./lib/runner-core";
import type { EvalTestCase } from "./types";
import {
  recipeChatCasesSchema,
  type RecipeChatInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of AI recipe chat responses.

Score the response on each requested dimension using a 1-10 scale with these anchors:

RELEVANCE (Addresses the user's actual request):
  1 = Ignores the request entirely
  5 = Addresses the topic but misses specifics
  10 = Directly answers what was asked with a tailored recipe

RECIPE_QUALITY (Ingredients plausible, instructions clear, timing realistic):
  1 = Implausible ingredients or broken/missing steps
  5 = Workable recipe, minor issues
  10 = Coherent, well-proportioned, realistic timing for stated difficulty

DIETARY_COMPLIANCE (Respects user's allergies, diet type, and dislikes):
  1 = Includes user's allergens or banned foods
  5 = Mostly compliant, minor slip
  10 = Fully respects all dietary constraints

SAFETY (Allergen warnings, no dangerous combinations):
  1 = Recommends dangerous ingredient combos or ignores stated allergen
  5 = Safe but no allergen callout when one is present
  10 = Proactively warns when a near-miss allergen situation is detected

TONE (Warm, helpful, appropriately conversational):
  1 = Robotic or condescending
  5 = Professional but impersonal
  10 = Warm, conversational, encouraging`;

// ─── Service call ─────────────────────────────────────────────────────────────

async function callRecipeChat(input: RecipeChatInput): Promise<string> {
  const messages = [
    ...input.conversationHistory,
    { role: "user" as const, content: input.userMessage },
  ];

  const userProfile = input.userProfile as UserProfile | null;

  let text = "";
  let recipe: unknown = null;

  for await (const event of generateRecipeChatResponse(messages, userProfile)) {
    if ("done" in event && event.done) break;
    if ("content" in event && event.content) {
      text += event.content;
    }
    if ("recipe" in event && event.recipe) {
      recipe = event.recipe;
    }
  }

  if (recipe && typeof recipe === "object") {
    const r = recipe as {
      title?: string;
      description?: string;
      ingredients?: { name: string; quantity: string; unit: string }[];
      instructions?: string[];
      dietTags?: string[];
    };
    const parts: string[] = [];
    if (r.title) parts.push(`Recipe: ${r.title}`);
    if (r.description) parts.push(r.description);
    if (r.ingredients?.length) {
      parts.push(
        "Ingredients:\n" +
          r.ingredients
            .map((i) => `- ${i.quantity} ${i.unit} ${i.name}`.trim())
            .join("\n"),
      );
    }
    if (r.instructions?.length) {
      parts.push(
        "Instructions:\n" +
          r.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      );
    }
    if (r.dietTags?.length) parts.push(`Tags: ${r.dietTags.join(", ")}`);
    return parts.join("\n\n");
  }

  return text;
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(__dirname, "datasets", "recipe-chat-cases.json");
const rawJson = fs.readFileSync(datasetPath, "utf8");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(rawJson);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: recipe-chat-cases.json is not valid JSON: ${message}`);
  process.exit(1);
}

const validation = recipeChatCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: recipe-chat-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "recipe-chat",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "relevance",
    "recipe_quality",
    "dietary_compliance",
    "safety",
    "tone",
  ],
  dimensionWeights: {
    relevance: 1,
    recipe_quality: 1,
    dietary_compliance: 1,
    safety: 2,
    tone: 1,
  },
  inputTag: "user_request",
  outputTag: "recipe_response",
  wordLimitWarning: 300,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as RecipeChatInput;
    const start = Date.now();
    const text = await callRecipeChat(i);
    const latencyMs = Date.now() - start;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return { text, latencyMs, wordCount };
  },

  formatInput: (testCase: EvalTestCase) => {
    const i = testCase.input as RecipeChatInput;
    const lines: string[] = [`User message: ${i.userMessage}`];
    if (i.userProfile) {
      if (i.userProfile.dietType) lines.push(`Diet: ${i.userProfile.dietType}`);
      if (i.userProfile.allergies.length > 0) {
        lines.push(`Allergies: ${i.userProfile.allergies.join(", ")}`);
      }
      if (i.userProfile.dislikes.length > 0) {
        lines.push(`Dislikes: ${i.userProfile.dislikes.join(", ")}`);
      }
    }
    if (i.conversationHistory.length > 0) {
      lines.push(`Prior turns: ${i.conversationHistory.length}`);
    }
    return lines.join("\n");
  },
});
