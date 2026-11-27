/**
 * Coach write cards through handleCoachChat (spec 2026-11-09). The generator
 * is stubbed to call the proposal callback the way a write tool does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoachChatEvent, CoachChatParams } from "../coach-pro-chat";
import { handleCoachChat } from "../coach-pro-chat";
import { storage } from "../../storage";
import { generateCoachProResponse } from "../nutrition-coach";
import type { CoachProChunk } from "../nutrition-coach";
import type { CoachContext } from "../coach-prompt";
import { getBlocksSystemPrompt, parseBlocksFromContent } from "../coach-blocks";
import {
  buildGoalsPayload,
  buildWriteCardPayload,
  performWriteCardSave,
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
    areCoachNotesPaused: vi.fn().mockResolvedValue(false),
    archiveOldEntries: vi.fn(),
    getChatMessageByTurnKey: vi.fn(),
    getWriteCard: vi.fn(),
    getLiveWriteCard: vi.fn(),
    setWriteCardEdits: vi.fn(),
    createWriteCard: vi.fn(),
    createLoggedWriteCard: vi.fn(),
    withdrawLoggedWriteCard: vi.fn(),
    getLatestLoggedFoodCard: vi.fn(),
    withdrawWriteCard: vi.fn(),
  },
}));

vi.mock("../nutrition-coach", () => ({
  generateCoachProResponse: vi.fn(),
  generateCoachResponse: vi.fn(),
  SAFETY_OVERRIDE_SENTINEL: "\x00SAFETY_OVERRIDE\x00",
}));

vi.mock("../coach-prompt", () => ({
  getSystemPromptTemplateVersion: vi.fn().mockReturnValue("v"),
}));

vi.mock("../coach-blocks", () => ({
  parseBlocksFromContent: vi.fn(),
  BLOCKS_SYSTEM_PROMPT: "[BLOCKS]",
  getBlocksSystemPrompt: vi.fn(
    (_f: boolean, o?: { writeCards?: boolean; quickLog?: boolean }) =>
      o?.writeCards
        ? o.quickLog
          ? "[BLOCKS+WRITE+QUICK]"
          : "[BLOCKS+WRITE]"
        : "[BLOCKS]",
  ),
  // The real rule: a user without the health consent gets no commitment card.
  dropCommitmentCards: (blocks: { type: string }[]) =>
    blocks.filter((b) => b.type !== "commitment_card"),
}));

vi.mock("../write-cards", async (orig) => ({
  ...(await orig<typeof import("../write-cards")>()),
  buildWriteCardPayload: vi.fn(),
  planGroceryCard: vi.fn(),
  planPantryCard: vi.fn(),
  buildGoalsPayload: vi.fn(),
  performWriteCardSave: vi.fn(),
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
  // With the health-data consent on record, so Coach's notes are in use.
  vi.mocked(storage.getUserProfile).mockResolvedValue(
    createMockUserProfile({ healthDataConsentAt: new Date("2026-11-21") }),
  );
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
    // The food card was worked out during its tool call, then replaced.
    expect(buildWriteCardPayload).toHaveBeenCalledTimes(1);
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

  describe("plan and grocery list in one card (A1)", () => {
    const planArgs = {
      rows: [
        {
          plannedDate: "2026-11-09",
          mealType: "dinner" as const,
          recipe: { source: "community" as const, id: 1 },
          alternatives: [],
        },
      ],
    };
    const planPayload = {
      rows: [
        {
          plannedDate: "2026-11-09",
          mealType: "dinner",
          recipe: { source: "community", id: 1, title: "Lentil stew" },
          alternatives: [],
        },
      ],
    } as unknown as Awaited<ReturnType<typeof buildWriteCardPayload>>;
    const shownPlan = {
      kind: "plan",
      shown: true,
      meals: ["2026-11-09 dinner: Lentil stew"],
      dropped: 0,
    };
    beforeEach(() => {
      vi.mocked(buildWriteCardPayload).mockResolvedValue(planPayload);
    });

    /** Fires a plan proposal, then a grocery one; records both outcomes. */
    const planThenGrocery = (outcomes: unknown[], withGroceryList?: boolean) =>
      async function* (
        ...args: Parameters<typeof generateCoachProResponse>
      ): AsyncGenerator<CoachProChunk> {
        const propose = args[7]?.onWriteCardProposal;
        outcomes.push(
          await propose?.({
            kind: "plan",
            args: { ...planArgs, withGroceryList },
            pool: [],
          }),
        );
        outcomes.push(await propose?.({ kind: "grocery", args: groceryArgs }));
        const chunk: CoachProChunk = { type: "content", content: "Here." };
        yield chunk;
      };

    it("the plan card takes the shopping, and a grocery call in the same turn is turned away", async () => {
      const outcomes: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        planThenGrocery(outcomes, true),
      );
      await collect(
        handleCoachChat(makeParams({ writeCards: true, planShopCard: true })),
      );
      expect(outcomes).toEqual([
        { ...shownPlan, groceryList: "on_card" },
        { kind: "grocery_on_plan_card" },
      ]);
      expect(planGroceryCard).not.toHaveBeenCalled();
      expect(buildWriteCardPayload).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "plan", shopping: true }),
        expect.anything(),
      );
      expect(storage.createWriteCard).toHaveBeenCalledTimes(1);
    });

    it("an app that cannot draw the section is told the list is not on the card", async () => {
      const outcomes: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        planThenGrocery(outcomes, true),
      );
      await collect(handleCoachChat(makeParams({ writeCards: true })));
      expect(outcomes[0]).toEqual({ ...shownPlan, groceryList: "not_on_card" });
      // As before: the later grocery card replaces the plan card, which was
      // worked out during its own tool call.
      expect(outcomes[1]).toMatchObject({ kind: "grocery", shown: true });
      expect(buildWriteCardPayload).toHaveBeenCalledTimes(1);
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "grocery" }),
      );
    });

    it("a plan the user did not ask a list for is unchanged", async () => {
      const outcomes: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        planThenGrocery(outcomes),
      );
      await collect(
        handleCoachChat(makeParams({ writeCards: true, planShopCard: true })),
      );
      // No grocery-list note: the user did not ask for one.
      expect(outcomes[0]).toEqual(shownPlan);
      expect(outcomes[1]).toMatchObject({ kind: "grocery", shown: true });
    });
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

  const goalsPayload = {
    rows: [{ key: "calories" as const, current: 1800, proposed: 2000 }],
  };
  const proposingGoals = (seen: { outcome?: unknown }) =>
    async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      seen.outcome = await args[7]?.onWriteCardProposal?.({
        kind: "goals",
        args: { calories: 2000 },
      });
      const chunk: CoachProChunk = { type: "content", content: "Here." };
      yield chunk;
    };

  it("the goals tool is switched on only for an app that declared the goals card", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(proposing());
    await collect(handleCoachChat(makeParams({ writeCards: true })));
    expect(
      vi.mocked(generateCoachProResponse).mock.calls[0][7],
    ).not.toHaveProperty("goalsCard");
    vi.mocked(generateCoachProResponse).mockClear();
    await collect(
      handleCoachChat(makeParams({ writeCards: true, goalsCard: true })),
    );
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toMatchObject({
      goalsCard: true,
    });
  });

  it("a goals card is worked out during the tool call and saved as the turn's card", async () => {
    vi.mocked(buildGoalsPayload).mockResolvedValue(goalsPayload);
    const seen: { outcome?: unknown } = {};
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposingGoals(seen),
    );
    await collect(
      handleCoachChat(makeParams({ writeCards: true, goalsCard: true })),
    );
    expect(buildGoalsPayload).toHaveBeenCalledWith(
      { calories: 2000 },
      "user-42",
    );
    expect(seen.outcome).toEqual({
      kind: "goals",
      shown: true,
      rows: "calories 2000 (now 1800)",
    });
    expect(storage.createWriteCard).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "goals", payload: goalsPayload }),
    );
    expect(buildWriteCardPayload).not.toHaveBeenCalled();
  });

  describe("the allergy card", () => {
    const allergyAction = {
      type: "action_card" as const,
      title: "Add shellfish to your allergies",
      subtitle: "So I can avoid it",
      action: { type: "add_allergy" as const, allergen: "shellfish" as const },
      actionLabel: "Add",
    };
    const quick = {
      type: "quick_replies" as const,
      options: [{ label: "Ok", message: "Ok" }],
    };
    const allergyCard = {
      card: createMockCoachWriteCard({
        id: CARD_ID,
        kind: "allergy",
        payload: { allergen: "shellfish" },
      }),
      previous: null,
    };
    const types = (events: CoachChatEvent[]) =>
      blocksEvent(events)?.blocks.map((b) => b.type);

    beforeEach(() => {
      vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
        text: t,
        blocks: [allergyAction, quick],
      }));
      vi.mocked(buildWriteCardPayload).mockResolvedValue({
        allergen: "shellfish",
      });
      vi.mocked(storage.createWriteCard).mockResolvedValue(allergyCard);
      vi.mocked(generateCoachProResponse).mockImplementation(
        async function* (): AsyncGenerator<CoachProChunk> {
          const chunk: CoachProChunk = { type: "content", content: "Noted." };
          yield chunk;
        },
      );
    });

    it("replaces the add_allergy action card for an app that can draw it", async () => {
      const events = await collect(
        handleCoachChat(makeParams({ writeCards: true, allergyCard: true })),
      );
      expect(buildWriteCardPayload).toHaveBeenCalledWith(
        { kind: "allergy", args: { allergen: "shellfish" } },
        expect.objectContaining({ userId: "user-42" }),
      );
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "allergy",
          payload: { allergen: "shellfish" },
        }),
      );
      expect(types(events)).toEqual(["quick_replies", "write_card"]);
    });

    it("leaves the action card for an app that did not declare the allergy card", async () => {
      const events = await collect(
        handleCoachChat(makeParams({ writeCards: true })),
      );
      expect(storage.createWriteCard).not.toHaveBeenCalled();
      expect(types(events)).toEqual(["action_card", "quick_replies"]);
    });

    it("leaves the action card when no card can be built (no consent, or already on file)", async () => {
      vi.mocked(buildWriteCardPayload).mockRejectedValue(
        new WriteCardEditError("No health-data consent on record."),
      );
      const events = await collect(
        handleCoachChat(makeParams({ writeCards: true, allergyCard: true })),
      );
      expect(storage.createWriteCard).not.toHaveBeenCalled();
      expect(types(events)).toEqual(["action_card", "quick_replies"]);
    });

    it("leaves the action card when the turn already made another card", async () => {
      vi.mocked(storage.createWriteCard).mockResolvedValue({
        card: createMockCoachWriteCard({ id: CARD_ID, kind: "food" }),
        previous: null,
      });
      vi.mocked(buildWriteCardPayload).mockResolvedValue(foodPayload);
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposing({ kind: "food", args: foodArgs }),
      );
      const events = await collect(
        handleCoachChat(makeParams({ writeCards: true, allergyCard: true })),
      );
      expect(storage.createWriteCard).toHaveBeenCalledTimes(1);
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "food" }),
      );
      expect(types(events)).toEqual([
        "action_card",
        "quick_replies",
        "write_card",
      ]);
    });
  });

  it("a reply replaced by the safety message carries no card", async () => {
    vi.mocked(buildGoalsPayload).mockResolvedValue(goalsPayload);
    vi.mocked(generateCoachProResponse).mockImplementation(async function* (
      ...args: Parameters<typeof generateCoachProResponse>
    ): AsyncGenerator<CoachProChunk> {
      await args[7]?.onWriteCardProposal?.({
        kind: "goals",
        args: { calories: 2000 },
      });
      const text: CoachProChunk = { type: "content", content: "Eat less." };
      yield text;
      const override: CoachProChunk = { type: "safety_override" };
      yield override;
    });
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, goalsCard: true })),
    );
    expect(events.some((e) => e.type === "safety_override")).toBe(true);
    expect(storage.createWriteCard).not.toHaveBeenCalled();
  });

  it("the goals tool is not offered on a safety turn", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(proposing());
    await collect(
      handleCoachChat(
        makeParams({
          writeCards: true,
          goalsCard: true,
          content: "I have diabetes, what should I eat?",
        }),
      ),
    );
    const opts = vi.mocked(generateCoachProResponse).mock.calls[0][7];
    expect(opts).toMatchObject({ writeCards: true });
    expect(opts).not.toHaveProperty("goalsCard");
  });

  it("goals the user already has show no card", async () => {
    vi.mocked(buildGoalsPayload).mockRejectedValue(
      new WriteCardEditError("These are already the user's goals."),
    );
    const seen: { outcome?: unknown } = {};
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposingGoals(seen),
    );
    await collect(
      handleCoachChat(makeParams({ writeCards: true, goalsCard: true })),
    );
    expect(seen.outcome).toEqual({ kind: "goals", shown: false, rows: "" });
    expect(storage.createWriteCard).not.toHaveBeenCalled();
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

  // Audit 2026-11-24 (M11): the plan and food cards are worked out during
  // the tool call, like the grocery, pantry and goals cards, so the tool
  // result says what the card really shows, or that there is none.
  describe("plan and food cards are worked out during the tool call", () => {
    const twoDinners = {
      rows: [
        {
          plannedDate: "2026-11-25",
          mealType: "dinner" as const,
          recipe: { source: "community" as const, id: 1 },
          alternatives: [],
        },
        {
          plannedDate: "2026-11-26",
          mealType: "dinner" as const,
          recipe: { source: "community" as const, id: 999 },
          alternatives: [],
        },
      ],
    };
    const onePlannedRow = {
      rows: [
        {
          plannedDate: "2026-11-25",
          mealType: "dinner",
          recipe: { source: "community", id: 1, title: "Lentil stew" },
          alternatives: [],
        },
      ],
    } as unknown as Awaited<ReturnType<typeof buildWriteCardPayload>>;

    /** Fires one proposal and records what the tool call is told. */
    const proposeOnce = (p: WriteCardProposal, seen: unknown[]) =>
      async function* (
        ...args: Parameters<typeof generateCoachProResponse>
      ): AsyncGenerator<CoachProChunk> {
        seen.push(await args[7]?.onWriteCardProposal?.(p));
        const chunk: CoachProChunk = { type: "content", content: "Here." };
        yield chunk;
      };

    it("the plan tool hears which meals the card shows and how many were left off", async () => {
      vi.mocked(buildWriteCardPayload).mockResolvedValue(onePlannedRow);
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeOnce({ kind: "plan", args: twoDinners, pool: [] }, seen),
      );
      await collect(handleCoachChat(makeParams({ writeCards: true })));

      expect(seen).toEqual([
        {
          kind: "plan",
          shown: true,
          meals: ["2026-11-25 dinner: Lentil stew"],
          dropped: 1,
        },
      ]);
      // Built once, during the tool call, and that payload is the card.
      expect(buildWriteCardPayload).toHaveBeenCalledTimes(1);
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "plan", payload: onePlannedRow }),
      );
    });

    it("a plan with no recipe that can be used shows no card, and the tool is told", async () => {
      vi.mocked(buildWriteCardPayload).mockRejectedValue(
        new WriteCardEditError("None of those recipes could be found."),
      );
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeOnce({ kind: "plan", args: twoDinners, pool: [] }, seen),
      );
      const events = await collect(
        handleCoachChat(makeParams({ writeCards: true })),
      );

      expect(seen).toEqual([{ kind: "plan", shown: false, dropped: 2 }]);
      expect(storage.createWriteCard).not.toHaveBeenCalled();
      expect(blocksEvent(events)).toBeUndefined();
    });

    it("the food tool is told when no card could be made", async () => {
      vi.mocked(buildWriteCardPayload).mockRejectedValue(
        new WriteCardEditError("Nothing to log."),
      );
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeOnce({ kind: "food", args: foodArgs }, seen),
      );
      await collect(handleCoachChat(makeParams({ writeCards: true })));

      expect(seen).toEqual([{ kind: "food", shown: false }]);
      expect(storage.createWriteCard).not.toHaveBeenCalled();
    });

    it("the food card is built once, during the tool call", async () => {
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeOnce({ kind: "food", args: foodArgs }, seen),
      );
      await collect(handleCoachChat(makeParams({ writeCards: true })));

      expect(seen).toEqual([{ kind: "food", shown: true }]);
      expect(buildWriteCardPayload).toHaveBeenCalledTimes(1);
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "food", payload: foodPayload }),
      );
    });

    it("a read that fails during the tool call falls back to building the card at the end", async () => {
      vi.mocked(buildWriteCardPayload)
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce(foodPayload);
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeOnce({ kind: "food", args: foodArgs }, seen),
      );
      await collect(handleCoachChat(makeParams({ writeCards: true })));

      expect(seen).toEqual([undefined]);
      expect(buildWriteCardPayload).toHaveBeenCalledTimes(2);
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "food", payload: foodPayload }),
      );
    });
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
    expect(getBlocksSystemPrompt).toHaveBeenCalledWith(
      expect.any(Boolean),
      expect.objectContaining({ writeCards: true }),
    );
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
    // Fails during the tool call and again at the end of the turn.
    vi.mocked(buildWriteCardPayload).mockRejectedValue(
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

  // L87: a food card whose lookup failed mid-stream is built again at the
  // end, and its nutrition lookups can take seconds. A client that leaves
  // meanwhile must not get a row that locks the card it was looking at.
  it("a client that left while the card was being built gets no card row", async () => {
    let aborted = false;
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    vi.mocked(buildWriteCardPayload)
      .mockRejectedValueOnce(new Error("lookup read failed"))
      .mockImplementationOnce(async () => {
        aborted = true;
        return foodPayload;
      });
    const events = await collect(
      handleCoachChat(
        makeParams({ writeCards: true, isAborted: () => aborted }),
      ),
    );
    expect(storage.createWriteCard).not.toHaveBeenCalled();
    expect(blocksEvent(events)).toBeUndefined();
  });

  it("a client that left while the card row was written gets it withdrawn", async () => {
    let aborted = false;
    vi.mocked(generateCoachProResponse).mockImplementation(
      proposing({ kind: "food", args: foodArgs }),
    );
    const previous = { id: "prev-card", status: "replaced" as const };
    vi.mocked(storage.createWriteCard).mockImplementation(async () => {
      aborted = true;
      return {
        card: createMockCoachWriteCard({
          id: CARD_ID,
          kind: "food",
          payload: foodPayload,
        }),
        previous,
      };
    });
    await collect(
      handleCoachChat(
        makeParams({ writeCards: true, isAborted: () => aborted }),
      ),
    );
    expect(storage.withdrawWriteCard).toHaveBeenCalledWith({
      cardId: CARD_ID,
      userId: "user-42",
      previous,
    });
  });

  // Coach roadmap T2: a small food log the user typed is applied at once,
  // with Undo, for an app that can show that ("quick_log"). It is saved
  // during the tool call, so the tool result only says what has happened.
  describe("a small food log applied at once", () => {
    const LOGGED_ID = "22222222-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const loggedCard = () =>
      createMockCoachWriteCard({
        id: LOGGED_ID,
        kind: "food",
        payload: foodPayload,
        status: "saved",
        savedAt: new Date(),
        savedRefs: { scannedItemIds: [9], loggedAtOnce: true },
      });
    const loggedBlock = {
      type: "write_card",
      cardId: LOGGED_ID,
      kind: "food",
      payload: foodPayload,
      status: "saved",
      receipt: "✓ Logged to Breakfast · 144 cal",
      loggedAtOnce: true,
    };

    beforeEach(() => {
      vi.mocked(storage.createLoggedWriteCard).mockResolvedValue({
        card: loggedCard(),
        previous: null,
      });
      vi.mocked(storage.withdrawLoggedWriteCard).mockResolvedValue(true);
      vi.mocked(storage.getLatestLoggedFoodCard).mockResolvedValue(undefined);
      vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
    });

    /** Fires these proposals in order, recording each tool result. */
    const proposeAll = (
      ps: WriteCardProposal[],
      seen: unknown[],
      after?: CoachProChunk,
    ) =>
      async function* (
        ...args: Parameters<typeof generateCoachProResponse>
      ): AsyncGenerator<CoachProChunk> {
        for (const p of ps) seen.push(await args[7]?.onWriteCardProposal?.(p));
        const chunk: CoachProChunk = { type: "content", content: "Logged." };
        yield chunk;
        if (after) yield after;
      };
    const quick = (o: Partial<CoachChatParams> = {}) =>
      makeParams({ writeCards: true, quickLog: true, turnKey: "tk-1", ...o });

    it("saves during the tool call; the tool hears it is logged and the card arrives saved", async () => {
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], seen),
      );
      const events = await collect(handleCoachChat(quick()));

      expect(seen).toEqual([{ kind: "food", shown: true, loggedAtOnce: true }]);
      expect(storage.createLoggedWriteCard).toHaveBeenCalledWith(
        {
          userId: "user-42",
          conversationId: 1,
          kind: "food",
          payload: foodPayload,
        },
        expect.any(Function),
      );
      // Not also made as a card waiting on Save.
      expect(storage.createWriteCard).not.toHaveBeenCalled();
      expect(blocksEvent(events)?.blocks).toEqual([loggedBlock]);
      expect(vi.mocked(storage.createChatMessage).mock.calls[0][4]).toEqual({
        blocks: [loggedBlock],
      });
      expect(storage.withdrawLoggedWriteCard).not.toHaveBeenCalled();
      const context = vi.mocked(generateCoachProResponse).mock
        .calls[0][1] as CoachContext;
      expect(context.blocksPrompt).toBe("[BLOCKS+WRITE+QUICK]");
    });

    it("saves the card's own contents, as a Save tap with no edits would", async () => {
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], []),
      );
      vi.mocked(performWriteCardSave).mockResolvedValue({
        scannedItemIds: [9],
      });
      await collect(handleCoachChat(quick()));
      const perform = vi.mocked(storage.createLoggedWriteCard).mock.calls[0][1];
      const tx = {} as Parameters<typeof perform>[0];
      const card = createMockCoachWriteCard({ id: LOGGED_ID, kind: "food" });
      await expect(perform(tx, card)).resolves.toEqual({ scannedItemIds: [9] });
      expect(performWriteCardSave).toHaveBeenCalledWith(
        tx,
        card,
        {},
        expect.objectContaining({ userId: "user-42", tz: "UTC" }),
      );
    });

    it("stays logged when a later tool call in the turn makes another card", async () => {
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll(
          [
            { kind: "food", args: foodArgs },
            { kind: "grocery", args: groceryArgs },
          ],
          seen,
        ),
      );
      vi.mocked(storage.createWriteCard).mockResolvedValue({
        card: createMockCoachWriteCard({
          id: CARD_ID,
          kind: "grocery",
          payload: groceryPayload,
        }),
        previous: null,
      });
      const events = await collect(handleCoachChat(quick()));
      expect(seen[0]).toEqual({
        kind: "food",
        shown: true,
        loggedAtOnce: true,
      });
      const blocks = blocksEvent(events)?.blocks ?? [];
      expect(blocks.map((b) => (b as { cardId?: string }).cardId)).toEqual([
        LOGGED_ID,
        CARD_ID,
      ]);
      expect(storage.withdrawLoggedWriteCard).not.toHaveBeenCalled();
    });

    it("logs at most one food at once a turn: a second one waits on Save", async () => {
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll(
          [
            { kind: "food", args: foodArgs },
            { kind: "food", args: foodArgs },
          ],
          seen,
        ),
      );
      const events = await collect(handleCoachChat(quick()));
      expect(seen).toEqual([
        { kind: "food", shown: true, loggedAtOnce: true },
        { kind: "food", shown: true },
      ]);
      expect(storage.createLoggedWriteCard).toHaveBeenCalledTimes(1);
      expect(blocksEvent(events)?.blocks).toEqual([
        loggedBlock,
        expect.objectContaining({ cardId: CARD_ID, status: "live" }),
      ]);
    });

    it("a large log keeps the card for the user to save", async () => {
      const big = {
        ...foodPayload,
        items: [{ ...foodPayload.items[0], count: 20 }],
      };
      vi.mocked(buildWriteCardPayload).mockResolvedValue(big);
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], seen),
      );
      const events = await collect(handleCoachChat(quick()));
      expect(seen).toEqual([{ kind: "food", shown: true }]);
      expect(storage.createLoggedWriteCard).not.toHaveBeenCalled();
      expect(blocksEvent(events)?.blocks[0]).toMatchObject({ status: "live" });
    });

    it("an app that did not declare it keeps the card for the user to save", async () => {
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], seen),
      );
      await collect(
        handleCoachChat(makeParams({ writeCards: true, turnKey: "tk-1" })),
      );
      expect(seen).toEqual([{ kind: "food", shown: true }]);
      expect(storage.createLoggedWriteCard).not.toHaveBeenCalled();
      const context = vi.mocked(generateCoachProResponse).mock
        .calls[0][1] as CoachContext;
      expect(context.blocksPrompt).toBe("[BLOCKS+WRITE]");
    });

    it("nothing is logged at once on a turn the safety rules refuse", async () => {
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], seen),
      );
      await collect(
        handleCoachChat(
          quick({ content: "I have diabetes, what should I eat?" }),
        ),
      );
      expect(seen).toEqual([{ kind: "food", shown: true }]);
      expect(storage.createLoggedWriteCard).not.toHaveBeenCalled();
    });

    it("a turn already answered (a replayed turn key) logs nothing again", async () => {
      vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(
        createMockChatMessage(),
      );
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], seen),
      );
      await collect(handleCoachChat(quick()));
      expect(seen).toEqual([{ kind: "food", shown: true }]);
      expect(storage.createLoggedWriteCard).not.toHaveBeenCalled();
    });

    it("a save that fails gives a card waiting on Save, and the tool is told so", async () => {
      vi.mocked(storage.createLoggedWriteCard).mockRejectedValue(
        new Error("db down"),
      );
      const seen: unknown[] = [];
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], seen),
      );
      const events = await collect(handleCoachChat(quick()));
      expect(seen).toEqual([{ kind: "food", shown: true }]);
      expect(storage.createWriteCard).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "food", payload: foodPayload }),
      );
      const block = blocksEvent(events)?.blocks[0];
      expect(block).toMatchObject({ status: "live" });
      expect(block).not.toHaveProperty("loggedAtOnce");
      expect(svcLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "food" }),
        expect.stringMatching(/logged at once/),
      );
    });

    it("a save the card refuses on purpose is a warning", async () => {
      vi.mocked(storage.createLoggedWriteCard).mockRejectedValue(
        new WriteCardEditError("Nothing to log."),
      );
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], []),
      );
      await collect(handleCoachChat(quick()));
      expect(svcLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "food" }),
        expect.stringMatching(/logged at once/),
      );
      expect(svcLog.error).not.toHaveBeenCalled();
    });

    it("a log the user never got to see is withdrawn: the safety message replaced the reply", async () => {
      vi.mocked(generateCoachProResponse).mockImplementation(
        proposeAll([{ kind: "food", args: foodArgs }], [], {
          type: "safety_override",
        }),
      );
      const events = await collect(handleCoachChat(quick()));
      expect(storage.withdrawLoggedWriteCard).toHaveBeenCalledWith(
        LOGGED_ID,
        "user-42",
        expect.any(Function),
      );
      expect(blocksEvent(events)).toBeUndefined();
    });

    it("a log the user never got to see is withdrawn: the client left", async () => {
      let aborted = false;
      vi.mocked(generateCoachProResponse).mockImplementation(async function* (
        ...args: Parameters<typeof generateCoachProResponse>
      ): AsyncGenerator<CoachProChunk> {
        await args[7]?.onWriteCardProposal?.({ kind: "food", args: foodArgs });
        const chunk: CoachProChunk = { type: "content", content: "Logged." };
        yield chunk;
        aborted = true;
      });
      await collect(handleCoachChat(quick({ isAborted: () => aborted })));
      expect(storage.withdrawLoggedWriteCard).toHaveBeenCalledWith(
        LOGGED_ID,
        "user-42",
        expect.any(Function),
      );
    });

    it("tells the Coach what it already logged, so a change is not logged twice", async () => {
      vi.mocked(storage.getLatestLoggedFoodCard).mockResolvedValue(
        loggedCard(),
      );
      vi.mocked(generateCoachProResponse).mockImplementation(proposing());
      await collect(handleCoachChat(quick()));
      const context = vi.mocked(generateCoachProResponse).mock
        .calls[0][1] as CoachContext;
      expect(context.liveWriteCard).toMatch(/Already logged in this chat/);
      expect(context.liveWriteCard).toMatch(/2 × large egg/);
      expect(context.liveWriteCard).toMatch(/Undo/);
    });
  });
});

