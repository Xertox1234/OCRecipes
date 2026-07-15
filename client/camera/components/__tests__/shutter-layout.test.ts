import { describe, it, expect } from "vitest";
import { getShutterTopInset } from "../shutter-layout";

describe("getShutterTopInset", () => {
  it("derives the shutter's top edge from insetsBottom (16 controls padding + 72 shutter height)", () => {
    expect(getShutterTopInset(0)).toBe(88);
    expect(getShutterTopInset(34)).toBe(122);
  });
});
