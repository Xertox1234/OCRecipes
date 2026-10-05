import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../auth-social";
import { generateToken } from "../../middleware/auth";
import { createMockUser } from "../../__tests__/factories";

// NOTE: deliberately NO vi.mock("express-rate-limit") — this exercises the
// REAL limiter on POST /api/auth/identities. Connecting a sign-in method
// checks the account password (owner ruling 2026-10-05), so it must be capped
// as tightly as the other password-gated account routes (5 / hour / user),
// not at the generic 30 / minute CRUD rate.

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUser: vi.fn(),
    getUserForAuth: vi.fn(),
    getPendingSignIn: vi.fn(),
  },
}));

const LIMIT = 5;
let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  register(app);
});

function attempt(userId: string) {
  return request(app)
    .post("/api/auth/identities")
    .set("Authorization", `Bearer ${generateToken(userId, 0, true)}`)
    .send({
      provider: "google",
      idToken: "t",
      nonce: "n",
      proof: { password: "wrong-pass1" },
    });
}

describe("POST /api/auth/identities re-auth throttle", () => {
  it("allows 5 attempts per user per hour, then 429", async () => {
    const user = createMockUser({ id: "throttle-u1", password: null });
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    for (let i = 0; i < LIMIT; i++) {
      expect((await attempt("throttle-u1")).status).toBe(401);
    }
    expect((await attempt("throttle-u1")).status).toBe(429);
  });

  it("does not throttle a different user", async () => {
    const user = createMockUser({ id: "throttle-u2", password: null });
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    expect((await attempt("throttle-u2")).status).toBe(401);
  });
});
