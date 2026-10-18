import { describe, it, expect } from "vitest";
import {
  buildSpiceUserMessage,
  chunk,
  parseSpiceReply,
} from "../backfill-recipe-spice-level-utils";

describe("parseSpiceReply", () => {
  it("keeps valid levels for the asked ids only", () => {
    const out = parseSpiceReply(
      JSON.stringify({ levels: { "1": "hot", "2": "mild", "99": "medium" } }),
      [1, 2],
    );
    expect(out.get(1)).toBe("hot");
    expect(out.get(2)).toBe("mild");
    expect(out.has(99)).toBe(false);
  });

  it("leaves null, missing and invalid answers out (never guesses)", () => {
    const out = parseSpiceReply(
      JSON.stringify({ levels: { "1": null, "2": "fiery" } }),
      [1, 2, 3],
    );
    expect(out.size).toBe(0);
  });

  it("returns an empty map for malformed replies", () => {
    expect(parseSpiceReply("not json", [1]).size).toBe(0);
    expect(parseSpiceReply("{}", [1]).size).toBe(0);
    expect(parseSpiceReply('{"levels": 5}', [1]).size).toBe(0);
    expect(parseSpiceReply("null", [1]).size).toBe(0);
  });
});

describe("buildSpiceUserMessage", () => {
  it("lists each recipe by id with its ingredients", () => {
    const msg = buildSpiceUserMessage([
      { id: 7, title: "Chili", ingredients: ["beans", "cayenne"] },
    ]);
    expect(msg).toContain("#7: Chili");
    expect(msg).toContain("beans, cayenne");
  });
});

describe("chunk", () => {
  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
