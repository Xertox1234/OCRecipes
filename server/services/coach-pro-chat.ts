/**
 * Coach Pro Chat Service
 *
 * Orchestrates the Coach chat path (both standard and Pro):
 *   - Context building from multiple storage domains
 *   - Notebook injection (Pro)
 *   - Warm-up consumption (Pro)
 *   - Response caching
 *   - Block parsing (Pro)
 *   - Message persistence
 *   - Auto-titling
 *   - Notebook extraction (Pro)
 *
 * Extracted from server/routes/chat.ts to keep route handlers thin.
 */

import { createHash } from "crypto";
import { storage } from "../storage";
import {
  generateCoachResponse,
  generateCoachProResponse,
  type CoachContext,
} from "./nutrition-coach";
import { parseBlocksFromContent, BLOCKS_SYSTEM_PROMPT } from "./coach-blocks";
import { extractNotebookEntries } from "./notebook-extraction";
import { sanitizeContextField } from "../lib/ai-safety";
import { fireAndForget } from "../lib/fire-and-forget";
import { consumeWarmUp } from "./coach-warm-up";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

/** SSE event yielded by the coach chat service. */
export type CoachChatEvent =
  | { type: "content"; content: string }
  | { type: "blocks"; blocks: CoachBlock[] };

export interface CoachChatParams {
  conversationId: number;
  userId: string;
  content: string;
  screenContext?: string;
  warmUpId?: string;
  isCoachPro: boolean;
  user: {
    dailyCalorieGoal: number | null;
    dailyProteinGoal: number | null;
    dailyCarbsGoal: number | null;
    dailyFatGoal: number | null;
  };
  /** Called each iteration to check if the client disconnected. */
  isAborted: () => boolean;
}

/**
 * Orchestrates the coach chat response — yields SSE events for the route
 * handler to write, handles persistence and side-effects internally.
 */
