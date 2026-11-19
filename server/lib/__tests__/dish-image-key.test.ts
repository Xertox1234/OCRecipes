import { describe, it, expect } from "vitest";
import { dishImageKey } from "../dish-image-key";

describe("dishImageKey", () => {
  it("gives the same key for case, spacing and punctuation variants", () => {
    const key = dishImageKey("Bacon and Eggs");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(dishImageKey("  bacon   and eggs! ")).toBe(key);
  });

  it("gives different keys for different dishes", () => {
    expect(dishImageKey("bacon and eggs")).not.toBe(
      dishImageKey("bacon & eggs"),
    );
  });

  it("returns null when nothing is left", () => {
    expect(dishImageKey("!!! ")).toBeNull();
    expect(dishImageKey("")).toBeNull();
  });
});
