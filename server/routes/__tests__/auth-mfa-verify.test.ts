import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../auth-mfa";
import { generateToken } from "../../middleware/auth";
import { verifySecondFactor } from "../../lib/mfa/verify-second-factor";
import { sendTwoFactorNotice } from "../../services/email";
import { hashChallengeToken } from "../../lib/mfa/mfa-secrets";
import {
  createMockUser,
  createMockUserIdentity,
} from "../../__tests__/factories";
import type { MfaChallenge } from "@shared/schema";

vi.mock("../../storage", () => ({
  storage: {
    reserveMfaChallengeAttempt: vi.fn(),
    consumeMfaChallenge: vi.fn(),
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    completeLinkByTicketHash: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: vi.fn(),
}));
vi.mock("../../services/email", () => ({
  sendTwoFactorNotice: vi.fn().mockResolvedValue(undefined),
}));

// Every logger the route can reach funnels into one spy, so a test can assert
// that no code, recovery code or challenge ever appears in a log call.
const mockLog = vi.hoisted(() => {
  const log: Record<string, unknown> = {};
  for (const level of ["error", "warn", "info", "debug", "trace", "fatal"]) {
    log[level] = vi.fn();
  }
  log.child = () => log;
  return log as Record<
    "error" | "warn" | "info" | "debug" | "trace" | "fatal",
    ReturnType<typeof vi.fn>
  > & { child: () => unknown };
});
vi.mock("../../lib/logger", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/logger")>();
  return {
    ...orig,
    logger: mockLog,
    rootLogger: mockLog,
    createServiceLogger: () => mockLog,
  };
});

const CHALLENGE = "c".repeat(43);
const HASH = hashChallengeToken(CHALLENGE);
const user = createMockUser({
  id: "u1",
  email: "u1@x.com",
  tokenVersion: 4,
  mfaEnabledAt: new Date("2026-10-05T00:00:00Z"),
});
const loginChallenge: MfaChallenge = {
  tokenHash: HASH,
  userId: "u1",
  tokenVersion: 4,
  purpose: "login",
  linkTicketHash: null,
  linkMarkEmailVerified: false,
  attempts: 1,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
};
const m = vi.mocked(storage);
const flush = () => new Promise((r) => setImmediate(r));

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}
const verify = (body: object) =>
  request(app()).post("/api/auth/mfa/verify").send(body);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
  m.reserveMfaChallengeAttempt.mockResolvedValue(loginChallenge);
  m.getUserForAuth.mockResolvedValue(user);
  m.getUser.mockResolvedValue(user);
  m.consumeMfaChallenge.mockResolvedValue(true);
  vi.mocked(verifySecondFactor).mockResolvedValue({
    ok: true,
    usedRecoveryCode: false,
  });
});

