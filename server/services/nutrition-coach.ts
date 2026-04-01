import { openai, OPENAI_TIMEOUT_STREAM_MS, MODEL_FAST } from "../lib/openai";
import {
  sanitizeUserInput,
  containsDangerousDietaryAdvice,
  SYSTEM_PROMPT_BOUNDARY,
} from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("nutrition-coach");

export interface CoachContext {
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
  weightTrend: { currentWeight: number | null; weeklyRate: number | null };
  dietaryProfile: {
    dietType: string | null;
    allergies: string[];
    dislikes: string[];
  };
}

function buildSystemPrompt(context: CoachContext): string {
  const parts = [
    "You are NutriCoach, a friendly and knowledgeable nutrition coach AI built into the OCRecipes app.",
    "Be conversational, supportive, and evidence-based. Keep responses concise (2-4 paragraphs max).",
    "Use markdown formatting for emphasis and structure when appropriate.",
    "Never diagnose medical conditions or replace professional medical advice.",
    "Never recommend extreme calorie restriction (below 1200 cal/day), extreme fasting protocols, or any advice that could promote disordered eating.",
    "",
    SYSTEM_PROMPT_BOUNDARY,
    "",
    "USER CONTEXT:",
  ];

  if (context.goals) {
    parts.push(
      `Daily goals: ${context.goals.calories} cal, ${context.goals.protein}g protein, ${context.goals.carbs}g carbs, ${context.goals.fat}g fat`,
    );
  }
  parts.push(
    `Today's intake: ${context.todayIntake.calories} cal, ${context.todayIntake.protein}g protein, ${context.todayIntake.carbs}g carbs, ${context.todayIntake.fat}g fat`,
  );

  if (context.weightTrend.currentWeight) {
    parts.push(
      `Current weight: ${context.weightTrend.currentWeight}kg${context.weightTrend.weeklyRate ? `, weekly change: ${context.weightTrend.weeklyRate}kg/week` : ""}`,
    );
  }
  if (context.dietaryProfile.dietType) {
    parts.push(
      `Diet type: ${sanitizeUserInput(context.dietaryProfile.dietType)}`,
    );
  }
  if (context.dietaryProfile.allergies.length > 0) {
    parts.push(
      `Allergies: ${context.dietaryProfile.allergies.map(sanitizeUserInput).join(", ")}`,
    );
  }
  if (context.dietaryProfile.dislikes.length > 0) {
    parts.push(
      `Food dislikes: ${context.dietaryProfile.dislikes.map(sanitizeUserInput).join(", ")}`,
    );
  }
  return parts.join("\n");
}

export async function* generateCoachResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
): AsyncGenerator<string> {
  const systemPrompt = buildSystemPrompt(context);

  // Sanitize user messages before including in conversation history
  const sanitizedMessages = messages.map((m) => ({
    role: m.role,
    content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
  }));

  let stream;
  try {
    stream = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...sanitizedMessages,
        ],
        max_completion_tokens: 1000,
        temperature: 0.7,
      },
      { timeout: OPENAI_TIMEOUT_STREAM_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "coach API error");
    yield "Sorry, I'm having trouble responding right now. Please try again.";
    return;
  }

  // Accumulate full response for content filtering
  let fullResponse = "";

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;

        // Check periodically (every ~200 chars) for dangerous content
        if (fullResponse.length % 200 < delta.length) {
          if (containsDangerousDietaryAdvice(fullResponse)) {
            yield "\n\n*I need to be careful here. For specific dietary plans, especially very low calorie or fasting protocols, please consult a registered dietitian or healthcare provider who can assess your individual needs.*";
            return;
          }
        }

        yield delta;
      }
    }
  } catch (error) {
    log.error({ err: toError(error) }, "coach streaming error");
    yield "\n\nSorry, the response was interrupted. Please try again.";
    return;
  }

  // Final check on complete response
  if (containsDangerousDietaryAdvice(fullResponse)) {
    yield "\n\n*Please note: For specific dietary plans, especially restrictive ones, consult a registered dietitian or healthcare provider.*";
  }
}
