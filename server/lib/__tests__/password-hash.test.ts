import { describe, it, expect } from "vitest";
import bcrypt from "bcrypt";
import {
  hashPassword,
  isLegacyHash,
  PASSWORD_HASH_PREFIX,
} from "../password-hash";
import { passwordMatches, DUMMY_PASSWORD_HASH } from "../password-check";

describe("hashPassword / passwordMatches", () => {
  it("round-trips and carries the version prefix", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith(PASSWORD_HASH_PREFIX)).toBe(true);
    expect(isLegacyHash(h)).toBe(false);
    expect(await passwordMatches("correct horse battery", h)).toBe(true);
    expect(await passwordMatches("correct horse batterz", h)).toBe(false);
  });

  it("every character counts past 72 bytes (bcrypt alone would truncate)", async () => {
    const base = "a".repeat(80);
    const h = await hashPassword(base);
    expect(Buffer.byteLength(base, "utf8") > 72).toBe(true);
    expect(await passwordMatches(base.slice(0, 79) + "b", h)).toBe(false);
  });

  it("a multibyte character straddling byte 72 still round-trips", async () => {
    const pw = "a".repeat(71) + "\u00e9" + "tail";
    const h = await hashPassword(pw);
    expect(await passwordMatches(pw, h)).toBe(true);
    expect(await passwordMatches("a".repeat(71) + "\u00e9" + "tall", h)).toBe(
      false,
    );
  });

  it("decomposed and composed é verify as the same password", async () => {
    const h = await hashPassword("caf\u00e9 au lait please");
    expect(await passwordMatches("cafe\u0301 au lait please", h)).toBe(true);
  });

  it("legacy bcrypt hashes still verify", async () => {
    const legacy = await bcrypt.hash("old-password-1", 4);
    expect(isLegacyHash(legacy)).toBe(true);
    expect(await passwordMatches("old-password-1", legacy)).toBe(true);
  });

  it("the dummy hash stays cost 12, the same as new hashes", async () => {
    const h = await hashPassword("x".repeat(20));
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(12);
    expect(bcrypt.getRounds(h.slice(PASSWORD_HASH_PREFIX.length))).toBe(12);
  });
});
