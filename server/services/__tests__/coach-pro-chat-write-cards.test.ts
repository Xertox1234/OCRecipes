/**
 * Coach write cards through handleCoachChat (spec 2026-11-09). The generator
 * is stubbed to call the proposal callback the way a write tool does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoachChatEvent, CoachChatParams } from "../coach-pro-chat";
import { handleCoachChat } from "../coach-pro-chat";
import { storage } from "../../storage";
import { generateCoachProResponse } from "../nutrition-coach";
import type { CoachContext, CoachProChunk } from "../nutrition-coach";
import { getBlocksSystemPrompt, parseBlocksFromContent } from "../coach-blocks";
import {
  buildWriteCardPayload,
  planGroceryCard,
  planPantryCard,
} from "../write-cards";
import { extractNotebookEntries } from "../notebook-extraction";
import type { WriteCardProposal } from "../write-cards";
import { WriteCardEditError } from "../write-cards/errors";
import {
  createMockChatMessage,
  createMockCoachWriteCard,
  createMockUserProfile,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getChatMessages: vi.fn(),
    getDailyLogsInRange: vi.fn(),
    getMostEatenFoods: vi.fn(),
    getActiveNotebookEntries: vi.fn(),
    getCommitmentsWithDueFollowUp: vi.fn(),
    getCoachCachedResponse: vi.fn(),
    setCoachCachedResponse: vi.fn(),
    createChatMessage: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    createNotebookEntries: vi.fn(),
    archiveOldEntries: vi.fn(),
    getChatMessageByTurnKey: vi.fn(),
    getWriteCard: vi.fn(),
    getLiveWriteCard: vi.fn(),
    setWriteCardEdits: vi.fn(),
    createWriteCard: vi.fn(),
  },
}));

vi.mock("../nutrition-coach", () => ({
  generateCoachProResponse: vi.fn(),
  generateCoachResponse: vi.fn(),
  getSystemPromptTemplateVersion: vi.fn().mockReturnValue("v"),
  SAFETY_OVERRIDE_SENTINEL: "\x00SAFETY_OVERRIDE\x00",
}));

vi.mock("../coach-blocks", () => ({
  parseBlocksFromContent: vi.fn(),
  BLOCKS_SYSTEM_PROMPT: "[BLOCKS]",
  getBlocksSystemPrompt: vi.fn((_f: boolean, o?: { writeCards?: boolean }) =>
    o?.writeCards ? "[BLOCKS+WRITE]" : "[BLOCKS]",
  ),
}));

vi.mock("../write-cards", async (orig) => ({
  ...(await orig<typeof import("../write-cards")>()),
  buildWriteCardPayload: vi.fn(),
  planGroceryCard: vi.fn(),
  planPantryCard: vi.fn(),
}));

vi.mock("../notebook-extraction", () => ({
  extractNotebookEntries: vi.fn().mockResolvedValue([]),
}));

const { svcLog } = vi.hoisted(() => ({
  svcLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => svcLog,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const OLD_ID = "11111111-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const foodPayload = {
  items: [
    {
      name: "large egg",
      unitLabel: "egg",
      perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
      count: 2,
      source: "lookup" as const,
    },
  ],
  mealType: "breakfast" as const,
  day: "today" as const,
};
const foodArgs = {
  items: [
    {
      name: "large egg",
      count: 2,
      unitLabel: "egg",
      estimate: { calories: 70, protein: 6, carbs: 0, fat: 5 },
    },
  ],
};
const groceryArgs = { items: [{ name: "Spinach" }] };
const groceryPayload = {
  items: [{ name: "Spinach", quantity: null, unit: null, ticked: true }],
  lists: [],
  defaultListId: null,
  newListName: "Coach list",
};

function makeParams(overrides: Partial<CoachChatParams> = {}): CoachChatParams {
  return {
    conversationId: 1,
    userId: "user-42",
    content: "I had two eggs for breakfast",
    isCoachPro: true,
    user: {
      dailyCalorieGoal: 2000,
      dailyProteinGoal: 150,
      dailyCarbsGoal: 250,
      dailyFatGoal: 65,
      weight: null,
      goalWeight: null,
      measurementUnit: "metric",
    },
    isAborted: () => false,
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<CoachChatEvent>) {
  const events: CoachChatEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

/** A generator stub that fires these proposals, then streams one line. */
function proposing(
  ...proposals: WriteCardProposal[]
): typeof generateCoachProResponse {
  return async function* (
    ...args: Parameters<typeof generateCoachProResponse>
  ): AsyncGenerator<CoachProChunk> {
    for (const p of proposals) await args[7]?.onWriteCardProposal?.(p);
    const chunk: CoachProChunk = {
      type: "content",
      content: "Here's what I've got.",
    };
    yield chunk;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getUserProfile).mockResolvedValue(createMockUserProfile());
  vi.mocked(storage.getDailySummary).mockResolvedValue({
    totalCalories: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    itemCount: 0,
  });
  vi.mocked(storage.getChatMessages).mockResolvedValue([]);
  vi.mocked(storage.getDailyLogsInRange).mockResolvedValue([]);
  vi.mocked(storage.getMostEatenFoods).mockResolvedValue([]);
  vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
  vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([]);
  vi.mocked(storage.getCoachCachedResponse).mockResolvedValue(null);
  vi.mocked(storage.createChatMessage).mockResolvedValue(
    createMockChatMessage(),
  );
  vi.mocked(storage.getLiveWriteCard).mockResolvedValue(undefined);
  vi.mocked(storage.updateChatConversationTitle).mockResolvedValue(undefined);
  vi.mocked(storage.createNotebookEntries).mockResolvedValue([]);
  vi.mocked(storage.archiveOldEntries).mockResolvedValue(0);
  vi.mocked(storage.setCoachCachedResponse).mockResolvedValue(undefined);
  vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
    text: t,
    blocks: [],
  }));
  vi.mocked(buildWriteCardPayload).mockResolvedValue(foodPayload);
  vi.mocked(planGroceryCard).mockResolvedValue({
    payload: groceryPayload,
    leftOff: [],
    unticked: [],
  });
  vi.mocked(storage.createWriteCard).mockResolvedValue({
    card: createMockCoachWriteCard({
      id: CARD_ID,
      kind: "food",
      payload: foodPayload,
    }),
    previous: null,
  });
});

