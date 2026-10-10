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
  newTrustKey,
  hashTrustKey,
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
});

it("encrypts and decrypts a secret; ciphertext differs per call", () => {
  const a = encryptMfaSecret("ABCDEF", KEY);
  expect(a).not.toBe(encryptMfaSecret("ABCDEF", KEY));
  expect(decryptMfaSecret(a, KEY)).toBe("ABCDEF");
});

it("newTotpSecret is 20 random bytes in base32 (32 chars)", () => {
  expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
});

describe("recovery codes", () => {
  it("generates 10 distinct XXXX-XXXX-XXXX-XXXX codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
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
    (input) => expect(normalizeRecoveryCode(input)).toBeNull(),
  );
  it("hash is per-user", () => {
    expect(hashRecoveryCode("u1", "ABCDEFGHIJKLMNOP")).not.toBe(
      hashRecoveryCode("u2", "ABCDEFGHIJKLMNOP"),
    );
  });
});

it("challenge tokens are 43-char base64url and hash deterministically", () => {
  const t = newChallengeToken();
  expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashChallengeToken(t)).toBe(hashChallengeToken(t));
  expect(hashChallengeToken(t)).toMatch(/^[0-9a-f]{64}$/);
});

it("trust keys are 43-char base64url; hashes are labelled per purpose", () => {
  const k = newTrustKey();
  expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashTrustKey(k)).toMatch(/^[0-9a-f]{64}$/);
  // Same input, different purpose → different hash (domain separation).
  expect(hashTrustKey(k)).not.toBe(hashChallengeToken(k));
});
