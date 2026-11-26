import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import {
  scannedBarcodeReply,
  scannedLabelReply,
} from "../../services/coach-photo";
import { createWriteCardBlock } from "../../services/coach-pro-chat/write-card-context";
import { prepareOpeningBrief } from "../chat-admit";
import { register } from "../chat-barcode";
import {
  createMockChatConversation,
  createMockChatMessage,
} from "../../__tests__/factories";
import type { FoodCardPayload } from "@shared/schemas/coach-write-cards";
import { AI_DAILY_CAPS } from "@shared/types/premium";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getEffectiveTierForUser: vi.fn(),
    getChatConversation: vi.fn(),
    claimDailyAiCall: vi.fn(),
    createChatMessageWithLimitCheck: vi.fn(),
    createChatMessage: vi.fn(),
  },
}));

vi.mock("../../services/coach-photo", async (orig) => {
  const actual = await orig<typeof import("../../services/coach-photo")>();
  return {
    ...actual,
    scannedBarcodeReply: vi.fn(),
    scannedLabelReply: vi.fn(),
  };
});

vi.mock("../../services/coach-pro-chat/write-card-context", () => ({
  createWriteCardBlock: vi.fn(),
}));

vi.mock("../chat-admit", async (orig) => ({
  ...(await orig<typeof import("../chat-admit")>()),
  prepareOpeningBrief: vi.fn(),
}));

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const BARCODE = "4006381333931";
const payload: FoodCardPayload = {
  items: [
    {
      name: "Oatly Oat Drink",
      unitLabel: "250 ml",
      perUnit: { calories: 115, protein: 2.5, carbs: 16.8, fat: 3.8 },
      count: 1,
      source: "lookup",
    },
  ],
  mealType: "lunch",
  day: "today",
};
const cardBlock = {
  type: "write_card" as const,
  cardId: CARD_ID,
  kind: "food" as const,
  payload,
  status: "live" as const,
};

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const post = (
  app: express.Express,
  body: Record<string, unknown> = { barcode: BARCODE },
  id: string | number = 1,
) =>
  request(app)
    .post(`/api/chat/conversations/${id}/barcode`)
    .set("X-Timezone", "America/Los_Angeles")
    .send(body);

