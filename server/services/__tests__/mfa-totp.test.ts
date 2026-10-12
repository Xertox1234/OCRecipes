import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { storage } from "../../storage";
import { sendTwoFactorNotice } from "../email";
import {
  checkPendingTotpCode,
  confirmFirstEnrollment,
  stageTotpSecret,
  TotpStateChangedError,
  TotpUnavailableError,
} from "../mfa-totp";
import { encryptMfaSecret } from "../../lib/mfa/mfa-secrets";
import { base32Decode, hotp, timeStep } from "../../lib/mfa/totp";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    startTotpEnrollment: vi.fn(),
    getPendingTotpSecret: vi.fn(),
    recordMfaFailure: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
  },
}));
vi.mock("../email", () => ({ sendTwoFactorNotice: vi.fn() }));

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const USER = { id: "1", email: "u@example.com", username: "testuser" };
const currentCode = () => hotp(base32Decode(SECRET), timeStep(Date.now()));
let savedKey: string | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendTwoFactorNotice).mockResolvedValue(undefined);
  vi.mocked(storage.startTotpEnrollment).mockResolvedValue(true);
  vi.mocked(storage.recordMfaFailure).mockResolvedValue({
    failedAttempts: 1,
    tripped: false,
  });
  savedKey = process.env.MFA_SECRET_ENC_KEY;
  process.env.MFA_SECRET_ENC_KEY = crypto.randomBytes(32).toString("base64");
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.MFA_SECRET_ENC_KEY;
  else process.env.MFA_SECRET_ENC_KEY = savedKey;
});

describe("stageTotpSecret", () => {
  it("stores only the encrypted secret and returns the authenticator link", async () => {
    const r = await stageTotpSecret({
      id: "1",
      username: "testuser",
      mfaEnabledAt: null,
    });
    expect(r.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(r.otpauthUrl).toContain(`secret=${r.secret}`);
    expect(r.otpauthUrl).toContain("OCRecipes:testuser");
    const [userId, stored] = vi.mocked(storage.startTotpEnrollment).mock
      .calls[0];
    expect(userId).toBe("1");
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(r.secret);
  });

  it("with no key → TotpUnavailableError, nothing stored", async () => {
    delete process.env.MFA_SECRET_ENC_KEY;
    await expect(
      stageTotpSecret({ id: "1", username: "u", mfaEnabledAt: null }),
    ).rejects.toBeInstanceOf(TotpUnavailableError);
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });
});

// Auth audit 2026-10-10 L13: stage only while the account is still in the MFA
// state the caller checked (setup: off, new phone: on).
describe("stageTotpSecret — state guard", () => {
  it("passes the expected state; a lost race → TotpStateChangedError", async () => {
    vi.mocked(storage.startTotpEnrollment).mockResolvedValue(false);
    const err = await stageTotpSecret({
      id: "1",
      username: "u",
      mfaEnabledAt: new Date(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TotpStateChangedError);
    expect((err as TotpStateChangedError).mfaEnabled).toBe(true);
    expect(vi.mocked(storage.startTotpEnrollment).mock.calls[0][2]).toEqual({
      mfaEnabled: true,
    });
  });
});

describe("checkPendingTotpCode", () => {
  it("right code → ok with its step", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    expect(await checkPendingTotpCode(USER, currentCode())).toEqual({
      ok: true,
      step: expect.any(Number),
    });
  });

  // Auth audit 2026-10-10 L9: every factor check counts toward the lock.
  it("a wrong code is counted; tripping the lock sends the lock notice", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    const wrong = currentCode() === "000000" ? "111111" : "000000";
    vi.mocked(storage.recordMfaFailure).mockResolvedValueOnce({
      failedAttempts: 10,
      tripped: true,
    });
    await checkPendingTotpCode(USER, wrong);
    expect(storage.recordMfaFailure).toHaveBeenCalledWith("1");
    await vi.waitFor(() =>
      expect(sendTwoFactorNotice).toHaveBeenCalledWith(
        USER.email,
        USER.username,
        "locked",
      ),
    );
  });

  it("nothing pending is not counted (a locked account reads as nothing pending)", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(undefined);
    await checkPendingTotpCode(USER, "123456");
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("wrong code → wrong_code", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    const wrong = currentCode() === "000000" ? "111111" : "000000";
    expect(await checkPendingTotpCode(USER, wrong)).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });

  it("nothing pending (or expired) → wrong_code", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(undefined);
    expect(await checkPendingTotpCode(USER, "123456")).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });

  it("a pending secret the key can't decrypt → unavailable", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      "v1:not-really-ciphertext",
    );
    expect(await checkPendingTotpCode(USER, "123456")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("confirmFirstEnrollment", () => {
  const user = createMockUser({ id: "1", mfaEnabledAt: null });

  it("10 codes, only hashes stored, the session's version returned, the 'enabled' notice", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(1);
    const enrolled = await confirmFirstEnrollment(user, 5);
    const codes = enrolled?.recoveryCodes;
    expect(codes).toHaveLength(10);
    // The version the enrolment bumped to, for the session (auth audit L1).
    expect(enrolled?.tokenVersion).toBe(1);
    const [userId, opts] = vi.mocked(storage.confirmTotpEnrollment).mock
      .calls[0];
    expect(userId).toBe("1");
    expect(opts.acceptedStep).toBe(5);
    expect(opts.recoveryHashes).toHaveLength(10);
    expect(opts.recoveryHashes).not.toContain(codes![0]);
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      user.email,
      user.username,
      "enabled",
    );
  });

  it("the storage guard refused → undefined, no notice", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(undefined);
    expect(await confirmFirstEnrollment(user, 5)).toBeUndefined();
    expect(sendTwoFactorNotice).not.toHaveBeenCalled();
  });
});
