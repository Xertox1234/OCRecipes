import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../../storage";
import { enrichWriteCardBlocks } from "../enrich";
import {
  createMockChatMessage,
  createMockCoachWriteCard,
} from "../../../__tests__/factories";

vi.mock("../../../storage", () => ({
  storage: { getWriteCardsByIds: vi.fn() },
}));

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
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

const messageWithCard = () =>
  createMockChatMessage({
    role: "assistant",
    metadata: {
      blocks: [
        {
          type: "write_card",
          cardId: CARD_ID,
          kind: "food",
          payload: foodPayload,
          status: "saved",
          loggedAtOnce: true,
        },
      ],
    },
  });

const blockOf = (m: Awaited<ReturnType<typeof enrichWriteCardBlocks>>) =>
  (m[0].metadata as { blocks: Record<string, unknown>[] }).blocks[0];

// Coach roadmap T2: a reopened chat offers Undo on a log applied at once
// only while the server would still take it.
describe("enrichWriteCardBlocks and logs applied at once", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the mark while Undo is open", async () => {
    vi.mocked(storage.getWriteCardsByIds).mockResolvedValue([
      createMockCoachWriteCard({
        id: CARD_ID,
        kind: "food",
        payload: foodPayload,
        status: "saved",
        savedAt: new Date(Date.now() - 60_000),
        savedRefs: { scannedItemIds: [9], loggedAtOnce: true },
      }),
    ]);
    const block = blockOf(
      await enrichWriteCardBlocks([messageWithCard()], "user-42"),
    );
    expect(block.loggedAtOnce).toBe(true);
    expect(block.status).toBe("saved");
  });

  it("drops it once Undo has closed", async () => {
    vi.mocked(storage.getWriteCardsByIds).mockResolvedValue([
      createMockCoachWriteCard({
        id: CARD_ID,
        kind: "food",
        payload: foodPayload,
        status: "saved",
        savedAt: new Date(Date.now() - 10 * 60_000),
        savedRefs: { scannedItemIds: [9], loggedAtOnce: true },
      }),
    ]);
    const block = blockOf(
      await enrichWriteCardBlocks([messageWithCard()], "user-42"),
    );
    expect(block).not.toHaveProperty("loggedAtOnce");
    expect(block.status).toBe("saved");
  });

  it("drops it once the log was undone (the card is live again)", async () => {
    vi.mocked(storage.getWriteCardsByIds).mockResolvedValue([
      createMockCoachWriteCard({
        id: CARD_ID,
        kind: "food",
        payload: foodPayload,
        status: "live",
      }),
    ]);
    const block = blockOf(
      await enrichWriteCardBlocks([messageWithCard()], "user-42"),
    );
    expect(block).not.toHaveProperty("loggedAtOnce");
    expect(block.status).toBe("live");
  });
});