const blocksEvent = (events: CoachChatEvent[]) =>
  events.find((e) => e.type === "blocks") as
    | Extract<CoachChatEvent, { type: "blocks" }>
    | undefined;

describe("handleCoachChat with write cards", () => {
  it("a write tool call in writeCards mode adds one write_card block and a row", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );

    const options = vi.mocked(generateCoachProResponse).mock.calls[0][7];
    expect(options).toMatchObject({ writeCards: true });
    expect(buildWriteCardPayload).toHaveBeenCalledWith(
      { kind: "food", args: foodArgs },
      expect.objectContaining({ userId: "user-42", tz: "UTC" }),
    );
    expect(storage.createWriteCard).toHaveBeenCalledWith({
      userId: "user-42",
      conversationId: 1,
      kind: "food",
      payload: foodPayload,
    });
    const block = {
      type: "write_card",
      cardId: CARD_ID,
      kind: "food",
      payload: foodPayload,
      status: "live",
    };
    expect(blocksEvent(events)?.blocks).toEqual([block]);
    expect(vi.mocked(storage.createChatMessage).mock.calls[0][4]).toEqual({
      blocks: [block],
    });
  });

  // Reliability audit 2026-11-19 M-obs-2: a card that fails to build leaves a
  // reply promising a card that never appears. An unexpected throw (a storage
  // or migration break) must reach Sentry (error level); a card the builder
  // refuses on purpose (WriteCardEditError) stays a warning. The payload is
  // never logged.
  it("an unexpected card build failure is logged at error level, without the payload", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    vi.mocked(storage.createWriteCard).mockRejectedValueOnce(
      new Error('relation "coach_write_cards" does not exist'),
    );
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );

    expect(blocksEvent(events)?.blocks ?? []).toEqual([]);
    expect(svcLog.error).toHaveBeenCalledWith(
      { err: expect.any(Error), kind: "food" },
      "coach write card not built",
    );
    expect(svcLog.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "coach write card not built",
    );
  });

  it("a card the builder refuses on purpose stays a warning", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    vi.mocked(buildWriteCardPayload).mockRejectedValueOnce(
      new WriteCardEditError("Nothing to log."),
    );
    await collect(handleCoachChat(makeParams({ writeCards: true })));

    expect(svcLog.warn).toHaveBeenCalledWith(
      { err: expect.any(WriteCardEditError), kind: "food" },
      "coach write card not built",
    );
    expect(svcLog.error).not.toHaveBeenCalledWith(
      expect.anything(),
      "coach write card not built",
    );
  });

  it("tells notebook extraction the turn was answered with a card", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(vi.mocked(extractNotebookEntries).mock.calls[0][3]).toMatchObject({
      wroteCard: true,
    });
  });

  it("a turn with no card says so to notebook extraction", async () => {
    await collect(handleCoachChat(makeParams()));
    expect(vi.mocked(extractNotebookEntries).mock.calls[0][3]).toMatchObject({
      wroteCard: false,
    });
  });

  it("a second card in the same turn keeps only the last proposal", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing(
        { kind: "food", args: foodArgs },
        { kind: "grocery", args: groceryArgs },
      ),
    );
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(buildWriteCardPayload).not.toHaveBeenCalled();
    expect(storage.createWriteCard).toHaveBeenCalledTimes(1);
    expect(storage.createWriteCard).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "grocery", payload: groceryPayload }),
    );
  });

  it("a grocery card is worked out during the tool call, and the tool hears what the pantry changed", async () => {
    vi.mocked(planGroceryCard).mockResolvedValue({
      payload: groceryPayload,
      leftOff: ["Onions"],
      unticked: ["Ginger"],
    });
    let outcome: unknown;
    vi.mocked(generateCoachProResponse).mockImplementation(async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      outcome = await args[7]?.onWriteCardProposal?.({
        kind: "grocery",
        args: groceryArgs,
      });
      const chunk: CoachProChunk = { type: "content", content: "Here." };
      yield chunk;
    });
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(planGroceryCard).toHaveBeenCalledWith(groceryArgs, "user-42");
    expect(outcome).toEqual({
      kind: "grocery",
      shown: true,
      leftOff: ["Onions"],
      unticked: ["Ginger"],
    });
    expect(storage.createWriteCard).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "grocery", payload: groceryPayload }),
    );
  });

  it("a grocery list the pantry fully covers shows no card and keeps an earlier one", async () => {
    vi.mocked(planGroceryCard).mockResolvedValue({
      payload: null,
      leftOff: ["Spinach"],
      unticked: [],
    });
    let outcome: unknown;
    vi.mocked(generateCoachProResponse).mockImplementation(async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      await args[7]?.onWriteCardProposal?.({ kind: "food", args: foodArgs });
      outcome = await args[7]?.onWriteCardProposal?.({
        kind: "grocery",
        args: groceryArgs,
      });
      const chunk: CoachProChunk = { type: "content", content: "Here." };
      yield chunk;
    });
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(outcome).toEqual({
      kind: "grocery",
      shown: false,
      leftOff: ["Spinach"],
    });
    expect(storage.createWriteCard).toHaveBeenCalledTimes(1);
    expect(storage.createWriteCard).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "food" }),
    );
  });

  const pantryArgs = {
    changes: [{ action: "remove" as const, itemId: 7 }],
  };
  const pantryPayload = {
    rows: [
      {
        action: "remove" as const,
        name: "Spinach",
        quantity: null,
        unit: "bag",
        itemId: 7,
        held: "1.00",
        all: false,
        expiresInDays: null,
      },
    ],
  };

  it("the pantry tool is switched on only for an app that declared the pantry card", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(proposing());
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(
      vi.mocked(generateCoachProResponse).mock.calls[0][7],
    ).not.toHaveProperty("pantryCard");
    vi.mocked(generateCoachProResponse).mockClear();
    await collect(
      handleCoachChat(makeParams({ writeCards: true, pantryCard: true })),
    );
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toMatchObject({
      pantryCard: true,
    });
  });

  it("a pantry card is worked out during the tool call and saved as the turn's card", async () => {
    vi.mocked(planPantryCard).mockResolvedValue({
      payload: pantryPayload,
      dropped: 1,
    });
    let outcome: unknown;
    vi.mocked(generateCoachProResponse).mockImplementation(async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      outcome = await args[7]?.onWriteCardProposal?.({
        kind: "pantry",
        args: pantryArgs,
      });
      const chunk: CoachProChunk = { type: "content", content: "Here." };
      yield chunk;
    });
    await collect(
      handleCoachChat(makeParams({ writeCards: true, pantryCard: true })),
    );
    expect(planPantryCard).toHaveBeenCalledWith(pantryArgs, "user-42");
    expect(outcome).toEqual({
      kind: "pantry",
      shown: true,
      rows: ["Remove Spinach 1 bag"],
      dropped: 1,
    });
    expect(storage.createWriteCard).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pantry", payload: pantryPayload }),
    );
    expect(buildWriteCardPayload).not.toHaveBeenCalled();
  });

  it("a pantry request with nothing left shows no card", async () => {
    vi.mocked(planPantryCard).mockResolvedValue({ payload: null, dropped: 1 });
    let outcome: unknown;
    vi.mocked(generateCoachProResponse).mockImplementation(async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      outcome = await args[7]?.onWriteCardProposal?.({
        kind: "pantry",
        args: pantryArgs,
      });
      const chunk: CoachProChunk = { type: "content", content: "Here." };
      yield chunk;
    });
    await collect(
      handleCoachChat(makeParams({ writeCards: true, pantryCard: true })),
    );
    expect(outcome).toEqual({
      kind: "pantry",
      shown: false,
      rows: [],
      dropped: 1,
    });
    expect(storage.createWriteCard).not.toHaveBeenCalled();
  });

  it("a pantry read that fails during the tool call falls back to building the card at the end", async () => {
    vi.mocked(planGroceryCard).mockRejectedValue(new Error("db down"));
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "grocery", args: groceryArgs }),
    );
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(buildWriteCardPayload).toHaveBeenCalledTimes(1);
  });

  it("names the card it replaced", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    vi.mocked(storage.createWriteCard).mockResolvedValueOnce({
      card: createMockCoachWriteCard({
        id: CARD_ID,
        kind: "food",
        payload: foodPayload,
      }),
      previous: { id: OLD_ID, status: "replaced" },
    });
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );
    expect(blocksEvent(events)?.blocks[0]).toMatchObject({
      replacesCardId: OLD_ID,
    });
  });

  it("an expired (different-kind) previous card is not named as replaced", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    vi.mocked(storage.createWriteCard).mockResolvedValueOnce({
      card: createMockCoachWriteCard({
        id: CARD_ID,
        kind: "food",
        payload: foodPayload,
      }),
      previous: { id: OLD_ID, status: "expired" },
    });
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );
    expect(blocksEvent(events)?.blocks[0]).not.toHaveProperty("replacesCardId");
  });

  it("liveCard edits reach the prompt line", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(proposing());
    const live = createMockCoachWriteCard({
      id: OLD_ID,
      userId: "user-42",
      conversationId: 1,
      kind: "food",
      payload: foodPayload,
    });
    vi.mocked(storage.getWriteCard).mockResolvedValue(live);
    vi.mocked(storage.setWriteCardEdits).mockResolvedValue(true);
    vi.mocked(storage.getLiveWriteCard).mockResolvedValue({
      ...live,
      edits: { counts: [3] },
    });
    await collect(
      handleCoachChat(
        makeParams({
          writeCards: true,
          content: "make it three eggs",
          liveCard: { cardId: OLD_ID, edits: { counts: [3] } },
        }),
      ),
    );
    expect(storage.setWriteCardEdits).toHaveBeenCalledWith(OLD_ID, "user-42", {
      counts: [3],
    });
    const context = vi.mocked(generateCoachProResponse).mock
      .calls[0][1] as CoachContext;
    expect(context.liveWriteCard).toContain("3 × large egg");
    expect(context.blocksPrompt).toBe("[BLOCKS+WRITE]");
    expect(getBlocksSystemPrompt).toHaveBeenCalledWith(expect.any(Boolean), {
      writeCards: true,
    });
  });

  it("ignores liveCard edits that do not parse, and a card from another conversation", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(proposing());
    vi.mocked(storage.getWriteCard).mockResolvedValueOnce(
      createMockCoachWriteCard({
        id: OLD_ID,
        conversationId: 1,
        kind: "food",
        payload: foodPayload,
      }),
    );
    await collect(
      handleCoachChat(
        makeParams({
          writeCards: true,
          liveCard: { cardId: OLD_ID, edits: { calories: 9 } },
        }),
      ),
    );
    vi.mocked(storage.getWriteCard).mockResolvedValueOnce(
      createMockCoachWriteCard({
        id: OLD_ID,
        conversationId: 99,
        kind: "food",
        payload: foodPayload,
      }),
    );
    await collect(
      handleCoachChat(
        makeParams({
          writeCards: true,
          liveCard: { cardId: OLD_ID, edits: { counts: [3] } },
        }),
      ),
    );
    expect(storage.setWriteCardEdits).not.toHaveBeenCalled();
  });

  it("no writeCards flag means no card row and today's blocks", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(proposing());
    const events = await collect(handleCoachChat(makeParams()));
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toEqual({
      offerRecipe: false,
    });
    expect(storage.getLiveWriteCard).not.toHaveBeenCalled();
    expect(storage.createWriteCard).not.toHaveBeenCalled();
    expect(blocksEvent(events)).toBeUndefined();
    const context = vi.mocked(generateCoachProResponse).mock
      .calls[0][1] as CoachContext;
    expect(context.liveWriteCard).toBeUndefined();
    expect(context.blocksPrompt).toBe("[BLOCKS]");
  });

  it("a card that fails to build is skipped; the reply still saves", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    vi.mocked(buildWriteCardPayload).mockRejectedValueOnce(
      new Error("lookup down"),
    );
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );
    expect(storage.createWriteCard).not.toHaveBeenCalled();
    expect(blocksEvent(events)).toBeUndefined();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      "Here's what I've got.",
      null,
    );
  });

  it("a client that left before the card was built gets no card row", async () => {
    let aborted = false;
    vi.mocked(generateCoachProResponse).mockImplementation(async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      await args[7]?.onWriteCardProposal?.({ kind: "food", args: foodArgs });
      const chunk: CoachProChunk = { type: "content", content: "Here." };
      yield chunk;
      aborted = true;
    });
    await collect(
      handleCoachChat(
        makeParams({ writeCards: true, isAborted: () => aborted }),
      ),
    );
    expect(storage.createWriteCard).not.toHaveBeenCalled();
  });
});
