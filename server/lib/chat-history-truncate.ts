/**
 * Token-budget-aware history truncation for coach chat.
 *
 * Uses a cheap char-based approximation (1 token ≈ 4 chars) instead of
 * tiktoken to keep the estimator fast and dependency-free.
 *
 * Pruning order (oldest-first within each tier):
 *   1. Tool result messages  (`role: "tool"`)
 *   2. Assistant messages    (`role: "assistant"`)
 *   3. System messages       (`role: "system"`, most-recent preserved)
 *   4. User messages         (`role: "user"`, most-recent always preserved)
 *
 * The most-recent user message is always preserved.
 */

/** Message shape accepted by the OpenAI SDK and used by coach-pro-chat. */
export interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/** Characters per token for ASCII/Latin text. */
const CHARS_PER_TOKEN_ASCII = 4;

/** Default token budget for the history window (excludes system prompt). */
export const DEFAULT_HISTORY_TOKEN_BUDGET = 8_000;

/**
 * Estimate token count for a message using a heuristic that accounts for
 * CJK characters (≈1 char/token) and emoji (≈2 chars/token) to avoid
 * silent context-window overflow for non-ASCII conversations.
 *
 * Per-message role/delimiter overhead (~4 tokens) is intentionally omitted —
 * across a 20-message history the ~80-token undercount is < 1% of the 8,000
 * token budget.
 */
export function estimateTokens(message: HistoryMessage): number {
  const text = message.content;
  if (text.length === 0) return 0; // ← preserve existing "" → 0 behavior

  let cjkChars = 0;
  let emojiChars = 0;

  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
      (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
      (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
      (cp >= 0xff00 && cp <= 0xffef) // Fullwidth/Halfwidth forms
    ) {
      cjkChars++;
    } else if (cp > 0xffff) {
      // Supplementary planes (most emoji live here)
      emojiChars++;
    }
  }

  const otherChars = text.length - cjkChars - emojiChars * 2; // emoji are 2 JS chars (surrogate pairs)
  const cjkTokens = cjkChars; // 1 CJK char ≈ 1 token
  const emojiTokens = emojiChars * 2; // 1 emoji ≈ 2 tokens
  const asciiTokens = Math.ceil(
    Math.max(otherChars, 0) / CHARS_PER_TOKEN_ASCII,
  );

  return Math.max(1, cjkTokens + emojiTokens + asciiTokens);
}

/**
 * Truncate `messages` so that the total estimated token count stays within
 * `tokenBudget`. The last user message is always kept. Messages are pruned
 * oldest-first, with `role: "tool"` messages dropped before `role: "assistant"`
 * messages.
 *
 * Generic over message shape so callers with narrower role unions (e.g.
 * `"user" | "assistant" | "system"`) can pass their arrays directly and get
 * the same narrowed type back — no casting required at call sites.
 *
 * @param messages   Ordered history (oldest → newest). Must not include the
 *                   current user message — that is added by the caller.
 * @param tokenBudget  Maximum tokens allowed for the history window.
 * @returns           A new array that fits within the budget.
 */
export function truncateHistoryToBudget<T extends HistoryMessage>(
  messages: T[],
  tokenBudget: number = DEFAULT_HISTORY_TOKEN_BUDGET,
): T[] {
  if (messages.length === 0) return [];

  // Fast path: already under budget — return input unchanged.
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (totalTokens <= tokenBudget) return messages;

  // Work on a mutable copy — we'll null out pruned slots.
  const slots: (T | null)[] = [...messages];

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

  // Phase 3 — prune system messages oldest-first (keep the most-recent system message).
  let lastSystemIdx = -1;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i]?.role === "system") {
      lastSystemIdx = i;
      break;
    }
  }
  for (let i = 0; i < slots.length && remaining > tokenBudget; i++) {
    const msg = slots[i];
    if (msg !== null && msg.role === "system" && i !== lastSystemIdx) {
      remaining -= estimateTokens(msg);
      slots[i] = null;
    }
  }

  // Phase 4 — prune user messages oldest-first (always preserve the most-recent user message).
  for (let i = 0; i < slots.length && remaining > tokenBudget; i++) {
    const msg = slots[i];
    if (msg !== null && msg.role === "user" && i !== lastUserIdx) {
      remaining -= estimateTokens(msg);
      slots[i] = null;
    }
  }

  if (process.env.NODE_ENV !== "production" && remaining > tokenBudget) {
    // eslint-disable-next-line no-console
    console.warn(
      `[chat-history-truncate] History still over budget (${remaining} > ${tokenBudget}) ` +
        "after all pruning phases — most-recent user message exceeds budget alone.",
    );
  }

  // Filter out nulled slots and return.
  return slots.filter((m): m is T => m !== null);
}
