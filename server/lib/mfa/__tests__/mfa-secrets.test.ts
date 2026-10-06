import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  loadMfaKey,
  MfaUnavailableError,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
  newChallengeToken,
  hashChallengeToken,
  newTotpSecret,
} from "../mfa-secrets";

const KEY = crypto.randomBytes(32);

describe("loadMfaKey", () => {
  it("throws MfaUnavailableError when unset", () => {
    expect(() => loadMfaKey("")).toThrow(MfaUnavailableError);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => loadMfaKey(Buffer.alloc(16).toString("base64"))).toThrow(
      /32 bytes/,
    );
  });

  it("accepts a 32-byte base64 key", () => {
    expect(loadMfaKey(KEY.toString("base64"))).toEqual(KEY);
  });
});

describe("secret encryption", () => {
  it("round-trips, and the ciphertext differs per call", () => {
    const a = encryptMfaSecret("ABCDEF", KEY);
    expect(a).not.toBe(encryptMfaSecret("ABCDEF", KEY));
    expect(decryptMfaSecret(a, KEY)).toBe("ABCDEF");
  });

  it("refuses to decrypt with a different key", () => {
    const blob = encryptMfaSecret("ABCDEF", KEY);
    expect(() => decryptMfaSecret(blob, crypto.randomBytes(32))).toThrow();
  });
});

it("newTotpSecret is 20 random bytes in base32 (32 chars)", () => {
  const s = newTotpSecret();
  expect(s).toMatch(/^[A-Z2-7]{32}$/);
  expect(s).not.toBe(newTotpSecret());
});

describe("recovery codes", () => {
  it("generates 10 distinct XXXX-XXXX-XXXX-XXXX codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    }
  });

  it.each([
    ["abcd-efgh-ijkl-mnop", "ABCDEFGHIJKLMNOP"],
    [" ABCD EFGH IJKL MNOP ", "ABCDEFGHIJKLMNOP"],
    ["ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"],
  ])("normalizes %j", (input, out) => {
    expect(normalizeRecoveryCode(input)).toBe(out);
  });

  it.each(["", "ABCD-EFGH", "ABCD-EFGH-IJKL-MNO1", "ABCD-EFGH-IJKL-MNOP-QRST"])(
    "rejects %j",
    (input) => {
      expect(normalizeRecoveryCode(input)).toBeNull();
    },
  );

  it("every generated code survives normalization", () => {
    for (const c of generateRecoveryCodes()) {
      expect(normalizeRecoveryCode(c)).toBe(c.replace(/-/g, ""));
    }
  });

  it("hash is per-user and a 64-char hex digest", () => {
    const a = hashRecoveryCode("u1", "ABCDEFGHIJKLMNOP");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hashRecoveryCode("u2", "ABCDEFGHIJKLMNOP"));
  });
});

describe("challenge tokens", () => {
  it("are 43-char base64url, distinct, and hash deterministically", () => {
    const t = newChallengeToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t).not.toBe(newChallengeToken());
    expect(hashChallengeToken(t)).toBe(hashChallengeToken(t));
    expect(hashChallengeToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