// Coach roadmap T3: the reply names a day; the server builds the card.
describe("the day progress card", () => {
  const quick = {
    type: "quick_replies" as const,
    options: [{ label: "Ok", message: "Ok" }],
  };
  const types = (events: CoachChatEvent[]) =>
    blocksEvent(events)?.blocks.map((b) => b.type);
  const saying = (...chunks: CoachProChunk[]) =>
    async function* (): AsyncGenerator<CoachProChunk> {
      for (const c of chunks) yield c;
    };

  beforeEach(() => {
    vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
      text: t,
      blocks: [quick],
      dayProgress: "today" as const,
    }));
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 1420,
      totalProtein: 82,
      totalCarbs: 150,
      totalFat: 48,
      itemCount: 4,
    });
    vi.mocked(generateCoachProResponse).mockImplementation(
      saying({ type: "content", content: "You're on track." }),
    );
  });

  it("is built from the day's numbers, before the quick replies, for an app that can draw it", async () => {
    const events = await collect(
      handleCoachChat(
        makeParams({ writeCards: true, dayProgressCard: true, tz: "UTC" }),
      ),
    );
    expect(types(events)).toEqual(["day_progress", "quick_replies"]);
    const card = blocksEvent(events)?.blocks[0];
    expect(card).toMatchObject({
      type: "day_progress",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      snapshot: {
        totals: { calories: 1420, protein: 82, carbs: 150, fat: 48 },
        goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
      },
    });
    // The card is saved with the reply, so the chat shows it on reopen.
    const saved = vi.mocked(storage.createChatMessage).mock.calls.at(-1);
    expect(saved?.[4]).toMatchObject({ blocks: [card, quick] });
    expect(getBlocksSystemPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dayProgress: true }),
    );
  });

  it("is not built, or offered, for an app that did not declare it", async () => {
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );
    expect(types(events)).toEqual(["quick_replies"]);
    expect(getBlocksSystemPrompt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dayProgress: true }),
    );
  });

  it("is not built for a reply the safety message replaced", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      saying(
        { type: "content", content: "Eat less." },
        { type: "safety_override" },
      ),
    );
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, dayProgressCard: true })),
    );
    expect(
      blocksEvent(events)?.blocks.some((b) => b.type === "day_progress"),
    ).not.toBe(true);
  });

  it("is left off, and the reply still saves, when the day can't be read", async () => {
    vi.mocked(storage.getDailySummary).mockImplementation(async (...a) => {
      // The turn's own context read works; the card's read fails.
      if (vi.mocked(storage.getDailySummary).mock.calls.length > 1) {
        throw new Error("db down");
      }
      void a;
      return {
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      };
    });
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, dayProgressCard: true })),
    );
    expect(types(events)).toEqual(["quick_replies"]);
    expect(storage.createChatMessage).toHaveBeenCalled();
    expect(svcLog.warn).toHaveBeenCalled();
  });
});

