import { describe, it, expect } from "vitest";
import { withOpacity } from "../theme";

describe("withOpacity", () => {
  it("appends correct alpha for full opacity", () => {
    expect(withOpacity("#FF6B35", 1)).toBe("#FF6B35ff");
  });

  it("appends correct alpha for zero opacity", () => {
    expect(withOpacity("#FF6B35", 0)).toBe("#FF6B3500");
  });

  it("appends correct alpha for 50% opacity", () => {
    // 0.5 * 255 = 127.5, rounded to 128 = 0x80
    expect(withOpacity("#FF6B35", 0.5)).toBe("#FF6B3580");
  });

  it("appends correct alpha for ~12% opacity", () => {
    // 0.12 * 255 = 30.6, rounded to 31 = 0x1f
    expect(withOpacity("#FFFFFF", 0.12)).toBe("#FFFFFF1f");
  });

  it("pads single-digit hex values with zero", () => {
    // 0.02 * 255 = 5.1, rounded to 5 = 0x05
    expect(withOpacity("#000000", 0.02)).toBe("#00000005");
  });

  it("works with short hex colors", () => {
    expect(withOpacity("#FFF", 1)).toBe("#FFFff");
  });
});
