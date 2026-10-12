import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";

import {
  createMockUser,
  createMockPendingSocialSignIn,
  createMockUserIdentity,
} from "../../__tests__/factories";
import { storage } from "../../storage";
import { register } from "../auth-social";

// The per-account cap on the PASSWORD branch of POST /api/auth/social/link
// (spec §4.4) is counted in Postgres (auth audit 2026-10-10 L15), so a deploy
// never resets it — the storage half is proven against a real DB in
// server/storage/__tests__/social-link-guesses.test.ts. Here: the route
// reserves a guess against the TARGET account before checking the password,
// answers 429 when the cap is reached, and gives the guess back when the
// password was right (only failures count).

vi.mock("express-rate-limit");
vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getPendingSignIn: vi.fn(),
    reservePendingLinkAttempt: vi.fn(),
    getUserForAuth: vi.fn(),
    reserveLinkPasswordGuess: vi.fn(),
    refundLinkPasswordGuess: vi.fn(),
    consumeNonce: vi.fn(),
    completeLinkFromTicket: vi.fn(),
    getUser: vi.fn(),
  },
}));

let app: express.Express;
let hash: string;

beforeAll(async () => {
  hash = await bcrypt.hash("right-pass1", 4);
  app = express();
  app.use(express.json());
  register(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  const row = createMockPendingSocialSignIn({ targetUserId: "target-a" });
  vi.mocked(storage.getPendingSignIn).mockResolvedValue(row);
  vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(row);
  vi.mocked(storage.getUserForAuth).mockResolvedValue(
    createMockUser({ id: "target-a", password: hash, mfaEnabledAt: null }),
  );
  vi.mocked(storage.reserveLinkPasswordGuess).mockResolvedValue(true);
  vi.mocked(storage.refundLinkPasswordGuess).mockResolvedValue(undefined);
  vi.mocked(storage.completeLinkFromTicket).mockResolvedValue(
    createMockUserIdentity({ id: "i1", userId: "target-a" }),
  );
  vi.mocked(storage.getUser).mockResolvedValue(
    createMockUser({ id: "target-a", mfaEnabledAt: null }),
  );
});

const guess = (password = "wrong-pass1") =>
  request(app).post("/api/auth/social/link").send({ ticket: "t", password });

describe("POST /api/auth/social/link per-account cap", () => {
  it("cap reached → 429 RATE_LIMITED before the password is checked", async () => {
    vi.mocked(storage.reserveLinkPasswordGuess).mockResolvedValue(false);
    const res = await guess("right-pass1");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: "Too many sign-in attempts, please try again later",
      code: "RATE_LIMITED",
    });
    expect(storage.reserveLinkPasswordGuess).toHaveBeenCalledWith(
      "target-a",
      10,
    );
    expect(storage.getUserForAuth).not.toHaveBeenCalled();
    expect(storage.refundLinkPasswordGuess).not.toHaveBeenCalled();
  });

  it("a wrong password spends the guess (401, no refund)", async () => {
    const res = await guess();
    expect(res.status).toBe(401);
    expect(storage.reserveLinkPasswordGuess).toHaveBeenCalledWith(
      "target-a",
      10,
    );
    expect(storage.refundLinkPasswordGuess).not.toHaveBeenCalled();
  });

  it("a right password gives the guess back", async () => {
    const res = await guess("right-pass1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed_in");
    expect(storage.refundLinkPasswordGuess).toHaveBeenCalledWith("target-a");
  });

  it("a dead ticket never reaches the account counter", async () => {
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(undefined);
    const res = await guess();
    expect(res.status).toBe(400);
    expect(storage.reserveLinkPasswordGuess).not.toHaveBeenCalled();
  });

  it("provider-proof requests are not counted against the account", async () => {
    await request(app).post("/api/auth/social/link").send({
      ticket: "t",
      provider: "apple",
      idToken: "x",
      nonce: "n",
    });
    expect(storage.reserveLinkPasswordGuess).not.toHaveBeenCalled();
  });
});
