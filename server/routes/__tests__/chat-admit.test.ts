import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";
import type { ChatMessage } from "@shared/schema";
import type { AuthenticatedRequest } from "../../middleware/auth";
import { storage } from "../../storage";
import {
  isRecipeFinderEnabled,
  isRecipeOfferEnabled,
  decideRecipeChefEntry,
  isActionCurrent,
  classifyTurn,
} from "../../services/recipe-finder";
import { openSse, type TurnFeatures } from "../chat-stream";
import { admitTurn, type AdmitTurnArgs } from "../chat-admit";

vi.mock("../../storage", () => ({
  storage: {
    getChatMessages: vi.fn(),
    createFinderUserMessage: vi.fn(),
    createChatMessageWithLimitCheck: vi.fn(),
  },
}));

vi.mock("../../services/recipe-finder", () => ({
  isRecipeFinderEnabled: vi.fn(),
  isRecipeOfferEnabled: vi.fn(),
  decideRecipeChefEntry: vi.fn(),
  getLatestFinderBlock: vi.fn(() => null),
  isActionCurrent: vi.fn(),
  classifyTurn: vi.fn(),
}));

vi.mock("../chat-stream", () => ({
  openSse: vi.fn(),
  CONVERSATION_CONFIG: {
    coach: {
      dailyLimit: () => 10,
      limitMessage: () => "Coach limit reached",
    },
    recipe: {
      dailyLimit: () => 3,
      limitMessage: () => "Recipe limit reached",
    },
    remix: {
      dailyLimit: () => 3,
      limitMessage: () => "Remix limit reached",
    },
  },
}));

const userMessage = { id: 501, content: "hi" } as unknown as ChatMessage;
const action: NonNullable<AdmitTurnArgs["finderAction"]> = {
  flowId: "flow-1",
  type: "generate",
};

function fakeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function args(overrides: Partial<AdmitTurnArgs> = {}): AdmitTurnArgs {
  return {
    req: { userId: "u1" } as AuthenticatedRequest,
    res: fakeRes() as unknown as Response,
    conversationId: 7,
    conversationType: "coach",
    features: {
      coachPro: true,
      coachProDailyMessages: 50,
    } as unknown as TurnFeatures,
    sanitizedContent: "hi",
    finderAction: undefined,
    ...overrides,
  };
}

const resOf = (a: AdmitTurnArgs) =>
  a.res as unknown as ReturnType<typeof fakeRes>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isRecipeFinderEnabled).mockReturnValue(true);
  vi.mocked(isRecipeOfferEnabled).mockReturnValue(false);
  vi.mocked(storage.getChatMessages).mockResolvedValue([]);
  vi.mocked(isActionCurrent).mockReturnValue(true);
  vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
    userMessage,
  );
});

describe("admitTurn — finder action gate", () => {
  it.each([
    ["the finder flag is off", { flag: false, type: "coach", coachPro: true }],
    ["it is a remix chat", { flag: true, type: "remix", coachPro: true }],
    [
      "a Coach user is not Coach Pro",
      { flag: true, type: "coach", coachPro: false },
    ],
  ] as const)("409s a finder action when %s", async (_label, c) => {
    vi.mocked(isRecipeFinderEnabled).mockReturnValue(c.flag);
    const a = args({
      conversationType: c.type,
      finderAction: action,
      features: { coachPro: c.coachPro } as unknown as TurnFeatures,
    });

    expect(await admitTurn(a)).toBeNull();
    expect(resOf(a).status).toHaveBeenCalledWith(409);
    expect(storage.createFinderUserMessage).not.toHaveBeenCalled();
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });
});