describe("POST /api/chat/conversations/:id/barcode", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "coach" }),
    );
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
      createMockChatMessage({ id: 10, content: "Scanned a barcode" }),
    );
    vi.mocked(storage.createChatMessage).mockImplementation(
      async (conversationId, _userId, role, content, metadata) =>
        createMockChatMessage({
          id: 11,
          conversationId,
          role,
          content,
          metadata: metadata ?? null,
        }),
    );
    vi.mocked(scannedBarcodeReply).mockResolvedValue({
      payload,
      text: "I found this product from its barcode.",
    });
    vi.mocked(createWriteCardBlock).mockResolvedValue(cardBlock);
    app = createApp();
  });

  it("stores the user's turn and a reply carrying a food card", async () => {
    const res = await post(app);

    expect(res.status).toBe(201);
    expect(scannedBarcodeReply).toHaveBeenCalledWith(
      BARCODE,
      expect.objectContaining({ tz: "America/Los_Angeles", userId: "1" }),
      // No label step: the product's own numbers.
      undefined,
    );
    const turn = vi.mocked(storage.createChatMessageWithLimitCheck).mock
      .calls[0];
    expect(turn.slice(0, 3)).toEqual([1, "1", "Scanned a barcode"]);
    expect(turn[4]).toBe("coach");
    expect(createWriteCardBlock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "food" }),
      { conversationId: 1, userId: "1", tz: "America/Los_Angeles" },
      payload,
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      "I found this product from its barcode.",
      { blocks: [cardBlock] },
    );
    expect(res.body.userMessage.id).toBe(10);
    expect(res.body.assistantMessage.id).toBe(11);
    // No AI model reads a scanned barcode, so no photo credit is spent: the
    // scan has its own daily count.
    expect(storage.claimDailyAiCall).toHaveBeenCalledExactlyOnceWith(
      "1",
      "coachBarcodeScan",
      200,
    );
  });

  it("the number is never written into the conversation", async () => {
    const res = await post(app);
    expect(JSON.stringify(res.body)).not.toContain(BARCODE);
    const stored: unknown[] = [
      ...vi.mocked(storage.createChatMessageWithLimitCheck).mock.calls[0],
      ...vi.mocked(storage.createChatMessage).mock.calls[0],
    ];
    expect(JSON.stringify(stored)).not.toContain(BARCODE);
  });

  it.each([
    ["letters", "40063813339ab"],
    ["too short", "12345"],
    ["too long", "12345678901234"],
    ["a length no product barcode has", "1234567890"],
    ["a number, not a string", 4006381333931],
    ["missing", undefined],
  ])("400s on a barcode that is %s, storing nothing", async (_n, barcode) => {
    const res = await post(app, { barcode });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
  });

  it.each(["123456", "1234567890123"])(
    "accepts %s (the shortest and longest product codes)",
    async (barcode) => {
      const res = await post(app, { barcode });
      expect(res.status).toBe(201);
      expect(scannedBarcodeReply).toHaveBeenCalledWith(
        barcode,
        expect.anything(),
        undefined,
      );
    },
  );

  it("refuses a second scan while the first is still being answered", async () => {
    let finish!: () => void;
    vi.mocked(scannedBarcodeReply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ payload, text: "Found it." });
        }),
    );
    const first = post(app).then((r) => r);
    await vi.waitFor(() => expect(scannedBarcodeReply).toHaveBeenCalled());

    const second = await post(app);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("REQUEST_IN_FLIGHT");
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledTimes(1);

    finish();
    expect((await first).status).toBe(201);
    expect((await post(app)).status).toBe(201);
  });

  it("replies in text, with no card, when the product was not found", async () => {
    vi.mocked(scannedBarcodeReply).mockResolvedValue({
      payload: null,
      text: "I read the barcode but couldn't find that product.",
    });
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(createWriteCardBlock).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      "I read the barcode but couldn't find that product.",
      null,
    );
  });

  it("asks for another scan when the card could not be stored", async () => {
    vi.mocked(createWriteCardBlock).mockResolvedValue(null);
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.content).toMatch(/scan it again/i);
    expect(res.body.assistantMessage.metadata).toBeNull();
  });

  it("replies in text when the lookup fails after the turn was stored", async () => {
    vi.mocked(scannedBarcodeReply).mockRejectedValue(new Error("boom"));
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.content).toMatch(/try again/i);
    expect(res.body.assistantMessage.content).not.toContain("boom");
  });

  it("404s for a conversation the user does not own", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);
    const res = await post(app);
    expect(res.status).toBe(404);
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("refuses a recipe conversation", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "recipe" }),
    );
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
  });

  it("refuses a remix conversation", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "remix" }),
    );
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("is Coach Pro only", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await post(app);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
  });

  it("answers in the chat, with no lookup, when the day's scans are spent", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
    expect(createWriteCardBlock).not.toHaveBeenCalled();
    expect(res.body.assistantMessage.content).toMatch(/today's scan limit/i);
  });

  it("429s at the daily message limit without looking anything up", async () => {
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(null);
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("DAILY_LIMIT_REACHED");
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
  });

  // L98: the limit check saves the brief in its own transaction, so a 429
  // leaves no brief behind and the reminders uncleared.
  it("hands the opening brief to the limit check when the scan opens a new chat", async () => {
    const row = {
      content: "Good morning.",
      metadata: { kind: "opening_brief" },
    };
    vi.mocked(prepareOpeningBrief).mockResolvedValue(row);
    const res = await post(app, { barcode: BARCODE, openingBrief: "short" });
    expect(res.status).toBe(201);
    expect(prepareOpeningBrief).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ coachPro: true }),
      "short",
    );
    expect(
      vi.mocked(storage.createChatMessageWithLimitCheck).mock.calls[0][5]
        ?.openingBrief,
    ).toEqual(row);
  });

  it("passes the label read on the phone to the reply", async () => {
    const label = {
      calories: 120,
      protein: 3,
      carbs: 16,
      fat: 5,
      servingSize: "1 cup (240 ml)",
    };
    const res = await post(app, { barcode: BARCODE, label });
    expect(res.status).toBe(201);
    expect(scannedBarcodeReply).toHaveBeenCalledWith(
      BARCODE,
      expect.objectContaining({ userId: "1" }),
      label,
    );
  });

  it("400s, storing nothing, on label numbers that don't add up", async () => {
    const res = await post(app, {
      barcode: BARCODE,
      label: {
        calories: 10,
        protein: 3,
        carbs: 37,
        fat: 8,
        servingSize: "1/2 cup",
      },
    });
    expect(res.status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
    expect(scannedBarcodeReply).not.toHaveBeenCalled();
  });

  it("rejects an unknown brief form and an unknown field", async () => {
    expect(
      (await post(app, { barcode: BARCODE, openingBrief: "<script>" })).status,
    ).toBe(400);
    expect((await post(app, { barcode: BARCODE, extra: 1 })).status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("400s on a bad conversation id", async () => {
    const res = await post(app, { barcode: BARCODE }, "abc");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat/conversations/:id/label (a label read on the phone)", () => {
  let app: express.Express;
  const label = {
    calories: 250,
    protein: 5,
    carbs: 31,
    fat: 12,
    servingSize: "1 cup (228g)",
  };
  const postLabel = (
    body: Record<string, unknown> = { label },
    id: string | number = 1,
  ) =>
    request(app)
      .post(`/api/chat/conversations/${id}/label`)
      .set("X-Timezone", "America/Los_Angeles")
      .send(body);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "coach" }),
    );
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
      createMockChatMessage({ id: 10, content: "Sent a photo" }),
    );
    vi.mocked(storage.createChatMessage).mockImplementation(
      async (conversationId, _userId, role, content, metadata) =>
        createMockChatMessage({
          id: 11,
          conversationId,
          role,
          content,
          metadata: metadata ?? null,
        }),
    );
    vi.mocked(scannedLabelReply).mockResolvedValue({
      payload,
      text: "I read that label on your phone, per serving.",
    });
    vi.mocked(createWriteCardBlock).mockResolvedValue(cardBlock);
    app = createApp();
  });

  it("stores a photo turn and a reply carrying a food card, spending no photo credit", async () => {
    const res = await postLabel();
    expect(res.status).toBe(201);
    expect(scannedLabelReply).toHaveBeenCalledWith(
      label,
      expect.objectContaining({ tz: "America/Los_Angeles", userId: "1" }),
    );
    const turn = vi.mocked(storage.createChatMessageWithLimitCheck).mock
      .calls[0];
    expect(turn.slice(0, 3)).toEqual([1, "1", "Sent a photo"]);
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      "I read that label on your phone, per serving.",
      { blocks: [cardBlock] },
    );
    expect(storage.claimDailyAiCall).toHaveBeenCalledExactlyOnceWith(
      "1",
      "coachLabelRead",
      AI_DAILY_CAPS.coachLabelRead,
    );
  });

  it("asks for the photo again when the card could not be stored", async () => {
    vi.mocked(createWriteCardBlock).mockResolvedValue(null);
    await postLabel();
    expect(vi.mocked(storage.createChatMessage).mock.calls[0][3]).toMatch(
      /read your label but couldn't make the card/,
    );
  });

  it("replies in text when the reply fails after the turn was stored", async () => {
    vi.mocked(scannedLabelReply).mockRejectedValue(new Error("db down"));
    const res = await postLabel();
    expect(res.status).toBe(201);
    expect(vi.mocked(storage.createChatMessage).mock.calls[0][3]).toMatch(
      /couldn't make a card from that label/,
    );
  });

  it("answers in the chat, reading nothing, when the day's reads are spent", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    await postLabel();
    expect(scannedLabelReply).not.toHaveBeenCalled();
    expect(vi.mocked(storage.createChatMessage).mock.calls[0][3]).toMatch(
      /limit/,
    );
  });

  it("is Coach Pro only", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await postLabel();
    expect(res.status).toBe(403);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("refuses a recipe conversation", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "recipe" }),
    );
    const res = await postLabel();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Photos can only be sent to the Coach/);
  });

  it.each([
    ["a missing number", { label: { ...label, fat: undefined } }],
    ["a negative number", { label: { ...label, protein: -1 } }],
    [
      "a number past what a label prints",
      { label: { ...label, calories: 20000 } },
    ],
    ["an empty serving", { label: { ...label, servingSize: "  " } }],
    [
      "an overlong serving",
      { label: { ...label, servingSize: "x".repeat(101) } },
    ],
    ["an unknown field in the label", { label: { ...label, sodium: 10 } }],
    ["an unknown field", { label, photo: "BASE64" }],
    // The same rule the phone checks before sending: calories its own
    // macros do not make are a misread (owner report 2026-11-26).
    [
      "calories that do not match the macros",
      { label: { ...label, calories: 10 } },
    ],
  ])("400s on %s, storing nothing", async (_what, body) => {
    const res = await postLabel(body);
    expect(res.status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("accepts a high-fibre label, whose carbs make less than 4 kcal a gram", async () => {
    const res = await postLabel({
      label: {
        calories: 60,
        protein: 2,
        carbs: 25,
        fat: 1,
        servingSize: "1/2 cup (30g)",
      },
    });
    expect(res.status).toBe(201);
  });

  it("saves the opening brief first when the read opens a new chat", async () => {
    await postLabel({ label, openingBrief: "short" });
    expect(prepareOpeningBrief).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.anything(),
      "short",
    );
  });
});
