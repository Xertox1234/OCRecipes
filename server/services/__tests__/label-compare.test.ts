import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { buildLabelCompareBlock } from "../label-compare";
import { readLabelCompareRequest } from "../day-progress-request";
import { coachBlockSchema } from "@shared/schemas/coach-blocks";
import { createMockScannedItem } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: { getScannedItemsByIds: vi.fn() },
}));

describe("readLabelCompareRequest", () => {
  it("reads two different scan ids, whatever else the model added", () => {
    expect(
      readLabelCompareRequest({ type: "label_compare", scanIds: [4, 9] }),
    ).toEqual([4, 9]);
    expect(
      readLabelCompareRequest({
        type: "label_compare",
        scanIds: [4, 9],
        items: [{ calories: 1 }],
      }),
    ).toEqual([4, 9]);
  });

  it("is not a request without exactly two different positive ids", () => {
    for (const raw of [
      { type: "label_compare", scanIds: [4] },
      { type: "label_compare", scanIds: [4, 4] },
      { type: "label_compare", scanIds: [4, 9, 11] },
      { type: "label_compare", scanIds: [0, 9] },
      { type: "label_compare", scanIds: [4, 1e12] },
      { type: "label_compare", scanIds: ["4", "9"] },
      { type: "day_progress", scanIds: [4, 9] },
      null,
    ]) {
      expect(readLabelCompareRequest(raw)).toBeUndefined();
    }
  });
});

describe("buildLabelCompareBlock", () => {
  beforeEach(() => {
    vi.mocked(storage.getScannedItemsByIds).mockReset();
  });

  it("reads the two scans for this user, in the order the model named them", async () => {
    vi.mocked(storage.getScannedItemsByIds).mockResolvedValue([
      createMockScannedItem({
        id: 9,
        productName: "Nut bar",
        brandName: null,
        servingSize: "1 bar (35 g)",
        calories: "190.00",
        protein: "6.00",
        sodium: null,
      }),
      createMockScannedItem({
        id: 4,
        productName: "Oat bar",
        brandName: "Acme",
        servingSize: "1 bar (40 g)",
        calories: "180.00",
        protein: "4.00",
        sodium: "95.00",
      }),
    ]);
    const block = await buildLabelCompareBlock([4, 9], "user-1");
    expect(storage.getScannedItemsByIds).toHaveBeenCalledWith([4, 9], "user-1");
    expect(block.items.map((i) => i.name)).toEqual(["Oat bar", "Nut bar"]);
    expect(block.items[0]).toMatchObject({
      scanId: 4,
      brand: "Acme",
      servingSize: "1 bar (40 g)",
      calories: 180,
      protein: 4,
      sodium: 95,
    });
    expect(block.items[1].sodium).toBeNull();
    expect(coachBlockSchema.safeParse(block).success).toBe(true);
  });

  it("refuses when a scan is not this user's, or was discarded", async () => {
    vi.mocked(storage.getScannedItemsByIds).mockResolvedValue([
      createMockScannedItem({ id: 4 }),
    ]);
    await expect(buildLabelCompareBlock([4, 9], "user-1")).rejects.toThrow(
      /scan/,
    );
  });
});
