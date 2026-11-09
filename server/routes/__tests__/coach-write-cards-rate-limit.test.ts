// Runs the REAL express-rate-limit (coach-write-cards.test.ts mocks it).
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { register } from "../coach-write-cards";

vi.mock("../../storage", () => ({
  storage: {
    saveWriteCard: vi.fn().mockResolvedValue({ status: "not_found" }),
    undoWriteCard: vi.fn().mockResolvedValue({ status: "not_found" }),
  },
}));
vi.mock("../../middleware/auth");

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("coach write-card routes are rate limited", () => {
  it("save and undo routes are rate limited", async () => {
    const app = express();
    app.use(express.json());
    register(app);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const path = i % 2 === 0 ? "save" : "undo";
      const res = await request(app)
        .post(`/api/coach/cards/${CARD_ID}/${path}`)
        .send({});
      statuses.push(res.status);
    }
    // 30 per minute across both routes (one shared budget), then 429.
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