describe("the week progress card", () => {
  const quick = {
    type: "quick_replies" as const,
    options: [{ label: "Ok", message: "Ok" }],
  };
  const types = (events: CoachChatEvent[]) =>
    blocksEvent(events)?.blocks.map((b) => b.type);

  beforeEach(() => {
    vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
      text: t,
      blocks: [quick],
      weekProgress: true as const,
    }));
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 1900,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      itemCount: 3,
    });
    vi.mocked(generateCoachProResponse).mockImplementation(
      async function* (): AsyncGenerator<CoachProChunk> {
        yield { type: "content", content: "A steady week." };
      },
    );
  });

  it("is built from the seven days, before the quick replies, for an app that can draw it", async () => {
    const events = await collect(
      handleCoachChat(
        makeParams({ writeCards: true, weekProgressCard: true, tz: "UTC" }),
      ),
    );
    expect(types(events)).toEqual(["week_progress", "quick_replies"]);
    const card = blocksEvent(events)?.blocks[0];
    expect(card).toMatchObject({
      type: "week_progress",
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      snapshot: { calories: Array(7).fill(1900), calorieGoal: 2000 },
    });
    const saved = vi.mocked(storage.createChatMessage).mock.calls.at(-1);
    expect(saved?.[4]).toMatchObject({ blocks: [card, quick] });
    expect(getBlocksSystemPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ weekProgress: true }),
    );
  });

  it("is not built, or offered, for an app that did not declare it", async () => {
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, dayProgressCard: true })),
    );
    expect(types(events)).toEqual(["quick_replies"]);
    expect(getBlocksSystemPrompt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ weekProgress: true }),
    );
  });

  it("is not built for a reply the safety message replaced", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      async function* (): AsyncGenerator<CoachProChunk> {
        yield { type: "content", content: "Eat less." };
        yield { type: "safety_override" };
      },
    );
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, weekProgressCard: true })),
    );
    expect(
      blocksEvent(events)?.blocks.some((b) => b.type === "week_progress"),
    ).not.toBe(true);
  });

  it("is left off, and the reply still saves, when a day can't be read", async () => {
    // The turn's own context read works; the card's reads fail.
    vi.mocked(storage.getDailySummary).mockImplementation(async () => {
      if (vi.mocked(storage.getDailySummary).mock.calls.length > 1) {
        throw new Error("db down");
      }
      return {
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      };
    });
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, weekProgressCard: true })),
    );
    expect(types(events)).toEqual(["quick_replies"]);
    expect(storage.createChatMessage).toHaveBeenCalled();
    expect(svcLog.warn).toHaveBeenCalled();
  });

  it("sits with a day card the same reply asked for", async () => {
    vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
      text: t,
      blocks: [quick],
      dayProgress: "today" as const,
      weekProgress: true as const,
    }));
    const events = await collect(
      handleCoachChat(
        makeParams({
          writeCards: true,
          dayProgressCard: true,
          weekProgressCard: true,
        }),
      ),
    );
    expect(types(events)).toEqual([
      "day_progress",
      "week_progress",
      "quick_replies",
    ]);
  });
});

