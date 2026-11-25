import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeReceiptPhotos } from "../receipt-analysis";
import { planPantryCard } from "../write-cards/pantry";
import { storage } from "../../storage";
import { pantryCardPayloadSchema } from "@shared/schemas/coach-write-cards";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import {
  receiptPhotoReply,
  receiptToPantryChanges,
  RECEIPT_TEXT,
} from "../coach-receipt-photo";

vi.mock("../receipt-analysis", () => ({ analyzeReceiptPhotos: vi.fn() }));
vi.mock("../write-cards/pantry", () => ({ planPantryCard: vi.fn() }));
vi.mock("../../storage", () => ({
  storage: {
    claimDailyAiCall: vi.fn(),
    getMonthlyReceiptScanCount: vi.fn(),
    createReceiptScan: vi.fn(),
  },
}));

type Line = Parameters<typeof receiptToPantryChanges>[0][number];

function line(over: Partial<Line> = {}): Line {
  return {
    name: "Organic Bananas",
    originalName: "ORG BNNA",
    quantity: 1,
    unit: undefined,
    category: "produce",
    isFood: true,
    estimatedShelfLifeDays: 5,
    confidence: 0.9,
    ...over,
  };
}

function receipt(items: Line[], over: Record<string, unknown> = {}) {
  return {
    items,
    storeName: "Some Store",
    purchaseDate: undefined,
    totalAmount: undefined,
    isPartialExtraction: false,
    overallConfidence: 0.9,
    ...over,
  } as Awaited<ReturnType<typeof analyzeReceiptPhotos>>;
}

describe("receiptToPantryChanges", () => {
  it("makes one add per food line with its amount, unit and shelf life", () => {
    const { changes, skipped } = receiptToPantryChanges([
      line(),
      line({
        name: "2% Milk",
        quantity: 2,
        unit: "L",
        estimatedShelfLifeDays: 10,
      }),
    ]);
    expect(skipped).toBe(0);
    expect(changes).toEqual([
      {
        action: "add",
        name: "Organic Bananas",
        quantity: "1",
        expiresInDays: 5,
      },
      {
        action: "add",
        name: "2% Milk",
        quantity: "2",
        unit: "L",
        expiresInDays: 10,
      },
    ]);
  });

  it("adds up a food printed on two lines into one row", () => {
    const { changes } = receiptToPantryChanges([
      line({ quantity: 1 }),
      line({
        name: "organic bananas ",
        quantity: 2,
        estimatedShelfLifeDays: 3,
      }),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      name: "Organic Bananas",
      quantity: "3",
    });
  });

  it("keeps lines in different units apart", () => {
    const { changes } = receiptToPantryChanges([
      line({ name: "Apples", unit: "lb" }),
      line({ name: "Apples", unit: undefined }),
    ]);
    expect(changes).toHaveLength(2);
  });

  it("leaves out a line the pantry card's rules refuse and counts it", () => {
    const { changes, skipped } = receiptToPantryChanges([
      line({ name: "   " }),
      line({ name: "Bread" }),
    ]);
    expect(changes.map((c) => c.name)).toEqual(["Bread"]);
    expect(skipped).toBe(1);
  });

  it("clips long text and keeps shelf life inside the card's 1 to 365 days", () => {
    const { changes } = receiptToPantryChanges([
      line({
        name: "x".repeat(300),
        unit: "u".repeat(60),
        estimatedShelfLifeDays: 730,
      }),
    ]);
    expect(changes[0]).toMatchObject({ expiresInDays: 365 });
    expect(changes[0].name).toHaveLength(200);
    expect((changes[0] as { unit?: string }).unit).toHaveLength(40);
  });

  it("strips invisible characters from names and clips by whole characters", () => {
    const { changes } = receiptToPantryChanges([
      line({ name: "Ba\u200bna\u202enas" }),
      line({ name: "x".repeat(199) + "\u{1F34C}" + "y" }),
    ]);
    expect(changes[0].name).toBe("Bananas");
    expect(changes[1].name).toBe("x".repeat(199) + "\u{1F34C}");
  });

  it("leaves off an amount too large for the pantry to store", () => {
    const { changes } = receiptToPantryChanges([line({ quantity: 1e12 })]);
    expect(changes[0]).not.toHaveProperty("quantity");
  });

  it("leaves the amount off when the receipt shows none", () => {
    const { changes } = receiptToPantryChanges([line({ quantity: 0 })]);
    expect(changes[0]).not.toHaveProperty("quantity");
  });

  it("keeps at most 20 rows and counts the rest", () => {
    const lines = Array.from({ length: 23 }, (_, i) =>
      line({ name: `Food ${i}` }),
    );
    const { changes, skipped } = receiptToPantryChanges(lines);
    expect(changes).toHaveLength(20);
    expect(skipped).toBe(3);
  });
});

