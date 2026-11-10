// The chat turn engine (runTurn) driven with a fake response — no Express.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { storage } from "../../storage";
import { handleCoachChat } from "../coach-pro-chat";
import { runTurn, type TurnInput } from "../chat-turn";

vi.mock("../../storage", () => ({
  storage: {
    getChatMessageByTurnKey: vi.fn(),
    deleteChatMessage: vi.fn(),
    createChatMessage: vi.fn(),
  },
}));

vi.mock("../coach-pro-chat", () => ({
  handleCoachChat: vi.fn(),
  STANDARD_SAFETY_MESSAGE: "safe",
}));
vi.mock("../recipe-chat", () => ({
  generateRecipeChatResponse: vi.fn(),
  buildRecipeContext: vi.fn(),
  buildRemixSystemPrompt: vi.fn(),
}));
vi.mock("../recipe-finder", () => ({
  prepareFinderTurn: vi.fn(),
  executeFinderStep: vi.fn(),
  finderStatusLabel: vi.fn(),
}));

function makeRes() {
  const res = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
    writableFinished: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    flushHeaders: ReturnType<typeof vi.fn>;
  };
  res.writableEnded = false;
  res.writableFinished = false;
  res.write = vi.fn();
  res.end = vi.fn(() => {
    res.writableEnded = true;
    res.writableFinished = true;
  });
  res.setHeader = vi.fn();
  res.flushHeaders = vi.fn();
  return res;
}

function makeInput(res: ReturnType<typeof makeRes>): TurnInput {
  return {
    req: { userId: "u1", headers: {} },
    res: res as unknown as Response,
    conversationId: 7,
    conversation: {},
    conversationType: "coach",
    features: { coachPro: false },
    user: {},
    sanitizedContent: "hi",
    body: { turnKey: "turn-1" },
    userMessage: { id: 501 },
    finderEnabled: false,
    offerEnabled: false,
    finderAction: undefined,
    finderHistory: [],
    recipeFinderInput: null,
  } as unknown as TurnInput;
}

const frames = (res: ReturnType<typeof makeRes>) =>
  res.write.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runTurn (coach path)", () => {
  it("opens the stream, relays events, sends done and ends", async () => {
    vi.mocked(handleCoachChat).mockImplementation(async function* () {
      yield { type: "content", content: "hello" };
    } as unknown as typeof handleCoachChat);
    const res = makeRes();

    await runTurn(makeInput(res));

    expect(res.flushHeaders).toHaveBeenCalled();
    expect(frames(res)).toEqual([
      'data: {"content":"hello"}\n\n',
      'data: {"done":true}\n\n',
    ]);
    expect(res.end).toHaveBeenCalled();
    expect(storage.deleteChatMessage).not.toHaveBeenCalled();
  });

  it("a step event is written as { step }", async () => {
    vi.mocked(handleCoachChat).mockImplementation(async function* () {
      yield { type: "step", label: "Looking up beef burger…" };
    } as unknown as typeof handleCoachChat);
    const res = makeRes();

    await runTurn(makeInput(res));

    expect(frames(res)[0]).toBe('data: {"step":"Looking up beef burger…"}\n\n');
  });

  it("reports a generic error event when the stream throws", async () => {
    vi.mocked(handleCoachChat).mockImplementation(async function* () {
      yield* [];
      throw new Error("boom");
    } as unknown as typeof handleCoachChat);
    const res = makeRes();

    await runTurn(makeInput(res));

    expect(frames(res)).toEqual([
      'data: {"error":"Failed to generate response"}\n\n',
    ]);
    expect(res.end).toHaveBeenCalled();
  });

  it("H6: a disconnect with nothing streamed refunds the user message", async () => {
    const res = makeRes();
    vi.mocked(handleCoachChat).mockImplementation(async function* () {
      yield* [];
      res.emit("close"); // client left before anything streamed
      throw new Error("aborted");
    } as unknown as typeof handleCoachChat);
    vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);

    await runTurn(makeInput(res));

    expect(storage.deleteChatMessage).toHaveBeenCalledWith(501, "u1");
    expect(storage.createChatMessage).not.toHaveBeenCalled();
  });

  it("H6: a disconnect after content keeps the partial as the reply", async () => {
    const res = makeRes();
    vi.mocked(handleCoachChat).mockImplementation(async function* () {
      yield { type: "content", content: "partial answer" };
      res.emit("close");
      throw new Error("aborted");
    } as unknown as typeof handleCoachChat);
    vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);

    await runTurn(makeInput(res));

    expect(storage.deleteChatMessage).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      7,
      "u1",
      "assistant",
      "partial answer",
      null,
      "turn-1",
    );
  });
});
