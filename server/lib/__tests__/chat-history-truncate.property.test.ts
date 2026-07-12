/**
 * Property-based tests for chat-history-truncate (fast-check).
 *
 * The example-based suite (chat-history-truncate.test.ts) pins specific
 * boundary INPUTS (codepoint range edges, on-the-tie budgets, tier order).
 * This suite covers input CLASSES: arbitrary Unicode content, arbitrary
 * role sequences, and arbitrary budgets, asserting the module's invariants
 * rather than concrete outputs.
 *
 * Run location (documented decision, todo P3-2026-07-09): these properties
 * run in the NORMAL Vitest suite — discovered by the standard `**\/*.test.ts`
 * glob, so they run in the push-time fast gate (via `vitest related`) and in
 * full CI. At 100 runs per property over pure functions the whole file costs
 * tens of milliseconds; a separate slower suite is unjustified complexity.
 *
 * Mutation-testing coordination (stryker.targets.mjs): this file is
 * deliberately NOT added to the `chat-history-truncate` target's
 * `testInclude`. That registry intentionally scopes each mutation run to the
 * module's dedicated example unit test to measure THAT test's trustworthiness
 * in isolation; folding 100-run properties into the mutant loop would also
 * multiply per-mutant runtime on a module whose timeout classification is
 * already nondeterministic (see the target's breakThreshold comment). The two
 * signals stay complementary: mutation finds untested branches in the example
 * suite, properties find untested input classes here.
 *
 * Seed pinning: vitest.config.ts sets `retry: 2` to absorb CPU-contention
 * flakes. An UNSEEDED property that finds a real counterexample would re-run
 * with a fresh random seed on retry and could pass — masking a genuine bug as
 * a flake. A pinned seed makes any failure deterministic across all three
 * attempts and across runners; fast-check still prints the shrunk
 * counterexample on failure.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  truncateHistoryToBudget,
  estimateTokens,
  type HistoryMessage,
} from "../chat-history-truncate";

/** Shared fast-check run parameters — see "Seed pinning" in the header. */
const FC_PARAMS = { seed: 20260712, numRuns: 100 } as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const roleArb = fc.constantFrom<HistoryMessage["role"]>(
  "user",
  "assistant",
  "system",
  "tool",
);

/** Full-Unicode content (graphemes: ASCII, CJK, emoji, ZWJ sequences, …). */
const contentArb = fc.string({ unit: "grapheme", maxLength: 40 });

const messageArb: fc.Arbitrary<HistoryMessage> = fc.record({
  role: roleArb,
  content: contentArb,
});

const historyArb = fc.array(messageArb, { maxLength: 15 });

/** Small budgets so the truncation path is exercised often. */
const budgetArb = fc.integer({ min: 0, max: 150 });

/** Printable-ASCII-only content — every char lands in the "other" class. */
const asciiArb = fc.string({
  unit: fc
    .integer({ min: 0x20, max: 0x7e })
    .map((cp) => String.fromCharCode(cp)),
  maxLength: 60,
});

/** The exact CJK-class codepoint ranges from the implementation. */
const cjkUnit = fc
  .oneof(
    fc.integer({ min: 0x4e00, max: 0x9fff }), // CJK Unified Ideographs
    fc.integer({ min: 0x3400, max: 0x4dbf }), // CJK Extension A
    fc.integer({ min: 0xac00, max: 0xd7af }), // Hangul syllables
    fc.integer({ min: 0x3040, max: 0x30ff }), // Hiragana + Katakana
    fc.integer({ min: 0xff00, max: 0xffef }), // Fullwidth/Halfwidth forms
  )
  .map((cp) => String.fromCodePoint(cp));
const cjkArb = fc.string({ unit: cjkUnit, minLength: 1, maxLength: 60 });

/** Supplementary-plane codepoints (the emoji-class branch: cp > 0xFFFF). */
const suppUnit = fc
  .integer({ min: 0x10000, max: 0x10ffff })
  .map((cp) => String.fromCodePoint(cp));
const suppArb = fc.string({ unit: suppUnit, minLength: 1, maxLength: 30 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const est = (content: string): number =>
  estimateTokens({ role: "user", content });

const totalTokens = (msgs: HistoryMessage[]): number =>
  msgs.reduce((sum, m) => sum + estimateTokens(m), 0);

/** Most-recent message of `role`, or undefined. */
function lastOfRole(
  msgs: HistoryMessage[],
  role: HistoryMessage["role"],
): HistoryMessage | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === role) return msgs[i];
  }
  return undefined;
}

