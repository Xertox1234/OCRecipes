import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyTurn, CLASSIFY_TURN_TIMEOUT_MS } from "../classify-turn";
import { aiChat } from "../../../lib/ai-client";
import { createMockChatCompletion } from "../../../__tests__/factories";

vi.mock("../../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  validateAiResponse: vi.fn(
    (
      data: unknown,
      schema: {
        safeParse: (d: unknown) => { success: boolean; data?: unknown };
      },
    ) => {
      const r = schema.safeParse(data);
      return r.success ? r.data : null;
    },
  ),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(aiChat);
const returns = (json: unknown) =>
  mockCreate.mockResolvedValue(createMockChatCompletion(JSON.stringify(json)));

beforeEach(() => vi.clearAllMocks());

describe("classifyTurn", () => {
  it.each(["new_request", "refine_current", "other"] as const)(
    "returns %s from the model",
    async (cls) => {
      returns({ class: cls });
      await expect(
        classifyTurn("make it spicier", "Chicken Curry"),
      ).resolves.toBe(cls);
    },
  );

  it("falls back to new_request when the AI call throws", async () => {
    mockCreate.mockRejectedValue(new Error("Request timed out."));
    await expect(
      classifyTurn("make it spicier", "Chicken Curry"),
    ).resolves.toBe("new_request");
  });

  it("falls back to new_request on an out-of-vocabulary class", async () => {
    returns({ class: "refine" });
    await expect(classifyTurn("x", "y")).resolves.toBe("new_request");
  });

  it("uses a short timeout and JSON mode", async () => {
    returns({ class: "other" });
    await classifyTurn("thanks!", "Chicken Curry");
    const [feature, body, opts] = mockCreate.mock.calls[0];
    expect(feature).toBe("finder-classify-turn");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(opts?.timeout).toBe(CLASSIFY_TURN_TIMEOUT_MS);
  });
});
