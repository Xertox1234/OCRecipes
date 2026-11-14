import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createInFlightGuard, rejectOverlapping } from "../in-flight";

describe("createInFlightGuard", () => {
  it("lets one claim per key run at a time", () => {
    const guard = createInFlightGuard();
    expect(guard.claim("user-1:session-a")).toBe(true);
    expect(guard.claim("user-1:session-a")).toBe(false);
    // A different key is independent.
    expect(guard.claim("user-1:session-b")).toBe(true);
  });

  it("allows the key again once released", () => {
    const guard = createInFlightGuard();
    guard.claim("k");
    guard.release("k");
    expect(guard.claim("k")).toBe(true);
  });
});

describe("rejectOverlapping", () => {
  function appWithHeldHandler() {
    const pending: (() => void)[] = [];
    let handled = 0;
    const app = express();
    app.use(express.json());
    app.post(
      "/save",
      rejectOverlapping((req) => `user:${req.body.id ?? "none"}`),
      (_req, res) => {
        handled++;
        pending.push(() => res.status(201).json({ ok: true }));
      },
    );
    app.post(
      "/fail",
      rejectOverlapping(() => "fail"),
      (_req, res) => {
        res.status(500).json({ error: "boom" });
      },
    );
    return {
      app,
      handledCount: () => handled,
      pending,
      finishAll: () => pending.splice(0).forEach((go) => go()),
    };
  }

  it("answers 409 to an overlapping duplicate without running the handler", async () => {
    const t = appWithHeldHandler();
    const first = request(t.app)
      .post("/save")
      .send({ id: 1 })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 20));
    const second = await request(t.app).post("/save").send({ id: 1 });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("REQUEST_IN_FLIGHT");
    t.finishAll();
    expect((await first).status).toBe(201);
    expect(t.handledCount()).toBe(1);
  });

  it("lets a different key through while the first is in flight", async () => {
    const t = appWithHeldHandler();
    const first = request(t.app)
      .post("/save")
      .send({ id: 1 })
      .then((r) => r);
    const other = request(t.app)
      .post("/save")
      .send({ id: 2 })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 20));
    t.finishAll();
    expect((await first).status).toBe(201);
    expect((await other).status).toBe(201);
  });

  it("releases the key once the response has finished", async () => {
    const t = appWithHeldHandler();
    const first = request(t.app)
      .post("/save")
      .send({ id: 1 })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 20));
    t.finishAll();
    await first;
    const again = request(t.app)
      .post("/save")
      .send({ id: 1 })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 20));
    t.finishAll();
    expect((await again).status).toBe(201);
  });

  it("releases the key after an error response too", async () => {
    const t = appWithHeldHandler();
    await request(t.app).post("/fail");
    expect((await request(t.app).post("/fail")).status).toBe(500);
  });
});