export async function* handleCoachChat(
  params: CoachChatParams,
): AsyncGenerator<CoachChatEvent> {
  const {
    conversationId,
    userId,
    content,
    screenContext,
    warmUpId,
    isCoachPro,
    user,
    isAborted,
  } = params;

  const today = new Date();
  const [profile, dailySummary, latestWeight, history] = await Promise.all([
    storage.getUserProfile(userId),
    storage.getDailySummary(userId, today),
    storage.getLatestWeight(userId),
    storage.getChatMessages(conversationId, 20),
  ]);

  const context: CoachContext = {
    goals: user.dailyCalorieGoal
      ? {
          calories: user.dailyCalorieGoal,
          protein: user.dailyProteinGoal || 0,
          carbs: user.dailyCarbsGoal || 0,
          fat: user.dailyFatGoal || 0,
        }
      : null,
    todayIntake: {
      calories: Number(dailySummary.totalCalories),
      protein: Number(dailySummary.totalProtein),
      carbs: Number(dailySummary.totalCarbs),
      fat: Number(dailySummary.totalFat),
    },
    weightTrend: {
      currentWeight: latestWeight ? parseFloat(latestWeight.weight) : null,
      weeklyRate: null,
    },
    dietaryProfile: {
      dietType: profile?.dietType || null,
      allergies: ((profile?.allergies as { name: string }[] | null) || []).map(
        (a) => a.name,
      ),
      dislikes: (profile?.foodDislikes as string[]) || [],
    },
    screenContext,
  };

  // ── Coach Pro: inject notebook context ──────────────
  if (isCoachPro) {
    const notebookEntries = await storage.getActiveNotebookEntries(userId);
    if (notebookEntries.length > 0) {
      // Budget ~800 tokens (~3200 chars) for notebook context
      const MAX_NOTEBOOK_CHARS = 3200;
      let charCount = 0;
      const lines: string[] = [];
      for (const e of notebookEntries) {
        const line = `[${e.type}] ${sanitizeContextField(e.content, 500)}`;
        if (charCount + line.length > MAX_NOTEBOOK_CHARS) break;
        lines.push(line);
        charCount += line.length;
      }
      context.notebookSummary =
        lines.join("\n") + "\n\n" + BLOCKS_SYSTEM_PROMPT;
    } else {
      context.notebookSummary = BLOCKS_SYSTEM_PROMPT;
    }
  }

  let messageHistory = history.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  // ── Coach Pro: consume warm-up if available ─────────
  if (isCoachPro && warmUpId) {
    const warmedUp = consumeWarmUp(userId, warmUpId);
    if (warmedUp) {
      // Warm-up already has conversation history — use it
      // The last message in warmedUp is the interim transcript;
      // replace it with the final transcript
      warmedUp[warmedUp.length - 1] = {
        role: "user",
        content,
      };
      messageHistory = warmedUp as typeof messageHistory;
    }
  }

  // Check cache for predefined questions (no screenContext = universal answer)
  const isCacheable = !screenContext && history.length <= 1;
  const questionHash = isCacheable
    ? createHash("sha256")
        .update(content.trim().toLowerCase())
        .digest("hex")
        .slice(0, 32)
    : null;

  let cachedResponse: string | null = null;
  if (questionHash) {
    cachedResponse = await storage.getCoachCachedResponse(questionHash);
  }

  let fullResponse = "";

  if (cachedResponse) {
    // Send cached response in 3 chunks with minimal delay
    const len = cachedResponse.length;
    const third = Math.ceil(len / 3);
    const chunks = [
      cachedResponse.slice(0, third),
      cachedResponse.slice(third, third * 2),
      cachedResponse.slice(third * 2),
    ].filter((c) => c.length > 0);
    for (let ci = 0; ci < chunks.length && !isAborted(); ci++) {
      fullResponse += chunks[ci];
      yield { type: "content", content: chunks[ci] };
      if (ci < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  } else if (isCoachPro) {
    for await (const chunk of generateCoachProResponse(
      messageHistory,
      context,
      userId,
    )) {
      if (isAborted()) break;
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }
  } else {
    for await (const chunk of generateCoachResponse(messageHistory, context)) {
      if (isAborted()) break;
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }

    if (questionHash && fullResponse && !isAborted()) {
      fireAndForget(
        "coach-cache-response",
        storage.setCoachCachedResponse(questionHash, content, fullResponse),
      );
    }
  }

  // Parse blocks from response for Coach Pro
  let blocks: CoachBlock[] = [];
  let textContent = fullResponse;
  if (isCoachPro && fullResponse) {
    const parsed_blocks = parseBlocksFromContent(fullResponse);
    textContent = parsed_blocks.text;
    blocks = parsed_blocks.blocks;
  }

  if (fullResponse) {
    await storage.createChatMessage(
      conversationId,
      "assistant",
      textContent,
      blocks.length > 0 ? { blocks } : null,
    );
  }

  if (!isAborted() && history.length <= 1) {
    const shortTitle =
      content.slice(0, 50) + (content.length > 50 ? "..." : "");
    fireAndForget(
      "coach-chat-auto-title",
      storage.updateChatConversationTitle(conversationId, userId, shortTitle),
    );
  }

  // Send blocks in the final event for Coach Pro
  if (!isAborted() && blocks.length > 0) {
    yield { type: "blocks", blocks };
  }

  // Fire-and-forget notebook extraction + archival for Coach Pro
  if (isCoachPro && fullResponse && !isAborted()) {
    fireAndForget(
      "coach-notebook-extraction",
      (async () => {
        const allMessages = [
          ...messageHistory,
          { role: "user" as const, content },
          { role: "assistant" as const, content: textContent },
        ];
        const entries = await extractNotebookEntries(
          allMessages,
          userId,
          conversationId,
        );
        if (entries.length > 0) {
          await storage.createNotebookEntries(
            entries.map((e) => ({
              userId,
              type: e.type,
              content: e.content,
              status: "active",
              followUpDate: e.followUpDate ? new Date(e.followUpDate) : null,
              sourceConversationId: conversationId,
            })),
          );
        }
        // Archive notebook entries older than 30 days to bound growth
        await storage.archiveOldEntries(userId, 30);
      })(),
    );
  }
}
