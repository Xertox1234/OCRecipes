import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

// Canary for supertest's loopback bind. Before 7.3, request(app) listened on
// the wildcard address, so a loopback connection arrived as "::ffff:127.0.0.1"
// — and on macOS another process could hold 127.0.0.1 on the same port and
// answer instead; test/setup.ts patched it. supertest 7.3 binds 127.0.0.1
// itself and the patch is gone; if a future supertest drops the bind, this fails.
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
