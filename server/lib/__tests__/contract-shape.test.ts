import { describe, it, expect } from "vitest";
import { deriveShape, diffRouteShapes, type Shape } from "../contract-shape";

describe("deriveShape", () => {
  it("derives primitive shapes", () => {
    expect(deriveShape("hello")).toEqual({ type: "string" });
    expect(deriveShape(42)).toEqual({ type: "number" });
    expect(deriveShape(true)).toEqual({ type: "boolean" });
    expect(deriveShape(null)).toEqual({ type: "null" });
    expect(deriveShape(undefined)).toEqual({ type: "null" });
  });

  it("derives an object shape with sorted keys, discarding values", () => {
    const shape = deriveShape({ zebra: "z", apple: 1, banana: true });
    expect(shape).toEqual({
      type: "object",
      keys: {
        apple: { type: "number" },
        banana: { type: "boolean" },
        zebra: { type: "string" },
      },
    });
    expect(
      Object.keys((shape as Extract<Shape, { type: "object" }>).keys),
    ).toEqual(["apple", "banana", "zebra"]);
  });

  it("derives nested objects", () => {
    const shape = deriveShape({ user: { id: 1, name: "a" }, count: 3 });
    expect(shape).toEqual({
      type: "object",
      keys: {
        count: { type: "number" },
        user: {
          type: "object",
          keys: { id: { type: "number" }, name: { type: "string" } },
        },
      },
    });
  });

  it("derives an empty array as items: null", () => {
    expect(deriveShape([])).toEqual({ type: "array", items: null });
  });

  it("derives a homogeneous array's element shape once", () => {
    const shape = deriveShape([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(shape).toEqual({
      type: "array",
      items: {
        type: "object",
        keys: { id: { type: "number" }, name: { type: "string" } },
      },
    });
  });

  it("derives nulls inside objects and arrays", () => {
    expect(deriveShape({ a: null })).toEqual({
      type: "object",
      keys: { a: { type: "null" } },
    });
    expect(deriveShape([null, null])).toEqual({
      type: "array",
      items: { type: "null" },
    });
  });

  it("derives a mixed-type array as a deduped, sorted mixed shape", () => {
    const shape = deriveShape([1, "a", 2, "b"]);
    expect(shape).toEqual({
      type: "array",
      items: {
        type: "mixed",
        variants: [{ type: "number" }, { type: "string" }],
      },
    });
  });

  it("dedupes structurally identical mixed-array elements", () => {
    const shape = deriveShape([{ a: 1 }, { a: 2 }, "x"]);
    expect(shape).toEqual({
      type: "array",
      items: {
        type: "mixed",
        variants: [
          { type: "object", keys: { a: { type: "number" } } },
          { type: "string" },
        ],
      },
    });
  });

  it("is deterministic regardless of source key insertion order", () => {
    const a = deriveShape({ b: 1, a: 2 });
    const b = deriveShape({ a: 2, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("diffRouteShapes", () => {
  const objShape = (keys: Record<string, Shape>): Shape => ({
    type: "object",
    keys,
  });

  it("reports no diff for identical shapes", () => {
    const shape = objShape({ id: { type: "number" } });
    expect(diffRouteShapes(shape, shape)).toEqual({
      added: [],
      removed: [],
      retyped: [],
    });
  });

  it("detects an added key", () => {
    const base = objShape({ id: { type: "number" } });
    const feature = objShape({
      id: { type: "number" },
      name: { type: "string" },
    });
    expect(diffRouteShapes(base, feature)).toEqual({
      added: ["name"],
      removed: [],
      retyped: [],
    });
  });

  it("detects a removed key", () => {
    const base = objShape({
      id: { type: "number" },
      name: { type: "string" },
    });
    const feature = objShape({ id: { type: "number" } });
    expect(diffRouteShapes(base, feature)).toEqual({
      added: [],
      removed: ["name"],
      retyped: [],
    });
  });

  it("detects a retyped key", () => {
    const base = objShape({ id: { type: "number" } });
    const feature = objShape({ id: { type: "string" } });
    expect(diffRouteShapes(base, feature)).toEqual({
      added: [],
      removed: [],
      retyped: ["id"],
    });
  });

  it("unwraps a top-level array of objects to compare element keys", () => {
    const base: Shape = {
      type: "array",
      items: objShape({ id: { type: "number" } }),
    };
    const feature: Shape = {
      type: "array",
      items: objShape({
        id: { type: "number" },
        extra: { type: "boolean" },
      }),
    };
    expect(diffRouteShapes(base, feature)).toEqual({
      added: ["extra"],
      removed: [],
      retyped: [],
    });
  });

  it("falls back to a <root> retype for unwrappable shapes that differ", () => {
    const base: Shape = { type: "string" };
    const feature: Shape = { type: "number" };
    expect(diffRouteShapes(base, feature)).toEqual({
      added: [],
      removed: [],
      retyped: ["<root>"],
    });
  });

  it("reports no diff for identical unwrappable shapes", () => {
    const shape: Shape = { type: "string" };
    expect(diffRouteShapes(shape, shape)).toEqual({
      added: [],
      removed: [],
      retyped: [],
    });
  });
});
