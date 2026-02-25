import { openai } from "../lib/openai";

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
  recentExercise: { todayCaloriesBurned: number; todayMinutes: number };
}

function buildSystemPrompt(context: CoachContext): string {
  const parts = [
    "You are NutriCoach, a friendly and knowledgeable nutrition coach AI built into the NutriScan app.",
    "Be conversational, supportive, and evidence-based. Keep responses concise (2-4 paragraphs max).",
    "Use markdown formatting for emphasis and structure when appropriate.",
    "Never diagnose medical conditions or replace professional medical advice.",
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
    parts.push(`Diet type: ${context.dietaryProfile.dietType}`);
  }
  if (context.dietaryProfile.allergies.length > 0) {
    parts.push(`Allergies: ${context.dietaryProfile.allergies.join(", ")}`);
  }
  if (context.dietaryProfile.dislikes.length > 0) {
    parts.push(`Food dislikes: ${context.dietaryProfile.dislikes.join(", ")}`);
  }
  if (context.recentExercise.todayMinutes > 0) {
    parts.push(
      `Today's exercise: ${context.recentExercise.todayMinutes}min, ${context.recentExercise.todayCaloriesBurned} cal burned`,
    );
  }

  return parts.join("\n");
}

export async function* generateCoachResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
): AsyncGenerator<string> {
  const systemPrompt = buildSystemPrompt(context);

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 1000,
    temperature: 0.7,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}
