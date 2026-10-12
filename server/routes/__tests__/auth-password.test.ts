import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-password";
import {
  requireAuth,
  invalidateTokenVersionCache,
} from "../../middleware/auth";
import {
  sendPasswordChangeCode,
  sendPasswordChangedNotice,
} from "../../services/email";
import { reauthenticate, issueSession } from "../auth-social";
import { serializeUser } from "../_serialize-user";
import { createMockUser } from "../../__tests__/factories";
import { hashChangeCode } from "../../lib/password-reset-code";
import { isBreached } from "../../lib/pwned-password";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserForAuth: vi.fn(),
    issuePasswordChangeCode: vi.fn(),
    reservePasswordChangeAttempt: vi.fn(),
    changePassword: vi.fn(),
    listIdentities: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/pwned-password", () => ({
  isBreached: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/email", () => ({
  sendPasswordChangeCode: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));
// reauthenticate and issueSession have their own tests in auth-social; here
// they are seams so each proof branch and the mint can be asserted.
vi.mock("../auth-social", async (orig) => ({
  ...(await orig<typeof import("../auth-social")>()),
  reauthenticate: vi.fn(),
  issueSession: vi.fn(),
}));
const { mockVerifySecondFactor } = vi.hoisted(() => ({
  mockVerifySecondFactor: vi.fn(),
}));
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: mockVerifySecondFactor,
}));

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}
const post = (path: string, body: object = {}) =>
  request(app())
    .post(`/api/auth/${path}`)
    .set("Authorization", "Bearer t")
    .send(body);

const LONG = "a-long-new-passphrase-1"; // 23
let user: ReturnType<typeof createMockUser>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockImplementation(async (req, _res, next) => {
    req.userId = "1";
    next();
  });
  user = createMockUser({
    id: "1",
    email: "owner@example.com",
    pendingEmail: "staged@example.com",
    tokenVersion: 4,
    mfaEnabledAt: null,
    password: await bcrypt.hash("current-pass-123", 4),
  });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
  vi.mocked(storage.issuePasswordChangeCode).mockResolvedValue(true);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
  vi.mocked(sendPasswordChangeCode).mockResolvedValue(undefined);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
});

describe("POST /api/auth/change-password/code", () => {
  // Review Focus 1.
  it("stores a hashed code and sends it to the current address, never pendingEmail", async () => {
    const res = await post("change-password/code");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "code_sent" });
    const [uid, stored] = vi.mocked(storage.issuePasswordChangeCode).mock
      .calls[0];
    expect(uid).toBe("1");
    const [to, code] = vi.mocked(sendPasswordChangeCode).mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(stored).toBe(hashChangeCode("1", code)); // only the hash is stored
  });

  it("at the cap → 429 with the plain message, nothing sent", async () => {
    vi.mocked(storage.issuePasswordChangeCode).mockResolvedValue(false);
    const res = await post("change-password/code");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error:
        "You've requested too many codes today. Try again tomorrow, or use Google/Apple.",
      code: "RATE_LIMITED",
    });
    expect(sendPasswordChangeCode).not.toHaveBeenCalled();
  });

  it("the user vanished → 404", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);
    expect((await post("change-password/code")).status).toBe(404);
  });
});

