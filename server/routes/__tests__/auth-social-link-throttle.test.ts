import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";

import {
  createMockUser,
  createMockPendingSocialSignIn,
} from "../../__tests__/factories";
import { storage } from "../../storage";
import { register } from "../auth-social";

// NOTE: deliberately NO vi.mock("express-rate-limit") — this file exercises
// the REAL per-account limiter on POST /api/auth/social/link (spec §4.4: the
// password branch is a password-guessing surface, so it is throttled per
// TARGET ACCOUNT, not just per IP or per ticket). Each test uses its own target
// user id so the module-scoped MemoryStore buckets never collide.

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getPendingSignIn: vi.fn(),
    reservePendingLinkAttempt: vi.fn(),
    getUserForAuth: vi.fn(),
  },
}));

const LIMIT = 10; // mirrors the social link account limiter's max

let app: express.Express;
let hash: string;

beforeAll(async () => {
  hash = await bcrypt.hash("right-pass1", 4);
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  register(app);
});

/** Every ticket resolves to `target`; each attempt comes from a new IP. */
function aimAt(target: string) {
  const row = createMockPendingSocialSignIn({ targetUserId: target });
  vi.mocked(storage.getPendingSignIn).mockResolvedValue(row);
  vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(row);
  vi.mocked(storage.getUserForAuth).mockResolvedValue(
    createMockUser({ id: target, password: hash }),
  );
}

function guess(i: number, password = "wrong-pass1") {
  return request(app)
    .post("/api/auth/social/link")
    .set("X-Forwarded-For", `10.9.${Math.floor(i / 200)}.${i % 200}`)
    .send({ ticket: `ticket-${i}`, password });
}

describe("POST /api/auth/social/link per-account throttle", () => {
  it("locks a target account after 10 wrong passwords across fresh tickets and IPs", async () => {
    aimAt("target-a");
    for (let i = 0; i < LIMIT; i++) {
      expect((await guess(i)).status).toBe(401);
    }
    const blocked = await guess(LIMIT);
    expect(blocked.status).toBe(429);
  });

  it("does not throttle a different target account", async () => {
    aimAt("target-b");
    expect((await guess(1000)).status).toBe(401);
  });

  it("provider-proof requests are not counted against the account", async () => {
    aimAt("target-c");
    for (let i = 0; i < LIMIT; i++) {
      // No password field → the limiter skips; the request fails validation
      // of its proof elsewhere, which is not a password guess.
      await request(app)
        .post("/api/auth/social/link")
        .set("X-Forwarded-For", `10.8.0.${i}`)
        .send({
          ticket: `t-${i}`,
          provider: "apple",
          idToken: "x",
          nonce: "n",
        });
    }
    expect((await guess(2000)).status).toBe(401);
  });
});
