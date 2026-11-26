import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { scannedBarcodeFrontReply } from "../../services/coach-scan-reply";
import { createWriteCardBlock } from "../../services/coach-pro-chat/write-card-context";
import { isAiSharingAllowedFor } from "../../lib/ai-sharing-gate";
import { register } from "../chat-barcode-front";
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

vi.mock("../../lib/openai", () => ({ isAiConfigured: true, openai: {} }));

vi.mock("../../lib/ai-sharing-gate", async (orig) => ({
  ...(await orig<typeof import("../../lib/ai-sharing-gate")>()),
  isAiSharingAllowedFor: vi.fn(),
}));

vi.mock("../../services/coach-scan-reply", () => ({
  scannedBarcodeFrontReply: vi.fn(),
}));

vi.mock("../../services/coach-pro-chat/write-card-context", () => ({
  createWriteCardBlock: vi.fn(),
}));

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

const { mockFileBuffer, mockScanField } = vi.hoisted(() => ({
  mockFileBuffer: {
    current: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) as Buffer | null,
  },
  // The multipart `scan` field, as multer would set it on req.body.
  mockScanField: { current: undefined as string | undefined },
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
        req.body =
          mockScanField.current === undefined
            ? {}
            : { scan: mockScanField.current };
        if (mockFileBuffer.current) {
          req.file = {
            buffer: mockFileBuffer.current,
            mimetype: "image/jpeg",
            originalname: "front.jpg",
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

const BARCODE = "4006381333931";
const LABEL = {
  calories: 120,
  protein: 3,
  carbs: 16,
  fat: 5,
  servingSize: "1 cup (240 ml)",
};
const payload: FoodCardPayload = {
  items: [
    {
      name: "Kind Dark Chocolate Nuts",
      unitLabel: "1 serving (1 cup (240 ml))",
      perUnit: { calories: 120, protein: 3, carbs: 16, fat: 5 },
      count: 1,
      source: "lookup",
    },
  ],
  mealType: "lunch",
  day: "today",
};
const cardBlock = {
  type: "write_card" as const,
  cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
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
  scan: unknown = { barcode: BARCODE, label: LABEL },
  id: string | number = 1,
) => {
  mockScanField.current =
    typeof scan === "string" ? scan : JSON.stringify(scan);
  return request(app)
    .post(`/api/chat/conversations/${id}/barcode-front`)
    .set("X-Timezone", "America/Los_Angeles");
};

describe("POST /api/chat/conversations/:id/barcode-front", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileBuffer.current = VALID_JPEG;
    mockScanField.current = undefined;
    vi.mocked(isAiSharingAllowedFor).mockResolvedValue(true);
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
    vi.mocked(scannedBarcodeFrontReply).mockResolvedValue({
      payload,
      text: "I took its name from the front of the pack.",
    });
    vi.mocked(createWriteCardBlock).mockResolvedValue(cardBlock);
    app = createApp();
  });

  it("reads the front with the code and the label, spending a photo credit", async () => {
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(scannedBarcodeFrontReply).toHaveBeenCalledWith(
      BARCODE,
      VALID_JPEG.toString("base64"),
      expect.objectContaining({ tz: "America/Los_Angeles", userId: "1" }),
      LABEL,
    );
    const turn = vi.mocked(storage.createChatMessageWithLimitCheck).mock
      .calls[0];
    expect(turn.slice(0, 3)).toEqual([1, "1", "Scanned a barcode"]);
    // An AI model reads the photo: the photo credit, not the scan count.
    expect(storage.claimDailyAiCall).toHaveBeenCalledExactlyOnceWith(
      "1",
      "photoAnalysis",
      AI_DAILY_CAPS.photoAnalysis,
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      "I took its name from the front of the pack.",
      { blocks: [cardBlock] },
    );
  });

  it("needs AI sharing allowed, before anything is stored", async () => {
    vi.mocked(isAiSharingAllowedFor).mockResolvedValue(false);
    const res = await post(app);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_SHARING_REQUIRED");
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
    expect(scannedBarcodeFrontReply).not.toHaveBeenCalled();
  });

  it("is Coach Pro only", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await post(app);
    expect(res.status).toBe(403);
    expect(scannedBarcodeFrontReply).not.toHaveBeenCalled();
  });

  it("answers in the chat, reading nothing, when the day's photos are spent", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(scannedBarcodeFrontReply).not.toHaveBeenCalled();
    expect(vi.mocked(storage.createChatMessage).mock.calls[0][3]).toMatch(
      /photo limit/i,
    );
  });

  it("rejects a file that is not an image, and no file", async () => {
    mockFileBuffer.current = Buffer.from("not an image at all");
    expect((await post(app)).status).toBe(400);
    mockFileBuffer.current = null;
    expect((await post(app)).status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("needs the label with the code: the front alone carries no numbers", async () => {
    expect((await post(app, { barcode: BARCODE })).status).toBe(400);
    expect((await post(app, { barcode: "123", label: LABEL })).status).toBe(
      400,
    );
    expect(
      (
        await post(app, {
          barcode: BARCODE,
          label: { ...LABEL, calories: 10, carbs: 37, fat: 8 },
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(app, { barcode: BARCODE, label: LABEL, extra: 1 })).status,
    ).toBe(400);
    expect((await post(app, "{not json")).status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("400s with no scan field", async () => {
    mockScanField.current = undefined;
    const res = await request(app)
      .post("/api/chat/conversations/1/barcode-front")
      .set("X-Timezone", "America/Los_Angeles");
    expect(res.status).toBe(400);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
  });

  it("refuses a recipe conversation", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "1", type: "recipe" }),
    );
    expect((await post(app)).status).toBe(400);
    expect(scannedBarcodeFrontReply).not.toHaveBeenCalled();
  });

  it("replies in text when the read fails after the turn was stored", async () => {
    vi.mocked(scannedBarcodeFrontReply).mockRejectedValue(new Error("boom"));
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(vi.mocked(storage.createChatMessage).mock.calls[0][4]).toBeNull();
  });
});
