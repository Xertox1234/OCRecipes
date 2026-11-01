import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";

import { bodyShapeBudget, MAX_BODY_VALUES } from "../body-shape-budget";

function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(bodyShapeBudget);
  app.post("/test", (req, res) => {
    const parsed = z
      .object({ ids: z.array(z.number()).max(500) })
      .safeParse(req.body);
    res.json({ ok: parsed.success });
  });
  return app;
}

describe("bodyShapeBudget", () => {
  it("rejects a body with more values than the budget before validation runs", async () => {
    // ~2 MB of one-character elements: zod would build one issue per element.
    const body = `{"ids":[${Array(1_000_000).fill("0").join(",")}]}`;

    const res = await request(createApp())
      .post("/test")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("counts nested values, not just the top-level array", async () => {
    const inner = Array(100).fill(0);
    const body = { ids: Array(MAX_BODY_VALUES / 100).fill(inner) };

    const res = await request(createApp()).post("/test").send(body);

    expect(res.status).toBe(413);
  });

  it("passes the largest legitimate list through (500 ids)", async () => {
    const body = { ids: Array.from({ length: 500 }, (_, i) => i + 1) };

    const res = await request(createApp()).post("/test").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("passes a body exactly at the budget", async () => {
    // The object itself and the array are two values; the rest are elements.
    const body = { ids: Array(MAX_BODY_VALUES - 2).fill(1) };

    const res = await request(createApp()).post("/test").send(body);

    expect(res.status).toBe(200);
  });

  it("passes requests without a body", async () => {
    const res = await request(createApp()).post("/test");

    expect(res.status).toBe(200);
  });
});
