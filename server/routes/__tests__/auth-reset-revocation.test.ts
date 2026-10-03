import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { generateToken } from "../../middleware/auth";
import { register } from "../auth";
import { hashResetCode } from "../../lib/password-reset-code";
import { createMockUser } from "../../__tests__/factories";

// REAL requireAuth + REAL token-version cache. Only storage, limiters and
// email are mocked. Proves the reset invalidates the cache: without
// invalidateTokenVersionCache, the warmed cache would keep the old token
// alive for up to 60s and the second /me would return 200.
vi.mock("../../storage", () => ({
  ReservedUsernameError: class extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUser: vi.fn(),
    reservePasswordResetAttempt: vi.fn(),
    completePasswordReset: vi.fn(),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotice: vi.fn().mockResolvedValue(undefined),
}));

describe("password reset revokes sessions immediately (real requireAuth)", () => {
  it("a token issued before the reset is rejected on the very next request", async () => {
    const app = express();
    app.use(express.json());
    register(app);

    const id = "revocation-user-1";
    let tokenVersion = 0;
    vi.mocked(storage.getUser).mockImplementation(async () =>
      createMockUser({
        id,
        username: "rev",
        email: "rev@example.com",
        emailVerified: true,
        tokenVersion,
      }),
    );
    vi.mocked(storage.reservePasswordResetAttempt).mockResolvedValue({
      id,
      username: "rev",
      email: "rev@example.com",
      resetCodeHash: hashResetCode(id, "123456"),
    });
    vi.mocked(storage.completePasswordReset).mockImplementation(async () => {
      tokenVersion += 1; // what the real UPDATE does
      return true;
    });

    const oldToken = generateToken(id, 0, true);

    // Warm the cache with version 0.
    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(before.status).toBe(200);

    const reset = await request(app).post("/api/auth/reset-password").send({
      email: "rev@example.com",
      code: "123456",
      newPassword: "newpass99",
    });
    expect(reset.status).toBe(200);

    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(after.status).toBe(401);
  });
});
