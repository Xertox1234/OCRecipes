import { describe, it, expect } from "vitest";
import {
  truncateHistoryToBudget,
  estimateTokens,
  DEFAULT_HISTORY_TOKEN_BUDGET,
  type HistoryMessage,
} from "../chat-history-truncate";

// Helper: build a message with a content of `chars` characters
function msg(
  role: HistoryMessage["role"],
  chars: number,
  content?: string,
): HistoryMessage {
  return { role, content: content ?? "x".repeat(chars) };
}

// Helper: sum of token estimates across messages
function totalTokens(messages: HistoryMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

describe("estimateTokens", () => {
  it("returns ceil(content.length / 4)", () => {
    expect(estimateTokens({ role: "user", content: "abcd" })).toBe(1);
    expect(estimateTokens({ role: "user", content: "abcde" })).toBe(2);
    expect(estimateTokens({ role: "user", content: "" })).toBe(0);
  });
});

describe("truncateHistoryToBudget", () => {
  it("returns empty array unchanged", () => {
    expect(truncateHistoryToBudget([], 100)).toEqual([]);
  });

  it("returns messages unchanged when already within budget", () => {
    const messages: HistoryMessage[] = [
      msg("user", 8), // 2 tokens
      msg("assistant", 8), // 2 tokens
    ];
    const result = truncateHistoryToBudget(messages, 100);
    expect(result).toEqual(messages);
  });

  it("uses DEFAULT_HISTORY_TOKEN_BUDGET when no budget passed", () => {
    // Messages well under 8000 tokens
    const messages: HistoryMessage[] = [msg("user", 16), msg("assistant", 16)];
    expect(truncateHistoryToBudget(messages)).toEqual(messages);
  });

  it("drops oldest tool messages first when over budget", () => {
    // Budget = 10 tokens = 40 chars
    const toolOld = msg("tool", 40); // 10 tokens — oldest
    const toolNew = msg("tool", 40); // 10 tokens — newer
    const user = msg("user", 40); // 10 tokens — last user (preserved)

    const messages = [toolOld, toolNew, user];
    // total = 30 tokens, budget = 20 → need to drop 10 tokens worth
    const result = truncateHistoryToBudget(messages, 20);

    expect(result).not.toContain(toolOld);
    expect(result).toContainEqual(toolNew);
    expect(result).toContainEqual(user);
    expect(totalTokens(result)).toBeLessThanOrEqual(20);
  });

  it("drops assistant messages after tool messages are exhausted", () => {
    const assistantOld = msg("assistant", 40, "a".repeat(40)); // 10 tokens
    const assistantNew = msg("assistant", 40, "b".repeat(40)); // 10 tokens
    const user = msg("user", 40); // 10 tokens

    const messages = [assistantOld, assistantNew, user];
    // total = 30 tokens, budget = 20 → drop 10 tokens (oldest assistant)
    const result = truncateHistoryToBudget(messages, 20);

    expect(result).not.toContainEqual(assistantOld);
    expect(result).toContainEqual(assistantNew);
    expect(result).toContainEqual(user);
    expect(totalTokens(result)).toBeLessThanOrEqual(20);
  });

  it("always preserves the last user message even if it alone exceeds budget", () => {
    const bigUser = msg("user", 200); // 50 tokens
    const assistant = msg("assistant", 40); // 10 tokens

    const messages = [assistant, bigUser];
    // budget = 10 tokens — user message alone exceeds it, but must be kept
    const result = truncateHistoryToBudget(messages, 10);

    expect(result).toContainEqual(bigUser);
  });

  it("prunes tool messages before assistant messages", () => {
    // budget = 20 tokens; we have 30 total; need to shed 10
    const toolMsg = msg("tool", 40); // 10 tokens — should be pruned first
    const assistantMsg = msg("assistant", 40); // 10 tokens — should survive
    const userMsg = msg("user", 40); // 10 tokens — always preserved

    const messages = [toolMsg, assistantMsg, userMsg];
    const result = truncateHistoryToBudget(messages, 20);

    expect(result).not.toContainEqual(toolMsg);
    expect(result).toContainEqual(assistantMsg);
    expect(result).toContainEqual(userMsg);
  });

  it("returns a new array (does not mutate the input)", () => {
    const messages: HistoryMessage[] = [msg("tool", 40), msg("user", 40)];
    const copy = [...messages];
    truncateHistoryToBudget(messages, 5);
    expect(messages).toEqual(copy);
  });

  it("drops multiple tiers when necessary to meet budget", () => {
    const toolOld = msg("tool", 40); // 10 tokens
    const assistantOld = msg("assistant", 40); // 10 tokens
    const userMsg = msg("user", 40); // 10 tokens

    // total = 30 tokens, budget = 10 → keep only last user message
    const result = truncateHistoryToBudget(
      [toolOld, assistantOld, userMsg],
      10,
    );

    expect(result).toEqual([userMsg]);
  });

  it("does not drop messages with role 'system' even when over budget", () => {
    // System messages are not prunable by the strategy
    const systemMsg = msg("system", 40); // 10 tokens
    const toolMsg = msg("tool", 40); // 10 tokens
    const userMsg = msg("user", 40); // 10 tokens

    const messages = [systemMsg, toolMsg, userMsg];
    // budget = 15 → shed 15 tokens; tool (10) dropped, system kept
    const result = truncateHistoryToBudget(messages, 15);

    expect(result).toContainEqual(systemMsg);
    expect(result).not.toContainEqual(toolMsg);
    expect(result).toContainEqual(userMsg);
  });

  it("DEFAULT_HISTORY_TOKEN_BUDGET is 8000", () => {
    expect(DEFAULT_HISTORY_TOKEN_BUDGET).toBe(8_000);
  });
});
