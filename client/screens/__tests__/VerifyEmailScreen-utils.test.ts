import { describe, it, expect } from "vitest";
import { isValidEmailShape } from "../VerifyEmailScreen-utils";

describe("VerifyEmailScreen-utils", () => {
  it("accepts a well-formed email", () => {
    expect(isValidEmailShape("a@b.com")).toBe(true);
  });
  it("rejects malformed input", () => {
    expect(isValidEmailShape("nope")).toBe(false);
    expect(isValidEmailShape("")).toBe(false);
  });
});
