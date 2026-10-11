import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { storage } from "../../storage";
import {
  hashUpgradePassToken,
  needsPasswordUpgrade,
  newUpgradePassToken,
  startUpgradePass,
} from "../upgrade-pass";
import { hashChallengeToken } from "../mfa/mfa-secrets";

vi.mock("../../storage", () => ({
  storage: { createUpgradePass: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("upgrade pass token", () => {
  it("is 32 random bytes, base64url", () => {
    const a = newUpgradePassToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newUpgradePassToken()).not.toBe(a);
  });

  it("is stored as sha256('pw-upgrade:' + token), distinct from a challenge hash", () => {
    const t = newUpgradePassToken();
    expect(hashUpgradePassToken(t)).toBe(
      crypto.createHash("sha256").update(`pw-upgrade:${t}`).digest("hex"),
    );
    expect(hashUpgradePassToken(t)).not.toBe(hashChallengeToken(t));
  });
});

describe("needsPasswordUpgrade", () => {
  it.each([
    ["no two-step, 14 characters", null, "a".repeat(14), true],
    ["no two-step, 15 characters", null, "a".repeat(15), false],
    ["two-step on, 8 characters", new Date(), "a".repeat(8), false],
    [
      "no two-step, 14 emoji (code points, not UTF-16 units)",
      null,
      "😀".repeat(14),
      true,
    ],
    ["no two-step, 15 emoji", null, "😀".repeat(15), false],
  ])("%s → %s", (_label, mfaEnabledAt, pw, want) => {
    expect(needsPasswordUpgrade({ mfaEnabledAt }, pw)).toBe(want);
  });
});

describe("startUpgradePass", () => {
  it("stores only the hash, bound to tokenVersion; 8+ characters allow two-step", async () => {
    const r = await startUpgradePass(
      { id: "u1", tokenVersion: 3 },
      "a".repeat(8),
    );
    expect(r).toEqual({
      status: "upgrade_required",
      pass: expect.any(String),
      canUseTwoStep: true,
    });
    expect(storage.createUpgradePass).toHaveBeenCalledWith({
      idHash: hashUpgradePassToken(r.pass),
      userId: "u1",
      tokenVersion: 3,
      twoStepAllowed: true,
    });
  });

  it("a password under 8 gets a pass that does not allow two-step", async () => {
    const r = await startUpgradePass({ id: "u1", tokenVersion: 0 }, "demo123");
    expect(r.canUseTwoStep).toBe(false);
    expect(
      vi.mocked(storage.createUpgradePass).mock.calls[0][0].twoStepAllowed,
    ).toBe(false);
  });
});