// Built from the real serializer so the mock has issueSession's exact type.
const SESSION: Awaited<ReturnType<typeof issueSession>> = {
  status: "signed_in",
  user: serializeUser(createMockUser({ id: "1" })),
  token: "jwt-new",
};

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.mocked(reauthenticate).mockResolvedValue(true);
    vi.mocked(storage.changePassword).mockResolvedValue({
      ok: true,
      tokenVersion: 5,
    });
    vi.mocked(issueSession).mockResolvedValue(SESSION);
  });

  it("current password → changed, others signed out, this phone gets a session under the new version", async () => {
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SESSION);
    expect(reauthenticate).toHaveBeenCalledWith("1", user.password, {
      password: "current-pass-123",
    });
    const call = vi.mocked(storage.changePassword).mock.calls[0][0];
    expect(call.userId).toBe("1");
    expect(call.expectedTokenVersion).toBe(4); // the version the route loaded
    expect(call.consumeCodeHash).toBeUndefined();
    expect(call.newPasswordHash).not.toBe(LONG); // hashed, never stored raw
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(issueSession).toHaveBeenCalledWith("1", 5);
    await vi.waitFor(() =>
      expect(sendPasswordChangedNotice).toHaveBeenCalledWith(
        "owner@example.com",
        user.username,
        [],
      ),
    );
  });

  it("Google/Apple proof is passed through to reauthenticate unchanged", async () => {
    const proof = { provider: "google", idToken: "id", nonce: "n" };
    const res = await post("change-password", { proof, newPassword: LONG });
    expect(res.status).toBe(200);
    expect(reauthenticate).toHaveBeenCalledWith("1", user.password, proof);
  });

  it("wrong current password / failed Google check → 401, nothing written", async () => {
    vi.mocked(reauthenticate).mockResolvedValue(false);
    const res = await post("change-password", {
      proof: { password: "nope" },
      newPassword: LONG,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "That didn't match. Try again.",
      code: "UNAUTHORIZED",
    });
    expect(storage.changePassword).not.toHaveBeenCalled();
  });

  it("emailed code → changed, and that code is consumed in the commit", async () => {
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
      hashChangeCode("1", "123456"),
    );
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(
      vi.mocked(storage.changePassword).mock.calls[0][0].consumeCodeHash,
    ).toBe(hashChangeCode("1", "123456"));
  });

  it.each([
    ["wrong code", hashChangeCode("1", "999999")],
    ["no live code", undefined],
  ])("%s → 400 INVALID_RESET_CODE, nothing written", async (_label, stored) => {
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(stored);
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "That code didn't work. Request a new one.",
      code: "INVALID_RESET_CODE",
    });
    expect(storage.changePassword).not.toHaveBeenCalled();
  });

  describe("two-step on", () => {
    beforeEach(() => {
      user.mfaEnabledAt = new Date();
    });

    it("password proof without the code → 403 SECOND_FACTOR_REQUIRED", async () => {
      const res = await post("change-password", {
        proof: { password: "current-pass-123" },
        newPassword: LONG,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
      expect(storage.changePassword).not.toHaveBeenCalled();
    });

    it("password proof with the emailed two-step code → changed", async () => {
      mockVerifySecondFactor.mockResolvedValue({ ok: true });
      const res = await post("change-password", {
        proof: {
          password: "current-pass-123",
          secondFactor: { code: "654321" },
        },
        newPassword: LONG,
      });
      expect(res.status).toBe(200);
      expect(mockVerifySecondFactor).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        { code: "654321" },
      );
      expect(storage.changePassword).toHaveBeenCalled();
    });

    // Owner ruling 4: the change-password code already proved the same inbox —
    // never ask for a second emailed code.
    it("the emailed change code alone is enough", async () => {
      vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
        hashChangeCode("1", "123456"),
      );
      const res = await post("change-password", {
        proof: { emailCode: "123456" },
        newPassword: LONG,
      });
      expect(res.status).toBe(200);
      expect(mockVerifySecondFactor).not.toHaveBeenCalled();
      expect(storage.changePassword).toHaveBeenCalled();
    });

    it("Google/Apple proof needs no code", async () => {
      const res = await post("change-password", {
        proof: { provider: "apple", idToken: "id", nonce: "n" },
        newPassword: LONG,
      });
      expect(res.status).toBe(200);
      expect(mockVerifySecondFactor).not.toHaveBeenCalled();
    });

    it("wrong two-step code → 401, nothing written", async () => {
      mockVerifySecondFactor.mockResolvedValue({ ok: false });
      const res = await post("change-password", {
        proof: {
          password: "current-pass-123",
          secondFactor: { code: "000000" },
        },
        newPassword: LONG,
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
      expect(storage.changePassword).not.toHaveBeenCalled();
    });

    // A rejected new password must not spend a guess at the two-step code.
    it("a breached new password is refused before the two-step code is checked", async () => {
      vi.mocked(isBreached).mockResolvedValue(true);
      const res = await post("change-password", {
        proof: {
          password: "current-pass-123",
          secondFactor: { code: "654321" },
        },
        newPassword: LONG,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PASSWORD_BREACHED");
      expect(mockVerifySecondFactor).not.toHaveBeenCalled();
      expect(storage.changePassword).not.toHaveBeenCalled();
    });

    it("…nor the emailed change code", async () => {
      vi.mocked(isBreached).mockResolvedValue(true);
      const res = await post("change-password", {
        proof: { emailCode: "123456" },
        newPassword: LONG,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PASSWORD_BREACHED");
      expect(storage.reservePasswordChangeAttempt).not.toHaveBeenCalled();
    });
  });

  // Review Focus 4.
  it("password-less + two-step: the emailed change code alone sets a password", async () => {
    user.password = null;
    user.mfaEnabledAt = new Date();
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
      hashChangeCode("1", "123456"),
    );
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(mockVerifySecondFactor).not.toHaveBeenCalled();
  });

  it("password-less account: Set a password with Google works", async () => {
    user.password = null;
    const res = await post("change-password", {
      proof: { provider: "google", idToken: "id", nonce: "n" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(reauthenticate).toHaveBeenCalledWith("1", null, expect.anything());
  });

  it("12 characters on an account without two-step → changed (8 for everyone, owner ruling 2026-10-12)", async () => {
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: "short-pass-1", // 12
    });
    expect(res.status).toBe(200);
    expect(storage.changePassword).toHaveBeenCalledTimes(1);
  });

  it("7 characters → 400, nothing written", async () => {
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: "short-7",
    });
    expect(res.status).toBe(400);
    expect(storage.changePassword).not.toHaveBeenCalled();
  });

  it("a reset or sign-out landed mid-request → 401 TOKEN_REVOKED", async () => {
    vi.mocked(storage.changePassword).mockResolvedValue({
      ok: false,
      reason: "version_moved",
    });
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Please sign in again.",
      code: "TOKEN_REVOKED",
    });
    expect(issueSession).not.toHaveBeenCalled();
  });

  // Review: a newer code replaced this one mid-request. The session was not
  // revoked, so the answer must not sign the phone out.
  it("the code was replaced mid-request → 400 INVALID_RESET_CODE, not a sign-out", async () => {
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
      hashChangeCode("1", "123456"),
    );
    vi.mocked(storage.changePassword).mockResolvedValue({
      ok: false,
      reason: "code_gone",
    });
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "That code didn't work. Request a new one.",
      code: "INVALID_RESET_CODE",
    });
    expect(invalidateTokenVersionCache).not.toHaveBeenCalled();
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("a failed sign-in-methods lookup still sends the changed notice", async () => {
    vi.mocked(storage.listIdentities).mockRejectedValue(new Error("db"));
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(sendPasswordChangedNotice).toHaveBeenCalledWith(
        "owner@example.com",
        user.username,
        [],
      ),
    );
  });

  it("the mint is refused (version moved again after commit) → 401 TOKEN_REVOKED", async () => {
    const { HttpFailure } = await import("../auth-social");
    vi.mocked(issueSession).mockRejectedValue(
      new HttpFailure(401, "MFA_CHALLENGE_EXPIRED", "x"),
    );
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_REVOKED");
  });

  it("a proof of no known kind → 400 VALIDATION_ERROR", async () => {
    const res = await post("change-password", {
      proof: { magic: true },
      newPassword: LONG,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
