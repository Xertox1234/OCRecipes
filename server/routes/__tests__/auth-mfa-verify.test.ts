import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../auth-mfa";
import { hashChallengeToken, hashTrustKey } from "../../lib/mfa/mfa-secrets";
import { createMockUser } from "../../__tests__/factories";
import { generateToken } from "../../middleware/auth";
import type { MfaChallenge } from "@shared/schema";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    reserveMfaChallengeAttempt: vi.fn(),
    consumeMfaChallenge: vi.fn(),
    completeLinkByTicketHash: vi.fn(),
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    trustDevice: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

const { mockVerifySecondFactor } = vi.hoisted(() => ({
  mockVerifySecondFactor: vi.fn(),
}));
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: mockVerifySecondFactor,
}));

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

function allLogCalls(): string {
  return JSON.stringify(
    ["error", "warn", "info", "debug", "trace", "fatal"].map(
      (level) => mockLog[level as "error"].mock.calls,
    ),
  );
}

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

const CHALLENGE = "c".repeat(43);
const USER = createMockUser({
  id: "u1",
  tokenVersion: 4,
  emailVerified: true,
  mfaEnabledAt: new Date(),
});

function row(over: Partial<MfaChallenge> = {}): MfaChallenge {
  return {
    tokenHash: hashChallengeToken(CHALLENGE),
    userId: "u1",
    tokenVersion: 4,
    purpose: "login",
    linkTicketHash: null,
    linkMarkEmailVerified: false,
    attempts: 1,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...over,
  };
}

const verify = (body: object = {}) =>
  request(app())
    .post("/api/auth/mfa/verify")
    .send({ challenge: CHALLENGE, secondFactor: { code: "123456" }, ...body });

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks also clears the __mocks__ default; re-seed it.
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
  vi.mocked(storage.reserveMfaChallengeAttempt).mockResolvedValue(row());
  vi.mocked(storage.getUserForAuth).mockResolvedValue(USER);
  vi.mocked(storage.getUser).mockResolvedValue(USER);
  vi.mocked(storage.consumeMfaChallenge).mockResolvedValue(true);
  vi.mocked(storage.trustDevice).mockResolvedValue(undefined);
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
});

