import { describe, it, expect } from "vitest";
import { hasValidUri } from "../FallbackImage-utils";

describe("hasValidUri", () => {
  it("returns true for a valid URI string", () => {
    expect(hasValidUri({ uri: "https://example.com/image.jpg" })).toBe(true);
  });

  it("returns true for a non-HTTP URI string", () => {
    expect(hasValidUri({ uri: "file:///path/to/image.png" })).toBe(true);
  });

  it("returns false for null source", () => {
    expect(hasValidUri(null)).toBe(false);
  });

  it("returns false for undefined source", () => {
    expect(hasValidUri(undefined)).toBe(false);
  });

  it("returns false for null URI", () => {
    expect(hasValidUri({ uri: null })).toBe(false);
  });

  it("returns false for undefined URI", () => {
    expect(hasValidUri({ uri: undefined })).toBe(false);
  });

  it("returns false for empty string URI", () => {
    expect(hasValidUri({ uri: "" })).toBe(false);
  });
});
