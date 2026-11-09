import { describe, it, expect } from "vitest";
import { utf8ByteLength } from "../recipe";

const encoded = (s: string) => new TextEncoder().encode(s).length;

describe("utf8ByteLength", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["é", 2],
    ["一", 3],
    ["😀", 4], // a valid surrogate pair
  ])("%j is %i bytes", (s, n) => {
    expect(utf8ByteLength(s)).toBe(n);
    expect(encoded(s)).toBe(n);
  });

  it("counts a lone high surrogate as U+FFFD without eating the next unit", () => {
    expect(utf8ByteLength("\uD800一")).toBe(6);
    expect(utf8ByteLength("\uD800")).toBe(3);
    expect(utf8ByteLength("\uD800a")).toBe(4);
  });

  it("counts a lone low surrogate as U+FFFD", () => {
    expect(utf8ByteLength("\uDC00")).toBe(3);
    expect(utf8ByteLength("a\uDC00\uD800")).toBe(7);
  });

  it("matches TextEncoder on mixed input", () => {
    const s = "a\uD800😀\uDC00é一\uD800";
    expect(utf8ByteLength(s)).toBe(encoded(s));
  });
});