/** True when `sub` is a subsequence of `full` by reference identity. */
function isSubsequenceByRef(
  sub: HistoryMessage[],
  full: HistoryMessage[],
): boolean {
  let i = 0;
  for (const m of full) {
    if (i < sub.length && sub[i] === m) i++;
  }
  return i === sub.length;
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens — properties", () => {
  it("is a total function: non-negative integer, 0 exactly for empty content", () => {
    fc.assert(
      fc.property(contentArb, (content) => {
        const t = est(content);
        expect(Number.isInteger(t)).toBe(true);
        if (content.length === 0) {
          expect(t).toBe(0);
        } else {
          expect(t).toBeGreaterThanOrEqual(1);
        }
      }),
      FC_PARAMS,
    );
  });

  it("printable ASCII estimates exactly ceil(length / 4)", () => {
    fc.assert(
      fc.property(asciiArb, (content) => {
        const expected =
          content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4));
        expect(est(content)).toBe(expected);
      }),
      FC_PARAMS,
    );
  });

  it("CJK-class content estimates exactly 1 token per character", () => {
    fc.assert(
      fc.property(cjkArb, (content) => {
        expect(est(content)).toBe(content.length);
      }),
      FC_PARAMS,
    );
  });

  it("supplementary-plane content estimates exactly 2 tokens per codepoint", () => {
    fc.assert(
      fc.property(suppArb, (content) => {
        const codepoints = [...content].length;
        expect(est(content)).toBe(2 * codepoints);
      }),
      FC_PARAMS,
    );
  });

  it("concatenation is bounded: max(est(a), est(b)) <= est(a+b) <= est(a) + est(b)", () => {
    fc.assert(
      fc.property(contentArb, contentArb, (a, b) => {
        const joined = est(a + b);
        expect(joined).toBeGreaterThanOrEqual(Math.max(est(a), est(b)));
        expect(joined).toBeLessThanOrEqual(est(a) + est(b));
      }),
      FC_PARAMS,
    );
  });
});

// ---------------------------------------------------------------------------
// truncateHistoryToBudget
// ---------------------------------------------------------------------------

describe("truncateHistoryToBudget — properties", () => {
  it("result is always an order-preserving subsequence of the input", () => {
    fc.assert(
      fc.property(historyArb, budgetArb, (msgs, budget) => {
        const result = truncateHistoryToBudget(msgs, budget);
        expect(isSubsequenceByRef(result, msgs)).toBe(true);
      }),
      FC_PARAMS,
    );
  });

  it("returns the SAME array reference whenever the input fits the budget", () => {
    fc.assert(
      fc.property(historyArb, fc.nat(100), (msgs, slack) => {
        if (msgs.length === 0) {
          // Documented exception: empty input short-circuits to a new [].
          expect(truncateHistoryToBudget(msgs, slack)).toEqual([]);
          return;
        }
        const budget = totalTokens(msgs) + slack;
        expect(truncateHistoryToBudget(msgs, budget)).toBe(msgs);
      }),
      FC_PARAMS,
    );
  });

  it("always preserves the most-recent user and most-recent system message", () => {
    fc.assert(
      fc.property(historyArb, budgetArb, (msgs, budget) => {
        const result = truncateHistoryToBudget(msgs, budget);
        const lastUser = lastOfRole(msgs, "user");
        const lastSystem = lastOfRole(msgs, "system");
        if (lastUser) expect(result.includes(lastUser)).toBe(true);
        if (lastSystem) expect(result.includes(lastSystem)).toBe(true);
      }),
      FC_PARAMS,
    );
  });

  it("fits the budget, or only the always-preserved messages remain", () => {
    fc.assert(
      fc.property(historyArb, budgetArb, (msgs, budget) => {
        const result = truncateHistoryToBudget(msgs, budget);
        const lastUser = lastOfRole(msgs, "user");
        const lastSystem = lastOfRole(msgs, "system");
        const fits = totalTokens(result) <= budget;
        const onlyProtectedRemain = result.every(
          (m) => m === lastUser || m === lastSystem,
        );
        expect(fits || onlyProtectedRemain).toBe(true);
      }),
      FC_PARAMS,
    );
  });

  it("is idempotent: truncating an already-truncated history changes nothing", () => {
    fc.assert(
      fc.property(historyArb, budgetArb, (msgs, budget) => {
        const once = truncateHistoryToBudget(msgs, budget);
        const twice = truncateHistoryToBudget(once, budget);
        expect(twice).toEqual(once);
      }),
      FC_PARAMS,
    );
  });

  it("never mutates the input array or its messages", () => {
    fc.assert(
      fc.property(historyArb, budgetArb, (msgs, budget) => {
        const snapshot = msgs.map((m) => ({ ...m }));
        truncateHistoryToBudget(msgs, budget);
        expect(msgs).toEqual(snapshot);
      }),
      FC_PARAMS,
    );
  });

  it("prunes strictly by tier: a survivor in a tier implies no later tier was touched", () => {
    fc.assert(
      fc.property(historyArb, budgetArb, (msgs, budget) => {
        const result = truncateHistoryToBudget(msgs, budget);
        const survives = (m: HistoryMessage): boolean => result.includes(m);
        const lastSystem = lastOfRole(msgs, "system");

        // Pruning stops permanently the moment the budget is met, and phases
        // run tool → assistant → system → user. So:
        // 1. Any surviving tool message ⇒ every non-tool message survives.
        if (msgs.some((m) => m.role === "tool" && survives(m))) {
          for (const m of msgs) {
            if (m.role !== "tool") expect(survives(m)).toBe(true);
          }
        }
        // 2. Any surviving assistant message ⇒ every system/user message survives.
        if (msgs.some((m) => m.role === "assistant" && survives(m))) {
          for (const m of msgs) {
            if (m.role === "system" || m.role === "user") {
              expect(survives(m)).toBe(true);
            }
          }
        }
        // 3. Any surviving NON-protected system message ⇒ every user message survives.
        if (
          msgs.some(
            (m) => m.role === "system" && m !== lastSystem && survives(m),
          )
        ) {
          for (const m of msgs) {
            if (m.role === "user") expect(survives(m)).toBe(true);
          }
        }
      }),
      FC_PARAMS,
    );
  });
});
