import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../batch-scan";
import { BatchStorageError } from "../../storage/batch";

vi.mock("../../storage", () => ({
  storage: {
    batchCreateScannedItemsWithLogs: vi.fn(),
    batchCreatePantryItems: vi.fn(),
    batchCreateGroceryItems: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const validItem = {
  id: "batch-123-1",
  barcode: "0012345678905",
  productName: "Test Product",
  quantity: 1,
  status: "resolved" as const,
  calories: 200,
  protein: 10,
  carbs: 25,
  fat: 8,
};

describe("Batch Scan Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/batch/save", () => {
    it("saves to daily_log destination", async () => {
      vi.mocked(storage.batchCreateScannedItemsWithLogs).mockResolvedValue({
        scannedCount: 2,
        logCount: 2,
      });

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [validItem, { ...validItem, id: "batch-123-2" }],
          destination: "daily_log",
          mealType: "lunch",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        destination: "daily_log",
        created: 2,
      });
      expect(storage.batchCreateScannedItemsWithLogs).toHaveBeenCalledWith(
        [validItem, { ...validItem, id: "batch-123-2" }],
        "1",
        "lunch",
      );
    });

    it("saves to pantry destination", async () => {
      vi.mocked(storage.batchCreatePantryItems).mockResolvedValue({
        count: 1,
      });

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [validItem],
          destination: "pantry",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        destination: "pantry",
        created: 1,
      });
      expect(storage.batchCreatePantryItems).toHaveBeenCalledWith(
        [validItem],
        "1",
      );
    });

    it("saves to grocery_list destination", async () => {
      vi.mocked(storage.batchCreateGroceryItems).mockResolvedValue({
        count: 3,
        groceryListId: 42,
      });

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [validItem],
          destination: "grocery_list",
          groceryListId: 42,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        destination: "grocery_list",
        created: 3,
        groceryListId: 42,
      });
      expect(storage.batchCreateGroceryItems).toHaveBeenCalledWith(
        [validItem],
        "1",
        42,
      );
    });

    describe("Zod validation", () => {
      it("rejects empty items array", async () => {
        const res = await request(app)
          .post("/api/batch/save")
          .set("Authorization", "Bearer token")
          .send({
            items: [],
            destination: "daily_log",
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });

      it("rejects more than 50 items", async () => {
        const items = Array.from({ length: 51 }, (_, i) => ({
          ...validItem,
          id: `batch-${i}`,
        }));

        const res = await request(app)
          .post("/api/batch/save")
          .set("Authorization", "Bearer token")
          .send({
            items,
            destination: "daily_log",
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });

      it("rejects invalid item schema (missing required fields)", async () => {
        const res = await request(app)
          .post("/api/batch/save")
          .set("Authorization", "Bearer token")
          .send({
            items: [{ id: "batch-1", status: "resolved" }],
            destination: "daily_log",
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });

      it("rejects item with invalid status", async () => {
        const res = await request(app)
          .post("/api/batch/save")
          .set("Authorization", "Bearer token")
          .send({
            items: [{ ...validItem, status: "pending" }],
            destination: "daily_log",
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });
    });

    it("returns 400 for invalid barcode format", async () => {
      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [{ ...validItem, barcode: "abc123" }],
          destination: "daily_log",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.error).toContain("invalid barcode format");
    });

    it("returns 400 for barcode with too few digits", async () => {
      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [{ ...validItem, barcode: "12345" }],
          destination: "daily_log",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 when grocery list not found", async () => {
      vi.mocked(storage.batchCreateGroceryItems).mockRejectedValue(
        new BatchStorageError("Grocery list not found", "NOT_FOUND"),
      );

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [validItem],
          destination: "grocery_list",
          groceryListId: 999,
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 400 when grocery list limit reached", async () => {
      vi.mocked(storage.batchCreateGroceryItems).mockRejectedValue(
        new BatchStorageError(
          "Maximum grocery list limit reached (50). Delete an existing list first.",
          "LIMIT_REACHED",
        ),
      );

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [validItem],
          destination: "grocery_list",
          groceryListId: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 500 on internal error", async () => {
      vi.mocked(storage.batchCreateScannedItemsWithLogs).mockRejectedValue(
        new Error("Database connection failed"),
      );

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [validItem],
          destination: "daily_log",
        });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });

    it("accepts items without barcode", async () => {
      vi.mocked(storage.batchCreateScannedItemsWithLogs).mockResolvedValue({
        scannedCount: 1,
        logCount: 1,
      });

      const itemWithoutBarcode = { ...validItem };
      delete (itemWithoutBarcode as Record<string, unknown>).barcode;

      const res = await request(app)
        .post("/api/batch/save")
        .set("Authorization", "Bearer token")
        .send({
          items: [itemWithoutBarcode],
          destination: "daily_log",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