describe("the T4 chart kinds", () => {
  const quick = {
    type: "quick_replies" as const,
    options: [{ label: "Ok", message: "Ok" }],
  };
  const ring = {
    type: "inline_chart" as const,
    chartType: "ring" as const,
    title: "This week's averages",
    data: [{ label: "Protein", value: 120, target: 150 }],
  };
  const bar = { ...ring, chartType: "bar" as const };
  const types = (events: CoachChatEvent[]) =>
    blocksEvent(events)?.blocks.map((b) =>
      b.type === "inline_chart" ? b.chartType : b.type,
    );

  beforeEach(() => {
    vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
      text: t,
      blocks: [ring, bar, quick],
    }));
    vi.mocked(generateCoachProResponse).mockImplementation(
      async function* (): AsyncGenerator<CoachProChunk> {
        yield { type: "content", content: "Here is your week." };
      },
    );
  });

  it("are kept, and offered, for an app that draws them", async () => {
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true, moreCharts: true })),
    );
    expect(types(events)).toEqual(["ring", "bar", "quick_replies"]);
    expect(getBlocksSystemPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ moreCharts: true }),
    );
  });

  it("are dropped without write cards, even when the app says it draws them", async () => {
    const events = await collect(
      handleCoachChat(makeParams({ moreCharts: true })),
    );
    expect(types(events)).toEqual(["bar", "quick_replies"]);
  });

  it("are dropped, and not offered, for an app that did not declare them", async () => {
    const events = await collect(
      handleCoachChat(makeParams({ writeCards: true })),
    );
    expect(types(events)).toEqual(["bar", "quick_replies"]);
    const saved = vi.mocked(storage.createChatMessage).mock.calls.at(-1);
    expect(saved?.[4]).toMatchObject({ blocks: [bar, quick] });
    expect(getBlocksSystemPrompt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ moreCharts: true }),
    );
  });
});