describe("POST /api/auth/mfa/verify", () => {
  it("rejects a malformed body with 400", async () => {
    const res = await verify({ challenge: CHALLENGE, code: "12ab56" });
    expect(res.status).toBe(400);
    expect(m.reserveMfaChallengeAttempt).not.toHaveBeenCalled();
  });

  it("an unknown, expired or used-up challenge → 401 MFA_CHALLENGE_INVALID, no code check", async () => {
    m.reserveMfaChallengeAttempt.mockResolvedValue(undefined);
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_INVALID");
    expect(m.reserveMfaChallengeAttempt).toHaveBeenCalledWith(HASH);
    expect(verifySecondFactor).not.toHaveBeenCalled();
  });

  it("a password reset during the challenge (tokenVersion moved) kills it", async () => {
    m.getUserForAuth.mockResolvedValue({ ...user, tokenVersion: 5 });
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_INVALID");
    expect(m.consumeMfaChallenge).toHaveBeenCalledWith(HASH);
    expect(verifySecondFactor).not.toHaveBeenCalled();
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("a deleted account kills the challenge", async () => {
    m.getUserForAuth.mockResolvedValue(undefined);
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(401);
    expect(m.consumeMfaChallenge).toHaveBeenCalledWith(HASH);
  });

  it("locked → 429 MFA_LOCKED and the challenge is kept", async () => {
    vi.mocked(verifySecondFactor).mockResolvedValue({
      ok: false,
      reason: "locked",
    });
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("MFA_LOCKED");
    expect(m.consumeMfaChallenge).not.toHaveBeenCalled();
  });

  it("a wrong code → 401 MFA_CODE_INVALID and the challenge is kept", async () => {
    vi.mocked(verifySecondFactor).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CODE_INVALID");
    expect(m.consumeMfaChallenge).not.toHaveBeenCalled();
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("a right code signs in and uses up the challenge", async () => {
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "signed_in",
      token: "mock-jwt-token",
      user: { id: "u1" },
    });
    expect(res.body.replacementRecoveryCode).toBeUndefined();
    expect(verifySecondFactor).toHaveBeenCalledWith("u1", { code: "123456" });
    expect(m.consumeMfaChallenge).toHaveBeenCalledWith(HASH);
    expect(sendTwoFactorNotice).not.toHaveBeenCalled();
  });

  it("losing the race to consume the challenge mints nothing", async () => {
    m.consumeMfaChallenge.mockResolvedValue(false);
    const res = await verify({ challenge: CHALLENGE, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_INVALID");
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("the same right code sent twice at once: exactly one signs in", async () => {
    vi.mocked(verifySecondFactor)
      .mockResolvedValueOnce({ ok: true, usedRecoveryCode: false })
      .mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const [a, b] = await Promise.all([
      verify({ challenge: CHALLENGE, code: "123456" }),
      verify({ challenge: CHALLENGE, code: "123456" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it("a recovery code signs in, returns the replacement and emails a notice", async () => {
    vi.mocked(verifySecondFactor).mockResolvedValue({
      ok: true,
      usedRecoveryCode: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    const res = await verify({
      challenge: CHALLENGE,
      recoveryCode: "wxyz-wxyz-wxyz-wxyz",
    });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
    expect(verifySecondFactor).toHaveBeenCalledWith("u1", {
      recoveryCode: "wxyz-wxyz-wxyz-wxyz",
    });
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "u1@x.com",
      user.username,
      "recovery_code_used",
    );
  });

  describe("link challenge", () => {
    const linkChallenge: MfaChallenge = {
      ...loginChallenge,
      purpose: "link",
      linkTicketHash: "ticket-hash",
      linkMarkEmailVerified: true,
    };

    it("completes the link for the challenge's own account, then signs in", async () => {
      m.reserveMfaChallengeAttempt.mockResolvedValue(linkChallenge);
      m.completeLinkByTicketHash.mockResolvedValue(
        createMockUserIdentity({ id: "i1", userId: "u1" }),
      );
      const res = await verify({ challenge: CHALLENGE, code: "123456" });
      expect(res.status).toBe(200);
      expect(m.completeLinkByTicketHash).toHaveBeenCalledWith("ticket-hash", {
        markEmailVerified: true,
        targetUserId: "u1",
      });
    });

    it("a ticket that expired meanwhile → 401, no session", async () => {
      m.reserveMfaChallengeAttempt.mockResolvedValue(linkChallenge);
      m.completeLinkByTicketHash.mockResolvedValue(undefined);
      const res = await verify({ challenge: CHALLENGE, code: "123456" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("MFA_CHALLENGE_INVALID");
      expect(generateToken).not.toHaveBeenCalled();
    });

    it("a provider already linked elsewhere → 409 IDENTITY_IN_USE", async () => {
      m.reserveMfaChallengeAttempt.mockResolvedValue(linkChallenge);
      m.completeLinkByTicketHash.mockRejectedValue(
        Object.assign(new Error("dup"), { code: "23505" }),
      );
      const res = await verify({ challenge: CHALLENGE, code: "123456" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("IDENTITY_IN_USE");
    });

    it("a login challenge never touches a link ticket", async () => {
      await verify({ challenge: CHALLENGE, code: "123456" });
      expect(m.completeLinkByTicketHash).not.toHaveBeenCalled();
    });
  });

  it("never logs the challenge, the code or a recovery code", async () => {
    vi.mocked(verifySecondFactor).mockRejectedValueOnce(new Error("boom"));
    await verify({ challenge: CHALLENGE, code: "987123" });
    vi.mocked(verifySecondFactor).mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
    });
    await verify({ challenge: CHALLENGE, recoveryCode: "QQQQ-RRRR-SSSS-TTTT" });
    await flush();
    const logged = JSON.stringify(
      Object.values(mockLog)
        .filter((f) => typeof f === "function" && "mock" in f)
        .flatMap((f) => (f as ReturnType<typeof vi.fn>).mock.calls),
    );
    expect(logged).not.toContain(CHALLENGE);
    expect(logged).not.toContain("987123");
    expect(logged).not.toContain("QQQQ");
  });
});
