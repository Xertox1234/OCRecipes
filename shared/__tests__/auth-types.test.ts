import { isAccessTokenPayload } from "../types/auth";

describe("Auth Types", () => {
  describe("isAccessTokenPayload", () => {
    it("returns true for valid payload with sub string and tokenVersion", () => {
      const payload = { sub: "user-123", tokenVersion: 0 };
      expect(isAccessTokenPayload(payload)).toBe(true);
    });

    it("returns true for payload with additional JWT claims", () => {
      const payload = {
        sub: "user-123",
        tokenVersion: 0,
        iat: 1234567890,
        exp: 1234567890,
        iss: "nutriscan",
      };
      expect(isAccessTokenPayload(payload)).toBe(true);
    });

    it("returns true for payload with non-zero tokenVersion", () => {
      const payload = { sub: "user-123", tokenVersion: 5 };
      expect(isAccessTokenPayload(payload)).toBe(true);
    });

    it("returns false for string input", () => {
      expect(isAccessTokenPayload("user-123")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAccessTokenPayload(null as any)).toBe(false);
    });

    it("returns false for undefined sub", () => {
      const payload = { foo: "bar", tokenVersion: 0 };
      expect(isAccessTokenPayload(payload)).toBe(false);
    });

    it("returns false when sub is not a string", () => {
      const payload = { sub: 123, tokenVersion: 0 };
      expect(isAccessTokenPayload(payload)).toBe(false);
    });

    it("returns false when sub is null", () => {
      const payload = { sub: null, tokenVersion: 0 };
      expect(isAccessTokenPayload(payload)).toBe(false);
    });

    it("returns false for empty object", () => {
      expect(isAccessTokenPayload({})).toBe(false);
    });

    it("returns false when tokenVersion is missing", () => {
      const payload = { sub: "user-123" };
      expect(isAccessTokenPayload(payload)).toBe(false);
    });

    it("returns false when tokenVersion is not a number", () => {
      const payload = { sub: "user-123", tokenVersion: "0" };
      expect(isAccessTokenPayload(payload)).toBe(false);
    });

    it("returns false when tokenVersion is null", () => {
      const payload = { sub: "user-123", tokenVersion: null };
      expect(isAccessTokenPayload(payload)).toBe(false);
    });

    it("returns true for empty string sub (valid format)", () => {
      // Empty string is technically a string type
      const payload = { sub: "", tokenVersion: 0 };
      expect(isAccessTokenPayload(payload)).toBe(true);
    });
  });
});
