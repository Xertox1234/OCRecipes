/**
 * Token-budget-aware history truncation for coach chat.
 *
 * Uses a cheap char-based approximation (1 token ≈ 4 chars) instead of
 * tiktoken to keep the estimator fast and dependency-free.
 *
 * Pruning order (oldest-first within each tier):
 *   1. Tool result messages  (`role: "tool"`)
 *   2. Assistant messages    (`role: "assistant"`)
 *
 * The most-recent user message is always preserved.
 */

/** Message shape accepted by the OpenAI SDK and used by coach-pro-chat. */
export interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/** Characters per token approximation — 4 chars ≈ 1 token. */
const CHARS_PER_TOKEN = 4;

/** Default token budget for the history window (excludes system prompt). */
export const DEFAULT_HISTORY_TOKEN_BUDGET = 8_000;

/**
 * Estimate token count for a single message using the char-based approximation.
 */
export function estimateTokens(message: HistoryMessage): number {
  return Math.ceil(message.content.length / CHARS_PER_TOKEN);
}

/**
 * Truncate `messages` so that the total estimated token count stays within
 * `tokenBudget`. The last user message is always kept. Messages are pruned
 * oldest-first, with `role: "tool"` messages dropped before `role: "assistant"`
 * messages.
 *
 * @param messages   Ordered history (oldest → newest). Must not include the
 *                   current user message — that is added by the caller.
 * @param tokenBudget  Maximum tokens allowed for the history window.
 * @returns           A new array that fits within the budget.
 */
export function truncateHistoryToBudget(
  messages: HistoryMessage[],
  tokenBudget: number = DEFAULT_HISTORY_TOKEN_BUDGET,
): HistoryMessage[] {
  if (messages.length === 0) return [];

  // Fast path: already under budget — return input unchanged.
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (totalTokens <= tokenBudget) return messages;

  // Work on a mutable copy — we'll null out pruned slots.
  const slots: (HistoryMessage | null)[] = [...messages];

  // Find the index of the last user message so we always preserve it.
  let lastUserIdx = -1;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  let remaining = totalTokens;

  // Phase 1 — prune tool result messages oldest-first.
  for (let i = 0; i < slots.length && remaining > tokenBudget; i++) {
    const msg = slots[i];
    if (msg !== null && msg.role === "tool" && i !== lastUserIdx) {
      remaining -= estimateTokens(msg);
      slots[i] = null;
    }
  }

  // Phase 2 — prune assistant messages oldest-first.
  for (let i = 0; i < slots.length && remaining > tokenBudget; i++) {
    const msg = slots[i];
    if (msg !== null && msg.role === "assistant" && i !== lastUserIdx) {
      remaining -= estimateTokens(msg);
      slots[i] = null;
    }
  }

  // Filter out nulled slots and return.
  return slots.filter((m): m is HistoryMessage => m !== null);
}