describe("admitTurn — finder action", () => {
  it("ends quietly on a stale action, before writing any row", async () => {
    vi.mocked(isActionCurrent).mockReturnValue(false);
    const a = args({ finderAction: action });

    expect(await admitTurn(a)).toBeNull();
    expect(openSse).toHaveBeenCalledWith(a.res);
    expect(resOf(a).write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(resOf(a).end).toHaveBeenCalled();
    expect(storage.createFinderUserMessage).not.toHaveBeenCalled();
  });

  it("ends quietly on a duplicate tap", async () => {
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "duplicate",
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);
    const a = args({ finderAction: action });

    expect(await admitTurn(a)).toBeNull();
    expect(resOf(a).end).toHaveBeenCalled();
    expect(resOf(a).status).not.toHaveBeenCalled();
  });

  it("429s when the Coach Pro daily limit is reached", async () => {
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "limit_reached",
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);
    const a = args({ finderAction: action });

    expect(await admitTurn(a)).toBeNull();
    expect(resOf(a).status).toHaveBeenCalledWith(429);
    expect(resOf(a).json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DAILY_LIMIT_REACHED" }),
    );
  });

  it("counts a Coach tap against the daily limit when the offer flag is off", async () => {
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "created",
      message: userMessage,
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);
    const a = args({ finderAction: action });

    const out = await admitTurn(a);
    expect(out?.userMessage).toBe(userMessage);
    // Coach chat: no recipe-finder input — the coach stream handles the tap.
    expect(out?.recipeFinderInput).toBeNull();
    expect(storage.createFinderUserMessage).toHaveBeenCalledWith(
      7,
      "u1",
      "hi",
      {
        action: { flowId: "flow-1", type: "generate" },
        coachDailyLimit: 50,
      },
    );
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("does not count a Coach tap when the offer flag is on", async () => {
    vi.mocked(isRecipeOfferEnabled).mockReturnValue(true);
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "created",
      message: userMessage,
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);

    await admitTurn(args({ finderAction: action }));
    expect(storage.createFinderUserMessage).toHaveBeenCalledWith(
      7,
      "u1",
      "hi",
      {
        action: { flowId: "flow-1", type: "generate" },
      },
    );
  });

  it("hands a RecipeChef action to the finder as recipe-finder input", async () => {
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "created",
      message: userMessage,
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);

    const out = await admitTurn(
      args({ conversationType: "recipe", finderAction: action }),
    );
    expect(out?.recipeFinderInput).toEqual({ kind: "action", action });
  });
});

describe("admitTurn — RecipeChef typed turn", () => {
  it("starts the finder on a classified new request, without the generation count", async () => {
    vi.mocked(decideRecipeChefEntry).mockReturnValue({
      kind: "classify",
      recipeTitle: "Tacos",
    } as ReturnType<typeof decideRecipeChefEntry>);
    vi.mocked(classifyTurn).mockResolvedValue("new_request");
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "created",
      message: userMessage,
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);

    const out = await admitTurn(args({ conversationType: "recipe" }));
    expect(out?.recipeFinderInput).toEqual({ kind: "start", text: "hi" });
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("ends quietly when the finder row is not created", async () => {
    vi.mocked(decideRecipeChefEntry).mockReturnValue({
      kind: "finder",
      input: { kind: "start", text: "hi" },
    } as ReturnType<typeof decideRecipeChefEntry>);
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "duplicate",
    } as Awaited<ReturnType<typeof storage.createFinderUserMessage>>);
    const a = args({ conversationType: "recipe" });

    expect(await admitTurn(a)).toBeNull();
    expect(resOf(a).end).toHaveBeenCalled();
  });

  it("falls through to the counted path for an ordinary follow-up", async () => {
    vi.mocked(decideRecipeChefEntry).mockReturnValue({
      kind: "classify",
      recipeTitle: "Tacos",
    } as ReturnType<typeof decideRecipeChefEntry>);
    vi.mocked(classifyTurn).mockResolvedValue("refine_current");

    const out = await admitTurn(args({ conversationType: "recipe" }));
    expect(out?.userMessage).toBe(userMessage);
    expect(out?.recipeFinderInput).toBeNull();
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      7,
      "u1",
      "hi",
      3,
      "recipe",
    );
  });
});

describe("admitTurn — counted path", () => {
  it("429s with the conversation's limit message when the daily limit is hit", async () => {
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
      undefined as unknown as ChatMessage,
    );
    const a = args();

    expect(await admitTurn(a)).toBeNull();
    expect(resOf(a).status).toHaveBeenCalledWith(429);
    expect(resOf(a).json).toHaveBeenCalledWith({
      error: "Coach limit reached",
      code: "DAILY_LIMIT_REACHED",
    });
  });

  it("excludes finder taps from the Coach count when the offer flag is on", async () => {
    vi.mocked(isRecipeOfferEnabled).mockReturnValue(true);

    await admitTurn(args());
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      7,
      "u1",
      "hi",
      10,
      "coach",
      { excludeFinderTaps: true },
    );
  });

  it("does not read finder history for a plain Coach message", async () => {
    await admitTurn(args());
    expect(storage.getChatMessages).not.toHaveBeenCalled();
  });
});
