import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", tokenVersion: 0 }),
  },
}));

function makeReqRes(token: string) {
  const req = {
    headers: { authorization: `Bearer ${token}` },
  } as unknown as Request;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(c: number) {
      (this as { statusCode: number }).statusCode = c;
      return this;
    },
    json(b: unknown) {
      (this as { body: unknown }).body = b;
      return this;
    },
  };
  return { req, res };
}

describe("requireAuth email-verified gate", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a present-and-false emailVerified claim when verification is ON", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { requireAuth } = await import("../auth");
    const token = jwt.sign(
      { sub: "u1", tokenVersion: 0, emailVerified: false },
      process.env.JWT_SECRET as string,
      {
        issuer: "ocrecipes-api",
        audience: "ocrecipes-client",
        expiresIn: "7d",
      },
    );
    const { req, res } = makeReqRes(token);
    const next = vi.fn();
    await requireAuth(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("allows a present-and-false claim when verification is OFF (fail-open)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { requireAuth } = await import("../auth");
    const token = jwt.sign(
      { sub: "u1", tokenVersion: 0, emailVerified: false },
      process.env.JWT_SECRET as string,
      {
        issuer: "ocrecipes-api",
        audience: "ocrecipes-client",
        expiresIn: "7d",
      },
    );
    const { req, res } = makeReqRes(token);
    const next = vi.fn();
    await requireAuth(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});
