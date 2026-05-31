// @vitest-environment node
// THROWAWAY: proves required CI checks block a red PR from merging. Delete this branch.
import { describe, it, expect } from "vitest";

describe("CI gate verification (throwaway)", () => {
  it("intentionally fails so a required Tests shard goes red", () => {
    expect(1).toBe(2);
  });
});
