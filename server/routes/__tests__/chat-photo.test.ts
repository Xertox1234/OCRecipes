import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { buildPhotoReply } from "../../services/coach-photo";
import { createWriteCardBlock } from "../../services/coach-pro-chat/write-card-context";
import { saveOpeningBrief } from "../chat-admit";
import { register } from "../chat-photo";
import {
  createMockChatConversation,
  createMockChatMessage,
} from "../../__tests__/factories";
import type { FoodCardPayload } from "@shared/schemas/coach-write-cards";

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

vi.mock("../../lib/openai", () => ({
  isAiConfigured: true,
  openai: {},
}));

vi.mock("../../services/coach-photo", async (orig) => {
  const actual = await orig<typeof import("../../services/coach-photo")>();
  return { ...actual, buildPhotoReply: vi.fn() };
});

vi.mock("../../services/coach-pro-chat/write-card-context", () => ({
  createWriteCardBlock: vi.fn(),
}));

vi.mock("../chat-admit", () => ({ saveOpeningBrief: vi.fn() }));

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

const { mockFileBuffer } = vi.hoisted(() => ({
  mockFileBuffer: {
    current: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) as Buffer | null,
  },
}));
const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

vi.mock("multer", () => {
  const multerMock = () => ({
    single:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        if (mockFileBuffer.current) {
          req.file = {
            buffer: mockFileBuffer.current,
            mimetype: "image/jpeg",
            originalname: "test.jpg",
            size: mockFileBuffer.current.length,
          } as Express.Multer.File;
        }
        next();
      },
  });
  multerMock.memoryStorage = () => ({});
  class MulterError extends Error {}
  return { default: multerMock, MulterError };
});

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const payload: FoodCardPayload = {
  items: [
    {
      name: "Grilled chicken breast",
      unitLabel: "1 breast (200 g)",
      perUnit: { calories: 330, protein: 62, carbs: 0, fat: 7.2 },
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

const post = (app: express.Express, id: string | number = 1) =>
  request(app)
    .post(`/api/chat/conversations/${id}/photo`)
    .set("X-Timezone", "America/Los_Angeles");

describe("POST /api/chat/conversations/:id/photo", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileBuffer.current = VALID_JPEG;
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
    vi.mocked(buildPhotoReply).mockResolvedValue({
      payload,
      text: "Here's what I see. Change any portion that looks off.",
    });
    vi.mocked(createWriteCardBlock).mockResolvedValue(cardBlock);
    app = createApp();
  });

  it("stores the user's turn and a reply carrying a food card", async () => {
    const res = await post(app);

    expect(res.status).toBe(201);
    expect(buildPhotoReply).toHaveBeenCalledWith(
      VALID_JPEG.toString("base64"),
      expect.objectContaining({ tz: "America/Los_Angeles", userId: "1" }),
    );
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      1,
      "1",
      "Sent a photo",
      expect.any(Number),
      "coach",
    );
    expect(createWriteCardBlock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "food" }),
      { conversationId: 1, userId: "1", tz: "America/Los_Angeles" },
      payload,
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(/portion/i),
      { blocks: [cardBlock] },
    );
    expect(res.body.userMessage.id).toBe(10);
    expect(res.body.assistantMessage.metadata.blocks[0].cardId).toBe(CARD_ID);
  });

  it("stores a receipt's pantry card, and tells the reply whether the plan has the pantry", async () => {
    const pantryArgs = {
      changes: [{ action: "add" as const, name: "Bread", expiresInDays: 5 }],
    };
    const pantryPayload = {
      rows: [
        {
          action: "add" as const,
          name: "Bread",
          quantity: null,
          unit: null,
          itemId: null,
          held: null,
          all: false,
          expiresInDays: 5,
        },
      ],
    };
    vi.mocked(buildPhotoReply).mockResolvedValue({
      payload: null,
      pantry: { args: pantryArgs, payload: pantryPayload },
      text: "Here's what I read from your receipt.",
    });
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(buildPhotoReply).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pantryTracking: true }),
    );
    expect(createWriteCardBlock).toHaveBeenCalledWith(
      { kind: "pantry", args: pantryArgs },
      { conversationId: 1, userId: "1", tz: "America/Los_Angeles" },
      pantryPayload,
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      "Here's what I read from your receipt.",
      { blocks: [cardBlock] },
    );

    vi.mocked(createWriteCardBlock).mockResolvedValue(null);
    await post(app);
    expect(storage.createChatMessage).toHaveBeenLastCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(/couldn't make the card/i),
      null,
    );
  });

  it("refuses a second photo while the first is still being answered, and stores nothing for it", async () => {
    let finish!: () => void;
    vi.mocked(buildPhotoReply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ payload, text: "Here's what I see." });
        }),
    );
    const first = post(app).then((r) => r);
    await vi.waitFor(() => expect(buildPhotoReply).toHaveBeenCalled());

    const second = await post(app);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("REQUEST_IN_FLIGHT");
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledTimes(1);
    expect(storage.claimDailyAiCall).toHaveBeenCalledTimes(1);

    // Another conversation is not held up by this one.
    expect((await post(app, 2)).status).toBe(201);

    finish();
    expect((await first).status).toBe(201);
    // The conversation is free again once the first turn has answered.
    expect((await post(app)).status).toBe(201);
  });

  it("replies in text, with no card, when no food could be shown", async () => {
    vi.mocked(buildPhotoReply).mockResolvedValue({
      payload: null,
      text: "I couldn't read the calories on that label.",
    });
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(createWriteCardBlock).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(/couldn't/i),
      null,
    );
  });

  it("asks for the photo again when the card could not be stored", async () => {
    vi.mocked(createWriteCardBlock).mockResolvedValue(null);
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(/couldn't make the card/i),
      null,
    );
  });

  it("replies in text when the analysis fails after the turn was stored", async () => {
    vi.mocked(buildPhotoReply).mockRejectedValue(new Error("vision down"));
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(/try again/i),
      null,
    );
  });

  it("404s for a conversation the user does not own, before any paid call", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);
    const res = await post(app);
    expect(res.status).toBe(404);
    expect(storage.getChatConversation).toHaveBeenCalledWith(1, "1");
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(buildPhotoReply).not.toHaveBeenCalled();
  });

  it("refuses a recipe conversation", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "recipe" }),
    );
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(buildPhotoReply).not.toHaveBeenCalled();
  });

  it("is Coach Pro only", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await post(app);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(buildPhotoReply).not.toHaveBeenCalled();
  });

  it("rejects a file that is not an image", async () => {
    mockFileBuffer.current = Buffer.from("not an image at all");
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
  });

  it("rejects a request with no photo", async () => {
    mockFileBuffer.current = null;
    const res = await post(app);
    expect(res.status).toBe(400);
  });

  it("answers in the chat, with no analysis, when the daily photo cap is spent", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(storage.claimDailyAiCall).toHaveBeenCalledWith(
      "1",
      "photoAnalysis",
      expect.any(Number),
    );
    expect(buildPhotoReply).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(/photo limit/i),
      null,
    );
  });

  it("429s at the daily message limit without spending a photo credit", async () => {
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(null);
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("DAILY_LIMIT_REACHED");
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(buildPhotoReply).not.toHaveBeenCalled();
  });

  it("saves the opening brief first when the photo opens a new chat", async () => {
    const res = await post(app).send({ openingBrief: "short" });
    expect(res.status).toBe(201);
    expect(saveOpeningBrief).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ coachPro: true }),
      "short",
    );
    const briefOrder = vi.mocked(saveOpeningBrief).mock.invocationCallOrder[0];
    const turnOrder = vi.mocked(storage.createChatMessageWithLimitCheck).mock
      .invocationCallOrder[0];
    expect(briefOrder).toBeLessThan(turnOrder);
  });

  it("saves no brief when none was shown, and rejects an unknown form", async () => {
    await post(app);
    expect(saveOpeningBrief).not.toHaveBeenCalled();
    vi.mocked(storage.claimDailyAiCall).mockClear();
    const res = await post(app).send({ openingBrief: "<script>" });
    expect(res.status).toBe(400);
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
  });

  it("400s on a bad conversation id", async () => {
    const res = await post(app, "abc");
    expect(res.status).toBe(400);
  });
});