describe("POST /api/auth/mfa/verify", () => {
  it("400 VALIDATION_ERROR on a malformed body", async () => {
    const res = await request(app())
      .post("/api/auth/mfa/verify")
      .send({ challenge: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("a dead, spent or exhausted challenge → 401 MFA_CHALLENGE_EXPIRED", async () => {
    vi.mocked(storage.reserveMfaChallengeAttempt).mockResolvedValue(undefined);
    const res = await verify();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    expect(storage.reserveMfaChallengeAttempt).toHaveBeenCalledWith(
      hashChallengeToken(CHALLENGE),
    );
    expect(mockVerifySecondFactor).not.toHaveBeenCalled();
  });

  it("a challenge minted before a password reset (tokenVersion moved) → 401 and it is burned", async () => {
    vi.mocked(storage.reserveMfaChallengeAttempt).mockResolvedValue(
      row({ tokenVersion: 3 }),
    );
    const res = await verify();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    expect(storage.consumeMfaChallenge).toHaveBeenCalled();
    expect(mockVerifySecondFactor).not.toHaveBeenCalled();
  });

  // Auth audit 2026-10-10 L12: a reset landing between the challenge's version
  // check and minting must not yield a session that survives that reset.
  it("a reset between the version check and minting → 401, no token, replacement kept", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "NEW-CODE",
    });
    vi.mocked(storage.getUser).mockResolvedValue({ ...USER, tokenVersion: 5 });
    const res = await verify();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    expect(res.body.token).toBeUndefined();
    expect(res.body.replacementRecoveryCode).toBe("NEW-CODE");
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("a deleted user → 401 MFA_CHALLENGE_EXPIRED", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);
    const res = await verify();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
  });

  it("unreadable secret → 503 MFA_UNAVAILABLE", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });
    const res = await verify();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MFA_UNAVAILABLE");
  });

  it("wrong code → 401 INVALID_SECOND_FACTOR, the challenge survives for another try", async () => {
    mockVerifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await verify();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
    expect(res.body.error).toBe(
      "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
    );
    expect(storage.consumeMfaChallenge).not.toHaveBeenCalled();
  });

  it("right code on a login challenge → the normal session", async () => {
    const res = await verify();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed_in");
    expect(res.body.token).toBe("mock-jwt-token");
    expect(res.body.trustKey).toBeUndefined();
    expect(storage.consumeMfaChallenge).toHaveBeenCalledWith(
      hashChallengeToken(CHALLENGE),
    );
  });

  it("two concurrent verifies with one valid code → exactly one 200", async () => {
    mockVerifySecondFactor
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const [a, b] = await Promise.all([verify(), verify()]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it("a recovery code that passes but loses the consume race → 401 that STILL carries its replacement", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    vi.mocked(storage.consumeMfaChallenge).mockResolvedValue(false);
    const res = await verify({
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
  });

  it("a recovery code on success → the session carries its replacement", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    const res = await verify({
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("mock-jwt-token");
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
  });

  it("trustDevice on a login → returns a trust key and stores only its hash", async () => {
    const res = await verify({ trustDevice: true });
    expect(res.status).toBe(200);
    expect(res.body.trustKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storage.trustDevice).toHaveBeenCalledWith(
      "u1",
      hashTrustKey(res.body.trustKey),
    );
  });

  describe("link challenge (Connect prompt)", () => {
    beforeEach(() => {
      vi.mocked(storage.reserveMfaChallengeAttempt).mockResolvedValue(
        row({
          purpose: "link",
          linkTicketHash: "th",
          linkMarkEmailVerified: true,
        }),
      );
    });

    it("right code → completes the link from the stored ticket hash, then signs in", async () => {
      vi.mocked(storage.completeLinkByTicketHash).mockResolvedValue({
        id: "i1",
      } as Awaited<ReturnType<typeof storage.completeLinkByTicketHash>>);
      const res = await verify();
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("signed_in");
      expect(storage.completeLinkByTicketHash).toHaveBeenCalledWith("th", {
        markEmailVerified: true,
      });
    });

    it("trustDevice on a link returns no trust key", async () => {
      vi.mocked(storage.completeLinkByTicketHash).mockResolvedValue({
        id: "i1",
      } as Awaited<ReturnType<typeof storage.completeLinkByTicketHash>>);
      const res = await verify({ trustDevice: true });
      expect(res.body.trustKey).toBeUndefined();
      expect(storage.trustDevice).not.toHaveBeenCalled();
    });

    it("the ticket expired meanwhile → 401 INVALID_SIGN_IN_TICKET, carrying a spent recovery code's replacement", async () => {
      mockVerifySecondFactor.mockResolvedValue({
        ok: true,
        replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
      });
      vi.mocked(storage.completeLinkByTicketHash).mockResolvedValue(undefined);
      const res = await verify({
        secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_SIGN_IN_TICKET");
      expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
    });

    it("the provider account was linked elsewhere meanwhile → 409 IDENTITY_IN_USE", async () => {
      vi.mocked(storage.completeLinkByTicketHash).mockRejectedValue(
        Object.assign(new Error("dup"), { code: "23505" }),
      );
      const res = await verify();
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("IDENTITY_IN_USE");
    });
  });

  it("never logs the challenge, code, recovery code or trust key", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    vi.mocked(storage.consumeMfaChallenge).mockResolvedValue(false);
    await verify({ secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" } });
    vi.mocked(storage.consumeMfaChallenge).mockRejectedValue(new Error("db"));
    await verify({ trustDevice: true });
    // Denominator: the second request's DB error WAS logged.
    expect(mockLog.error).toHaveBeenCalled();
    const logs = allLogCalls();
    for (const secret of [
      CHALLENGE,
      "123456",
      "WXYZ-WXYZ-WXYZ-WXYZ",
      "AAAA-BBBB-CCCC-DDDD",
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
