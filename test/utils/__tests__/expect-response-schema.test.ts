import { describe, it, expect } from "vitest";
import { z } from "zod";
import { expectResponseToMatch } from "../expect-response-schema";

const schema = z.object({
  items: z.array(z.object({ calories: z.number() })),
  total: z.number(),
});

describe("expectResponseToMatch", () => {
  it("returns the parsed data when the body matches", () => {
    const body = { items: [{ calories: 10 }], total: 1 };
    expect(expectResponseToMatch(body, schema)).toEqual(body);
  });

  // The helper must hand back Zod's OUTPUT, not the input it was given: a
  // downstream anchor that reads the return value would otherwise assert
  // against unparsed data with nothing red. A schema with a default makes
  // the two observably different.
  it("returns the coerced output, not the input body", () => {
    const withDefault = z.object({ n: z.number().default(7) });
    expect(expectResponseToMatch({}, withDefault)).toEqual({ n: 7 });
  });

  // Floor rule: the helper must be observed red on a bad body, and the
  // failure must name the exact path so a contract break reads like one.
  it("throws naming the path of a mistyped nested field", () => {
    const body = { items: [{ calories: "10" }], total: 1 };
    expect(() => expectResponseToMatch(body, schema)).toThrowError(
      /Response body does not match schema[\s\S]*items\[0\]\.calories: /,
    );
  });

  it("throws naming a missing required top-level field", () => {
    const body = { items: [] };
    expect(() => expectResponseToMatch(body, schema)).toThrowError(/total: /);
  });

  it("renders root-level issues as (root)", () => {
    expect(() => expectResponseToMatch("not an object", schema)).toThrowError(
      /\(root\): /,
    );
  });
});