describe("receiptPhotoReply", () => {
  const features = {
    pantryTracking: true,
    receiptScanner: true,
    monthlyReceiptScans: 15,
  };
  const ctx = { userId: "u1", features };
  const payload = {
    rows: [
      {
        action: "add" as const,
        name: "Organic Bananas",
        quantity: "1",
        unit: null,
        itemId: null,
        held: null,
        all: false,
        expiresInDays: 5,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(0);
    vi.mocked(analyzeReceiptPhotos).mockResolvedValue(receipt([line()]));
    vi.mocked(planPantryCard).mockResolvedValue({ payload, dropped: 0 });
  });

  it("reads the receipt into a pantry card", async () => {
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(storage.claimDailyAiCall).toHaveBeenCalledWith(
      "u1",
      "receiptScan",
      AI_DAILY_CAPS.receiptScan,
    );
    expect(analyzeReceiptPhotos).toHaveBeenCalledWith(["BASE64"]);
    expect(planPantryCard).toHaveBeenCalledWith(
      {
        changes: [
          {
            action: "add",
            name: "Organic Bananas",
            quantity: "1",
            expiresInDays: 5,
          },
        ],
      },
      "u1",
    );
    expect(reply.payload).toBeNull();
    expect(reply.pantry?.payload).toEqual(payload);
    expect(
      pantryCardPayloadSchema.safeParse(reply.pantry?.payload).success,
    ).toBe(true);
    expect(reply.text).toBe(RECEIPT_TEXT);
    // Counted toward the same monthly total as the pantry's receipt scan.
    expect(storage.createReceiptScan).toHaveBeenCalledWith({
      userId: "u1",
      itemCount: 1,
      photoCount: 1,
      status: "completed",
    });
  });

  it("stops at the monthly receipt limit before any credit or read", async () => {
    vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(15);
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(analyzeReceiptPhotos).not.toHaveBeenCalled();
    expect(reply.pantry).toBeUndefined();
    expect(reply.text).toMatch(/this month/);
  });

  it("records a failed read, which the monthly limit does not count, and rethrows", async () => {
    vi.mocked(analyzeReceiptPhotos).mockRejectedValue(new Error("vision down"));
    await expect(receiptPhotoReply("BASE64", ctx)).rejects.toThrow(
      "vision down",
    );
    expect(storage.createReceiptScan).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", itemCount: 0 }),
    );
  });

  it("shows no card for a read it has little confidence in (a photo that is not a receipt)", async () => {
    vi.mocked(analyzeReceiptPhotos).mockResolvedValue(
      receipt([line()], { overallConfidence: 0.2 }),
    );
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(planPantryCard).not.toHaveBeenCalled();
    expect(reply.pantry).toBeUndefined();
    expect(reply.text).toMatch(/couldn't read/);
    expect(storage.createReceiptScan).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("never repeats item names in its line (they are model output)", async () => {
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(reply.text).not.toMatch(/banana/i);
  });

  it("says when lines were left out or the receipt was cut off", async () => {
    vi.mocked(analyzeReceiptPhotos).mockResolvedValue(
      receipt([line(), line({ name: " " })], { isPartialExtraction: true }),
    );
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(reply.text).toMatch(/left out 1 line/);
    expect(reply.text).toMatch(/cut off/);
    expect(storage.createReceiptScan).toHaveBeenCalledWith(
      expect.objectContaining({ status: "partial" }),
    );
  });

  it("says no food was found and shows no card", async () => {
    vi.mocked(analyzeReceiptPhotos).mockResolvedValue(receipt([]));
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(planPantryCard).not.toHaveBeenCalled();
    expect(reply.pantry).toBeUndefined();
    expect(reply.text).toMatch(/couldn't find any food/);
  });

  it.each(["pantryTracking", "receiptScanner"] as const)(
    "asks for the plan and spends nothing without %s",
    async (flag) => {
      const reply = await receiptPhotoReply("BASE64", {
        ...ctx,
        features: { ...features, [flag]: false },
      });
      expect(storage.getMonthlyReceiptScanCount).not.toHaveBeenCalled();
      expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
      expect(analyzeReceiptPhotos).not.toHaveBeenCalled();
      expect(reply.pantry).toBeUndefined();
      expect(reply.text).toMatch(/pantry/);
    },
  );

  it("stops at the daily receipt limit without reading the receipt", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const reply = await receiptPhotoReply("BASE64", ctx);
    expect(analyzeReceiptPhotos).not.toHaveBeenCalled();
    expect(reply.pantry).toBeUndefined();
    expect(reply.text).toMatch(/limit/);
  });
});
