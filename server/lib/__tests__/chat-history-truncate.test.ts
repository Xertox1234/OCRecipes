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

  it("estimates CJK text at exactly 1 token per character", () => {
    // 5 Hangul chars → cjkChars=5 → 5 tokens. Exact (not a range) so the
    // `cjkTokens = cjkChars` and CJK-range mutants can't survive in-band.
    expect(estimateTokens({ role: "user", content: "한글텍스트" })).toBe(5);
  });

  it("estimates emoji at exactly 2 tokens each", () => {
    // 4 emoji → emojiChars=4 → emojiTokens=8; otherChars = 8 - 4*2 = 0.
    // Exact assertions kill the `emojiChars * 2` and `- emojiChars * 2` mutants.
    expect(estimateTokens({ role: "user", content: "🍎🍊🍋🍇" })).toBe(8);
    expect(estimateTokens({ role: "user", content: "🍎" })).toBe(2);
    // 2 emoji → otherChars = 4 - 0 - 4 = 0 → 4 tokens (kills the `/ 2` arithmetic mutant,
    // which would leave otherChars = 4 - 1 = 3 → ceil(3/4)=1 extra token).
    expect(estimateTokens({ role: "user", content: "🍎🍊" })).toBe(4);
  });
});

describe("estimateTokens — codepoint classification boundaries", () => {
  const tok = (content: string): number =>
    estimateTokens({ role: "user", content });

  // A 4-char string distinguishes CJK (n tokens) from ASCII (ceil(4/4)=1 token), so
  // each boundary codepoint repeated 4× must classify as CJK → exactly 4 tokens. This
  // kills the off-by-one EqualityOperator mutants (`>=`→`>`, `<=`→`<`) at each range edge.
  const cjkBoundaries: [string, number][] = [
    ["CJK Unified start U+4E00", 0x4e00],
    ["CJK Unified end U+9FFF", 0x9fff],
    ["CJK Ext-A start U+3400", 0x3400],
    ["CJK Ext-A end U+4DBF", 0x4dbf],
    ["Hangul start U+AC00", 0xac00],
    ["Hangul end U+D7AF", 0xd7af],
    ["Hiragana/Katakana start U+3040", 0x3040],
    ["Hiragana/Katakana end U+30FF", 0x30ff],
    ["Fullwidth start U+FF00", 0xff00],
    ["Fullwidth end U+FFEF", 0xffef],
  ];
  it.each(cjkBoundaries)(
    "classifies %s as CJK (4 chars → 4 tokens)",
    (_l, cp) => {
      expect(tok(String.fromCodePoint(cp).repeat(4))).toBe(4);
    },
  );

  // Codepoints in the inter-range gaps must NOT be CJK: 4 chars → 1 ASCII token. These
  // kill the "drop a bound" ConditionalExpression mutants (e.g. `cp >= S && true`),
  // which would otherwise pull an out-of-range codepoint into the CJK class.
  const outsideRanges: [string, number][] = [
    ["below Hiragana U+303F", 0x303f],
    ["above Katakana / below Ext-A U+3100", 0x3100],
    ["between Ext-A and CJK U+4DFF", 0x4dff],
    ["above CJK / below Hangul U+A000", 0xa000],
    ["between Hangul and Fullwidth U+E000", 0xe000],
    ["above Fullwidth, below emoji U+FFF0", 0xfff0],
  ];
  it.each(outsideRanges)(
    "classifies %s as non-CJK (4 chars → 1 token)",
    (_l, cp) => {
      expect(tok(String.fromCodePoint(cp).repeat(4))).toBe(1);
    },
  );

  it("treats U+FFFF as non-emoji (boundary is cp > 0xFFFF, not >=)", () => {
    // 0xFFFF is BMP → 'other'; 4 chars → 1 token. Mutant `cp >= 0xffff` → emoji → 8.
    expect(tok(String.fromCodePoint(0xffff).repeat(4))).toBe(1);
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

  it("prunes system messages when tool and assistant pruning is insufficient", () => {
    // Budget: 10 tokens. Two system messages + user; need to drop 11 tokens.
    const messages: HistoryMessage[] = [
      { role: "system", content: "a".repeat(40) }, // 40 chars ≈ 10 tokens — old system message
      { role: "system", content: "b".repeat(40) }, // 40 chars ≈ 10 tokens — recent system message
      { role: "user", content: "hi" }, // 2 chars ≈ 1 token
    ];
    // total = 21 tokens, budget = 10 → need to drop 11 tokens
    const result = truncateHistoryToBudget(messages, 10);
    // Old system message pruned; most-recent system message and user preserved
    const systemMsgs = result.filter((m) => m.role === "system");
    expect(systemMsgs.length).toBe(1);
    expect(systemMsgs[0].content).toBe("b".repeat(40));
    expect(result.find((m) => m.role === "user")).toBeDefined();
  });

  it("prunes old user messages when system pruning is still insufficient", () => {
    const messages: HistoryMessage[] = [
      { role: "user", content: "a".repeat(80) }, // old large user message, ~20 tokens
      { role: "user", content: "hi" }, // most-recent user message, ~1 token
    ];
    const result = truncateHistoryToBudget(messages, 3);
    // Old user message pruned; most-recent preserved
    const userMsgs = result.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
    expect(userMsgs[0].content).toBe("hi");
  });

  it("always preserves the most-recent user message even when over budget after all phases", () => {
    const hugeUser = { role: "user" as const, content: "a".repeat(10000) }; // way over budget
    const result = truncateHistoryToBudget([hugeUser], 5);
    // Cannot prune the only user message
    expect(result).toContain(hugeUser);
  });
});

describe("truncateHistoryToBudget — on-the-tie budget boundaries", () => {
  it("returns the SAME array reference when total exactly equals budget (<= fast path)", () => {
    // total = 1 + 1 = 2 tokens, budget exactly 2. The `totalTokens <= budget` fast path
    // returns the input array itself. A `<` mutant (or `if (false)`) falls through to the
    // slow path, which returns a NEW array of equal content — caught only by `toBe`.
    const messages: HistoryMessage[] = [msg("assistant", 4), msg("user", 4)];
    expect(truncateHistoryToBudget(messages, 2)).toBe(messages);
  });

  it("stops user-phase pruning the moment remaining equals budget (> not >=)", () => {
    const userA = msg("user", 40, "a".repeat(40)); // 10 tokens (oldest)
    const userB = msg("user", 40, "b".repeat(40)); // 10 tokens
    const userLast = msg("user", 40, "c".repeat(40)); // 10 tokens (always preserved)
    // total=30, budget=20. Prune userA → remaining=20 == budget → `>` stops, userB survives.
    // The `remaining >= budget` mutant over-prunes userB.
    const result = truncateHistoryToBudget([userA, userB, userLast], 20);
    expect(result).toContainEqual(userB);
    expect(result).not.toContainEqual(userA);
  });

  it("stops system-phase pruning the moment remaining equals budget (> not >=)", () => {
    const sysA = msg("system", 40, "a".repeat(40)); // 10 tokens (oldest, prunable)
    const sysB = msg("system", 40, "b".repeat(40)); // 10 tokens (prunable)
    const sysLast = msg("system", 40, "c".repeat(40)); // 10 tokens (most-recent, protected)
    const userLast = msg("user", 1, "z"); // 1 token
    // total=31, budget=21. Phase 3 prunes sysA → remaining=21 == budget → `>` stops, sysB
    // survives. The `remaining >= budget` mutant over-prunes sysB, leaving only sysLast.
    const result = truncateHistoryToBudget([sysA, sysB, sysLast, userLast], 21);
    const systems = result
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    expect(systems).toEqual(["b".repeat(40), "c".repeat(40)]);
  });

  it("prunes correctly when there is no user message (lastUserIdx -1 sentinel)", () => {
    const toolA = msg("tool", 40, "a".repeat(40)); // 10 tokens
    const toolB = msg("tool", 40, "b".repeat(40)); // 10 tokens
    const asst = msg("assistant", 40, "c".repeat(40)); // 10 tokens
    // No user message → lastUserIdx stays -1. Both tools prune; assistant survives. A
    // `lastUserIdx = +1` mutant spuriously protects index 1 (toolB) and prunes asst instead.
    const result = truncateHistoryToBudget([toolA, toolB, asst], 10);
    expect(result).toEqual([asst]);
  });
});
