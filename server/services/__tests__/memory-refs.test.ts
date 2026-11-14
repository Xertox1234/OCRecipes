import { describe, it, expect } from "vitest";
import { filterMemoryRefs } from "../memory-refs";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const chips: CoachBlock = { type: "quick_replies", options: [] };

describe("filterMemoryRefs", () => {
  it("keeps only confirmed ids, deduped", () => {
    const out = filterMemoryRefs(
      [chips, { type: "memory_refs", ids: [5, 99, 5, 7] }],
      new Set([5, 7]),
    );
    expect(out).toEqual([chips, { type: "memory_refs", ids: [5, 7] }]);
  });

  it("drops the block when no ids survive", () => {
    expect(
      filterMemoryRefs([{ type: "memory_refs", ids: [99] }], new Set([5])),
    ).toEqual([]);
  });

  it("leaves other blocks untouched", () => {
    expect(filterMemoryRefs([chips], new Set())).toEqual([chips]);
  });
});
