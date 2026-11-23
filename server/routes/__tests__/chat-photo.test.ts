import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { buildPhotoFoodCard } from "../../services/coach-photo";
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
  return { ...actual, buildPhotoFoodCard: vi.fn() };
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
      createMockChatMessage({ id: 10, content: "Photo of my meal" }),
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
    vi.mocked(buildPhotoFoodCard).mockResolvedValue({ payload, skipped: 0 });
    vi.mocked(createWriteCardBlock).mockResolvedValue(cardBlock);
    app = createApp();
  });

  it("stores the user's turn and a reply carrying a food card", async () => {
    const res = await post(app);

    expect(res.status).toBe(201);
    expect(buildPhotoFoodCard).toHaveBeenCalledWith(
      VALID_JPEG.toString("base64"),
      expect.objectContaining({ tz: "America/Los_Angeles" }),
    );
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      1,
      "1",
      "Photo of my meal",
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

  it("replies in text, with no card, when no food could be shown", async () => {
    vi.mocked(buildPhotoFoodCard).mockResolvedValue({
      payload: null,
      skipped: 0,
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

  it("replies in text when the analysis fails after the turn was stored", async () => {
    vi.mocked(buildPhotoFoodCard).mockRejectedValue(new Error("vision down"));
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
    expect(buildPhotoFoodCard).not.toHaveBeenCalled();
  });

  it("refuses a recipe conversation", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "recipe" }),
    );
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(buildPhotoFoodCard).not.toHaveBeenCalled();
  });

  it("is Coach Pro only", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await post(app);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(buildPhotoFoodCard).not.toHaveBeenCalled();
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

  it("429s when the daily photo analysis cap is spent, storing nothing", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(storage.claimDailyAiCall).toHaveBeenCalledWith(
      "1",
      "photoAnalysis",
      expect.any(Number),
    );
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
    expect(buildPhotoFoodCard).not.toHaveBeenCalled();
  });

  it("429s with DAILY_LIMIT_REACHED at the daily message limit, before analysis", async () => {
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(null);
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("DAILY_LIMIT_REACHED");
    expect(buildPhotoFoodCard).not.toHaveBeenCalled();
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
    const res = await post(app).send({ openingBrief: "<script>" });
    expect(res.status).toBe(400);
    expect(storage.claimDailyAiCall).toHaveBeenCalledTimes(1);
  });

  it("400s on a bad conversation id", async () => {
    const res = await post(app, "abc");
    expect(res.status).toBe(400);
  });
});
