import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encryptToken, decryptToken, loadIdentityKey } from "../token-crypto";

const key = crypto.randomBytes(32);

describe("token-crypto", () => {
  it("round-trips", () => {
    const blob = encryptToken("r.apple-refresh", key);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("r.apple-refresh");
    expect(decryptToken(blob, key)).toBe("r.apple-refresh");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptToken("same", key)).not.toBe(encryptToken("same", key));
  });

  it("rejects a tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptToken("secret", key).split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() =>
      decryptToken([v, iv, tag, flipped.toString("base64")].join(":"), key),
    ).toThrow();
  });

  it("rejects a truncated auth tag", () => {
    const [v, iv, tag, ct] = encryptToken("secret", key).split(":");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    expect(() => decryptToken([v, iv, short, ct].join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const blob = encryptToken("secret", key);
    expect(() => decryptToken(blob, crypto.randomBytes(32))).toThrow();
  });

  it("loadIdentityKey requires exactly 32 bytes", () => {
    expect(() => loadIdentityKey("")).toThrow(/IDENTITY_TOKEN_ENC_KEY/);
    expect(() =>
      loadIdentityKey(crypto.randomBytes(16).toString("base64")),
    ).toThrow(/32 bytes/);
    expect(loadIdentityKey(key.toString("base64"))).toHaveLength(32);
  });
});
