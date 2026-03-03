import { describe, it, expect } from "vitest";
import { getEmptyStateDefaults } from "../empty-state-utils";

describe("getEmptyStateDefaults", () => {
  it("returns larger icon for firstTime variant", () => {
    const result = getEmptyStateDefaults("firstTime");
    expect(result.iconSize).toBe(48);
    expect(result.iconOpacity).toBe(0.4);
  });

  it("returns smaller icon for temporary variant", () => {
    const result = getEmptyStateDefaults("temporary");
    expect(result.iconSize).toBe(40);
    expect(result.iconOpacity).toBe(0.25);
  });

  it("returns medium icon for noResults variant", () => {
    const result = getEmptyStateDefaults("noResults");
    expect(result.iconSize).toBe(36);
    expect(result.iconOpacity).toBe(0.3);
  });
});
