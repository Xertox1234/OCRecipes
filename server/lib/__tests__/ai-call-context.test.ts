// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getAiCallContext, withAiCallContext } from "../ai-call-context";
import type { AiCallContext } from "../ai-call-context";

const ctx = (): AiCallContext => ({
  overrides: {},
  fallback: "off",
  calls: [],
});

describe("ai call context", () => {
  it("is undefined outside a context (all production traffic)", () => {
    expect(getAiCallContext()).toBeUndefined();
  });

  it("is visible across awaits and inside async generators consumed in the context", async () => {
    const c = ctx();
    async function* gen() {
      await Promise.resolve();
      yield getAiCallContext();
    }
    await withAiCallContext(c, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getAiCallContext()).toBe(c);
      for await (const seen of gen()) expect(seen).toBe(c);
    });
    expect(getAiCallContext()).toBeUndefined();
  });

  it("isolates concurrent contexts", async () => {
    const a = ctx();
    const b = ctx();
    const seen = await Promise.all([
      withAiCallContext(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getAiCallContext();
      }),
      withAiCallContext(b, async () => getAiCallContext()),
    ]);
    expect(seen[0]).toBe(a);
    expect(seen[1]).toBe(b);
  });
});
