import { describe, it, expect } from "vitest";
import { clusterByPairs } from "../lib/dedup";

describe("clusterByPairs", () => {
  it("groups transitively connected pairs into one cluster", () => {
    const clusters = clusterByPairs([
      { a: "x", b: "y", sim: 0.95 },
      { a: "y", b: "z", sim: 0.91 },
      { a: "p", b: "q", sim: 0.9 },
    ]);
    expect(clusters).toContainEqual(["x", "y", "z"]);
    expect(clusters).toContainEqual(["p", "q"]);
    expect(clusters).toHaveLength(2);
  });
  it("returns no clusters when there are no pairs", () => {
    expect(clusterByPairs([])).toEqual([]);
  });
  it("omits singletons (only size>=2 clusters)", () => {
    const clusters = clusterByPairs([{ a: "a", b: "b", sim: 0.9 }]);
    expect(clusters).toEqual([["a", "b"]]);
  });
});
