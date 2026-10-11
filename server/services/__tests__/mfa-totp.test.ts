import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { storage } from "../../storage";
import { sendTwoFactorNotice } from "../email";
import {
  checkPendingTotpCode,
  confirmFirstEnrollment,
  stageTotpSecret,
  TotpUnavailableError,
} from "../mfa-totp";
import { encryptMfaSecret } from "../../lib/mfa/mfa-secrets";
import { base32Decode, hotp, timeStep } from "../../lib/mfa/totp";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    startTotpEnrollment: vi.fn(),
    getPendingTotpSecret: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
  },
}));
vi.mock("../email", () => ({ sendTwoFactorNotice: vi.fn() }));

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const currentCode = () => hotp(base32Decode(SECRET), timeStep(Date.now()));
let savedKey: string | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendTwoFactorNotice).mockResolvedValue(undefined);
  savedKey = process.env.MFA_SECRET_ENC_KEY;
  process.env.MFA_SECRET_ENC_KEY = crypto.randomBytes(32).toString("base64");
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.MFA_SECRET_ENC_KEY;
  else process.env.MFA_SECRET_ENC_KEY = savedKey;
});

describe("stageTotpSecret", () => {
  it("stores only the encrypted secret and returns the authenticator link", async () => {
    const r = await stageTotpSecret({ id: "1", username: "testuser" });
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
      stageTotpSecret({ id: "1", username: "u" }),
    ).rejects.toBeInstanceOf(TotpUnavailableError);
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });
});

describe("checkPendingTotpCode", () => {
  it("right code → ok with its step", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    expect(await checkPendingTotpCode("1", currentCode())).toEqual({
      ok: true,
      step: expect.any(Number),
    });
  });

  it("wrong code → wrong_code", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    const wrong = currentCode() === "000000" ? "111111" : "000000";
    expect(await checkPendingTotpCode("1", wrong)).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });

  it("nothing pending (or expired) → wrong_code", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(undefined);
    expect(await checkPendingTotpCode("1", "123456")).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });

  it("a pending secret the key can't decrypt → unavailable", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      "v1:not-really-ciphertext",
    );
    expect(await checkPendingTotpCode("1", "123456")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("confirmFirstEnrollment", () => {
  const user = createMockUser({ id: "1", mfaEnabledAt: null });

  it("through a pass: 10 codes, only hashes stored, the pass passed through, the sign-in notice", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(1);
    const codes = await confirmFirstEnrollment(user, 5, {
      upgradePass: { idHash: "h", tokenVersion: 0 },
    });
    expect(codes).toHaveLength(10);
    const [userId, opts] = vi.mocked(storage.confirmTotpEnrollment).mock
      .calls[0];
    expect(userId).toBe("1");
    expect(opts.acceptedStep).toBe(5);
    expect(opts.upgradePass).toEqual({ idHash: "h", tokenVersion: 0 });
    expect(opts.recoveryHashes).toHaveLength(10);
    expect(opts.recoveryHashes).not.toContain(codes![0]);
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      user.email,
      user.username,
      "enabled_at_sign_in",
    );
  });

  it("signed in (no pass): the ordinary 'enabled' notice, no upgradePass", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(1);
    await confirmFirstEnrollment(user, 5);
    const [, opts] = vi.mocked(storage.confirmTotpEnrollment).mock.calls[0];
    expect(opts).not.toHaveProperty("upgradePass");
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
