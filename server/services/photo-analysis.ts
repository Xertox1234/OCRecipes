import { z } from "zod";
import {
  foodCategorySchema,
  type PhotoIntent,
} from "@shared/constants/preparation";
import { getCuisineForFood } from "./cultural-food-map";
import { openai } from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";

// Zod schemas for runtime validation (from institutional learning: unsafe-type-cast-zod-validation)
const foodItemSchema = z.object({
  name: z.string(),
  quantity: z.string(),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().optional(),
  category: foodCategorySchema.optional().default("other"),
  cuisine: z.string().optional(),
});

const analysisResultSchema = z.object({
  foods: z.array(foodItemSchema),
  overallConfidence: z.number().min(0).max(1),
  followUpQuestions: z.array(z.string()),
});

export type FoodItem = z.infer<typeof foodItemSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// Confidence threshold for triggering follow-up questions
const CONFIDENCE_THRESHOLD = 0.7;

const CATEGORY_INSTRUCTION = `6. Food category: one of "protein", "vegetable", "grain", "fruit", "dairy", "beverage", "other"`;

const LOG_PROMPT = `You are a nutrition analysis assistant. Analyze food photos and identify:
1. Each distinct food item visible
2. Estimated portion size (e.g., "1 cup", "6 oz", "1 medium")
3. Your confidence level (0-1)
4. If uncertain about anything, include a clarifying question
5. Be specific with food names (e.g., "grilled chicken breast" not just "chicken")
${CATEGORY_INSTRUCTION}
7. Cuisine classification: identify the cuisine origin if recognizable (e.g., "Japanese", "Mexican", "Indian", "Italian")

Rules:
- Use standard US portion sizes
- If you see a beverage, note it separately
- If portion is unclear, set needsClarification to true

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only matching this schema:
{
  "foods": [
    {
      "name": "food name",
      "quantity": "portion size",
      "confidence": 0.85,
      "needsClarification": false,
      "clarificationQuestion": "optional question",
      "category": "protein",
      "cuisine": "optional cuisine"
    }
  ],
  "overallConfidence": 0.8,
  "followUpQuestions": ["any general questions about the meal"]
}`;

const IDENTIFY_PROMPT = `You are a food identification assistant. Identify the foods in this photo.
For each food item provide:
1. Name (be specific)
2. Estimated portion size
3. Category: one of "protein", "vegetable", "grain", "fruit", "dairy", "beverage", "other"

Keep responses brief. No confidence scoring needed — set confidence to 1.0 and needsClarification to false.

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only:
{
  "foods": [
    {
      "name": "food name",
      "quantity": "portion size",
      "confidence": 1.0,
      "needsClarification": false,
      "category": "vegetable"
    }
  ],
  "overallConfidence": 1.0,
  "followUpQuestions": []
}`;

const RECIPE_PROMPT = `You are an ingredient identification assistant. Identify the raw ingredients visible in this photo.
For each ingredient provide:
1. Name (e.g., "broccoli", "chicken breast")
2. Estimated quantity
3. Category: one of "protein", "vegetable", "grain", "fruit", "dairy", "beverage", "other"

Focus on identifying ingredients that could be used in recipes. Set confidence to 1.0 and needsClarification to false.

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only:
{
  "foods": [
    {
      "name": "ingredient name",
      "quantity": "estimated amount",
      "confidence": 1.0,
      "needsClarification": false,
      "category": "protein"
    }
  ],
  "overallConfidence": 1.0,
  "followUpQuestions": []
}`;

/** Get the system prompt and max completion tokens for a given intent */
export function getPromptForIntent(intent: PhotoIntent): {
  prompt: string;
  maxTokens: number;
} {
  switch (intent) {
    case "identify":
      return { prompt: IDENTIFY_PROMPT, maxTokens: 300 };
    case "recipe":
      return { prompt: RECIPE_PROMPT, maxTokens: 300 };
    case "log":
    case "calories":
    default:
      return { prompt: LOG_PROMPT, maxTokens: 500 };
  }
}

/**
 * Analyze a photo to identify foods and estimate portions
 * Uses GPT-4o Vision with detail: "low" for optimal speed (85 tokens, 512px)
 */
export async function analyzePhoto(
  imageBase64: string,
  intent: PhotoIntent = "log",
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const { prompt, maxTokens } = getPromptForIntent(intent);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Identify all foods in this image with portion estimates:",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "low", // 85 tokens, 512px - faster processing
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "{}";

    // Safe parsing with Zod
    const parsed = analysisResultSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      console.error("Vision API response validation failed:", parsed.error);
      return {
        foods: [],
        overallConfidence: 0,
        followUpQuestions: ["Could not analyze the image. Please try again."],
      };
    }

    // Enrich with cultural food data
    for (const food of parsed.data.foods) {
      if (!food.cuisine) {
        const detectedCuisine = getCuisineForFood(food.name);
        if (detectedCuisine) {
          food.cuisine = detectedCuisine;
        }
      }
    }

    console.warn(
      `Vision analysis (${intent}) completed in ${Date.now() - startTime}ms`,
    );
    return parsed.data;
  } catch (error) {
    console.error("Photo analysis error:", error);
    return {
      foods: [],
      overallConfidence: 0,
      followUpQuestions: [
        "An error occurred during analysis. Please try again.",
      ],
    };
  }
}

/**
 * Refine analysis based on follow-up answer
 */
export async function refineAnalysis(
  previousResult: AnalysisResult,
  question: string,
  answer: string,
): Promise<AnalysisResult> {
  // Sanitize user answer before interpolation into prompt
  const sanitizedAnswer = sanitizeUserInput(answer);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You are a nutrition analysis assistant. You previously analyzed a meal and had a follow-up question. Based on the user's answer, update the analysis.

Previous analysis: ${JSON.stringify(previousResult)}

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON matching the same schema, with updated foods and confidence.`,
        },
        {
          role: "user",
          content: `Question: "${question}"\nAnswer: "${sanitizedAnswer}"\n\nUpdate the analysis based on this clarification.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "{}";

    const parsed = analysisResultSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      console.error("Refinement validation failed:", parsed.error);
      return previousResult;
    }

    return parsed.data;
  } catch (error) {
    console.error("Refinement error:", error);
    return previousResult;
  }
}

/**
 * Check if analysis needs follow-up questions
 */
export function needsFollowUp(result: AnalysisResult): boolean {
  return (
    result.overallConfidence < CONFIDENCE_THRESHOLD ||
    result.followUpQuestions.length > 0 ||
    result.foods.some((food) => food.needsClarification)
  );
}

/**
 * Get all follow-up questions from an analysis result
 */
export function getFollowUpQuestions(result: AnalysisResult): string[] {
  const questions: string[] = [];

  // Add general follow-up questions
  questions.push(...result.followUpQuestions);

  // Add item-specific clarification questions
  for (const food of result.foods) {
    if (food.needsClarification && food.clarificationQuestion) {
      questions.push(food.clarificationQuestion);
    }
  }

  return questions;
}
