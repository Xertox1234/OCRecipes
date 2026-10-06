import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  hotp,
  timeStep,
  matchTotp,
  otpauthUrl,
} from "../totp";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("base32", () => {
  it("encodes the RFC secret", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("round-trips arbitrary bytes, case- and space-insensitive on decode", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    const enc = base32Encode(buf);
    expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(
      buf,
    );
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("ABC1")).toThrow("Invalid base32");
  });
});

// RFC 6238 Appendix B, SHA-1. The 6-digit code is the last 6 digits of the
// published 8-digit value because 10^6 divides 10^8.
describe("RFC 6238 vectors (SHA-1, 6 digits)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(hotp(RFC_SECRET, timeStep(t * 1000))).toBe(code);
  });
});

describe("matchTotp", () => {
  const now = 1111111111 * 1000;
  const step = timeStep(now);

  it("accepts the current step and one either side, returning the matched step", () => {
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(
      step - 1,
    );
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(
      step + 1,
    );
  });

  it("rejects two steps away, wrong length, and non-digits", () => {
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12a456", now)).toBeNull();
  });
});

describe("otpauthUrl", () => {
  it("builds an authenticator link with an encoded label", () => {
    expect(otpauthUrl("ABC", "chef name")).toBe(
      "otpauth://totp/OCRecipes:chef%20name?secret=ABC&issuer=OCRecipes&algorithm=SHA1&digits=6&period=30",
    );
  });
});
