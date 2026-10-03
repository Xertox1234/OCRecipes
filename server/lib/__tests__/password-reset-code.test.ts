import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  generateResetCode,
  hashResetCode,
  resetCodeMatches,
  DUMMY_RESET_HASH,
} from "../password-reset-code";

describe("password-reset-code", () => {
  afterEach(() => vi.restoreAllMocks());

  it("generates exactly 6 digits", () => {
    for (let i = 0; i < 200; i++)
      expect(generateResetCode()).toMatch(/^\d{6}$/);
  });

  it("zero-pads small values", () => {
    vi.spyOn(crypto, "randomInt").mockImplementation(() => 42);
    expect(generateResetCode()).toBe("000042");
  });

  it("hash is deterministic per user+code and 64 hex chars", () => {
    const a = hashResetCode("user-1", "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetCode("user-1", "123456")).toBe(a);
  });

  it("the same code hashes differently for different users", () => {
    expect(hashResetCode("user-1", "123456")).not.toBe(
      hashResetCode("user-2", "123456"),
    );
  });

  it("is keyed — not a plain SHA-256 of the input", () => {
    const plain = crypto
      .createHash("sha256")
      .update("user-1:123456")
      .digest("hex");
    expect(hashResetCode("user-1", "123456")).not.toBe(plain);
  });

  it("matches the right code and rejects a wrong one", () => {
    const stored = hashResetCode("user-1", "123456");
    expect(resetCodeMatches("user-1", "123456", stored)).toBe(true);
    expect(resetCodeMatches("user-1", "654321", stored)).toBe(false);
    expect(resetCodeMatches("user-2", "123456", stored)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", () => {
    expect(resetCodeMatches("user-1", "123456", "")).toBe(false);
    expect(resetCodeMatches("user-1", "123456", "zz")).toBe(false);
    expect(resetCodeMatches("user-1", "123456", DUMMY_RESET_HASH)).toBe(false);
  });
});
