import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

// Canary for the supertest patch in test/setup.ts. Unpatched, request(app)
// listens on the wildcard address, so a loopback connection arrives as
// "::ffff:127.0.0.1" — and on macOS another process can hold 127.0.0.1 on the
// same port and answer instead. Patched, it listens on 127.0.0.1 itself.
// See docs/solutions/runtime-errors/supertest-per-request-listener-reaches-foreign-server-on-macos-2026-10-20.md
describe("supertest request(app) binds 127.0.0.1", () => {
  const app = express();
  app.get("/where", (req, res) => {
    res.json({ local: req.socket.localAddress });
  });

  it("serves from a 127.0.0.1 listener, not the wildcard", async () => {
    const res = await request(app).get("/where");
    expect(res.status).toBe(200);
    expect(res.body.local).toBe("127.0.0.1");
  });

  it("still chains .query() and .set() onto the deferred URL", async () => {
    const echo = express();
    echo.get("/echo", (req, res) => {
      res.json({ q: req.query.q, h: req.get("x-probe") });
    });
    const res = await request(echo)
      .get("/echo")
      .query({ q: "a b" })
      .set("x-probe", "1");
    expect(res.body).toEqual({ q: "a b", h: "1" });
  });

  it("reports a callback-style .end() result", async () => {
    const result = await new Promise<{ err: unknown; status?: number }>(
      (resolve) => {
        request(app)
          .get("/where")
          .expect(200)
          .end((err, res) => resolve({ err, status: res?.status }));
      },
    );
    expect(result).toEqual({ err: null, status: 200 });
  });

  it("works through request.agent(app)", async () => {
    const res = await request.agent(app).get("/where");
    expect(res.body.local).toBe("127.0.0.1");
  });
});
