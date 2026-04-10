import { openai, OPENAI_TIMEOUT_STREAM_MS, MODEL_FAST } from "../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  containsDangerousDietaryAdvice,
  SYSTEM_PROMPT_BOUNDARY,
} from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";
import { getToolDefinitions, executeToolCall, MAX_TOOL_CALLS_PER_RESPONSE } from "./coach-tools";

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
  screenContext?: string;
  notebookSummary?: string;
}

function buildSystemPrompt(context: CoachContext): string {
  const parts = [
    "You are NutriCoach, a friendly and knowledgeable nutrition coach AI built into the OCRecipes app.",
    "Be conversational, supportive, and evidence-based. Keep responses concise (2-4 paragraphs max).",
    "Use markdown formatting for emphasis and structure when appropriate.",
    "Never diagnose medical conditions or replace professional medical advice.",
    "Never recommend extreme calorie restriction (below 1200 cal/day), extreme fasting protocols, or any advice that could promote disordered eating.",
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

  if (context.screenContext) {
    parts.push(
      "",
      "SCREEN CONTEXT (user-reported, may be inaccurate):",
      sanitizeContextField(context.screenContext, 1500),
    );
  }

  if (context.notebookSummary) {
    parts.push(
      "",
      "WHAT YOU KNOW ABOUT THIS USER (from previous conversations):",
      context.notebookSummary,
    );
  }

  // Safety boundary is always LAST — after all context sections
  parts.push("", SYSTEM_PROMPT_BOUNDARY);

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

/**
 * Coach Pro response generator with tool calling support.
 * Yields text chunks while handling OpenAI tool calls internally.
 */
export async function* generateCoachProResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
  userId: string,
): AsyncGenerator<string> {
  const systemPrompt = buildSystemPrompt(context);
  const tools = getToolDefinitions();

  const sanitizedMessages = messages.map((m) => ({
    role: m.role,
    content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
  }));

  // Build the conversation with system prompt
  const conversation: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }> = [
    { role: "system", content: systemPrompt },
    ...sanitizedMessages,
  ];

  let toolCallCount = 0;
  let fullResponse = "";

  while (toolCallCount <= MAX_TOOL_CALLS_PER_RESPONSE) {
    let stream;
    try {
      stream = await openai.chat.completions.create(
        {
          model: MODEL_FAST,
          stream: true,
          messages: conversation as Parameters<typeof openai.chat.completions.create>[0]["messages"],
          tools,
          max_completion_tokens: 1000,
          temperature: 0.7,
        },
        { timeout: OPENAI_TIMEOUT_STREAM_MS },
      );
    } catch (error) {
      log.error({ err: toError(error) }, "coach pro API error");
      yield "Sorry, I'm having trouble responding right now. Please try again.";
      return;
    }

    // Track tool calls being built from stream deltas
    let finishReason: string | null = null;
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let contentInThisRound = "";

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        // Stream text content to caller
        const textDelta = choice.delta?.content;
        if (textDelta) {
          contentInThisRound += textDelta;
          fullResponse += textDelta;

          // Periodic safety check
          if (fullResponse.length % 200 < textDelta.length) {
            if (containsDangerousDietaryAdvice(fullResponse)) {
              yield "\n\n*I need to be careful here. For specific dietary plans, please consult a registered dietitian or healthcare provider.*";
              return;
            }
          }

          yield textDelta;
        }

        // Accumulate tool call deltas
        const toolCallDeltas = choice.delta?.tool_calls;
        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const existing = pendingToolCalls.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              pendingToolCalls.set(tc.index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            }
          }
        }
      }
    } catch (error) {
      log.error({ err: toError(error) }, "coach pro streaming error");
      yield "\n\nSorry, the response was interrupted. Please try again.";
      return;
    }

    // If finish_reason is not "tool_calls", we're done
    if (finishReason !== "tool_calls" || pendingToolCalls.size === 0) {
      break;
    }

    // Execute tool calls
    toolCallCount += pendingToolCalls.size;
    if (toolCallCount > MAX_TOOL_CALLS_PER_RESPONSE) {
      log.warn("Coach Pro: exceeded max tool calls per response");
      break;
    }

    // Add assistant message with tool_calls to conversation
    const toolCallsArray = Array.from(pendingToolCalls.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    conversation.push({
      role: "assistant",
      content: contentInThisRound || null,
      tool_calls: toolCallsArray,
    });

    // Execute each tool and add results
    for (const tc of toolCallsArray) {
      let result: unknown;
      try {
        const args = JSON.parse(tc.function.arguments);
        result = await executeToolCall(tc.function.name, args, userId);
      } catch (error) {
        log.warn({ err: toError(error), tool: tc.function.name }, "Tool call failed");
        result = { error: `Tool ${tc.function.name} failed: ${toError(error).message}` };
      }

      conversation.push({
        role: "tool",
        content: JSON.stringify(result),
        tool_call_id: tc.id,
      });
    }

    // Loop continues — OpenAI will generate response using tool results
  }

  // Final safety check
  if (containsDangerousDietaryAdvice(fullResponse)) {
    yield "\n\n*Please note: For specific dietary plans, especially restrictive ones, consult a registered dietitian or healthcare provider.*";
  }
}
