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

  describe("dynamic-key redaction", () => {
    it("redacts an object keyed by a user email instead of storing it literally", () => {
      const shape = deriveShape({
        "alice@example.com": { calories: 500, protein: 30 },
      });
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("alice@example.com");
      expect(serialized).not.toContain("@");
      expect(shape).toEqual({
        type: "object",
        keys: {
          "<dynamic>": {
            type: "object",
            keys: { calories: { type: "number" }, protein: { type: "number" } },
          },
        },
      });
    });

    it("redacts an object keyed by a UUID", () => {
      const shape = deriveShape({
        "550e8400-e29b-41d4-a716-446655440000": { name: "x" },
      });
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("550e8400");
      expect(shape).toEqual({
        type: "object",
        keys: {
          "<dynamic>": { type: "object", keys: { name: { type: "string" } } },
        },
      });
    });

    it("redacts an object with more keys than the static-object threshold", () => {
      const manyKeys: Record<string, number> = {};
      for (let i = 0; i < 60; i++) {
        manyKeys[`ingredient-${i}`] = i;
      }
      const shape = deriveShape(manyKeys);
      expect(shape).toEqual({
        type: "object",
        keys: { "<dynamic>": { type: "number" } },
      });
    });

    it("keeps literal keys at exactly the static-object threshold, redacts one key above it", () => {
      const makeKeys = (count: number): Record<string, number> => {
        const keys: Record<string, number> = {};
        for (let i = 0; i < count; i++) keys[`ingredient-${i}`] = i;
        return keys;
      };

      const atThreshold = deriveShape(makeKeys(50)) as Extract<
        Shape,
        { type: "object" }
      >;
      expect(Object.keys(atThreshold.keys)).not.toContain("<dynamic>");
      expect(Object.keys(atThreshold.keys)).toHaveLength(50);

      const overThreshold = deriveShape(makeKeys(51)) as Extract<
        Shape,
        { type: "object" }
      >;
      expect(Object.keys(overThreshold.keys)).toEqual(["<dynamic>"]);
    });

    it("redacts a free-text-keyed object when every value has the identical structural shape (regression: server/routes/grocery.ts, server/services/menu-analysis.ts allergenFlags)", () => {
      // Neither "shrimp" nor "peanut butter" matches any DYNAMIC_KEY_PATTERN, and two
      // entries is far under MAX_STATIC_OBJECT_KEYS -- looksDynamicallyKeyed alone
      // would miss this. hasUniformNonPrimitiveValueShape is what catches it: both
      // values are the identical { allergenId, severity } shape.
      const shape = deriveShape({
        allergenFlags: {
          shrimp: { allergenId: "shellfish", severity: "high" },
          "peanut butter": { allergenId: "peanut", severity: "severe" },
        },
      });
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("shrimp");
      expect(serialized).not.toContain("peanut butter");
      expect(shape).toEqual({
        type: "object",
        keys: {
          allergenFlags: {
            type: "object",
            keys: {
              "<dynamic>": {
                type: "object",
                keys: {
                  allergenId: { type: "string" },
                  severity: { type: "string" },
                },
              },
            },
          },
        },
      });
    });

    it("does not redact two static fields that happen to share a primitive type", () => {
      const shape = deriveShape({ width: 100, height: 50 });
      expect(shape).toEqual({
        type: "object",
        keys: { height: { type: "number" }, width: { type: "number" } },
      });
    });

    it("does not redact two static object-typed fields with different internal shapes", () => {
      const shape = deriveShape({
        user: { id: 1, name: "a" },
        address: { street: "x", city: "y" },
      });
      expect(shape).toEqual({
        type: "object",
        keys: {
          address: {
            type: "object",
            keys: { city: { type: "string" }, street: { type: "string" } },
          },
          user: {
            type: "object",
            keys: { id: { type: "number" }, name: { type: "string" } },
          },
        },
      });
    });

    it("DOES redact two static array-typed fields that coincidentally share the same element shape (documented, intentional over-redaction)", () => {
      // hasUniformNonPrimitiveValueShape only checks structural identity, not field
      // semantics -- "tags" and "categories" are unrelated static fields, but both
      // happen to be string[], so they collapse to <dynamic> just like a real
      // dynamically-keyed map would. This trades field-level diff granularity for
      // never missing a real leak (fail-safe direction) -- see the
      // hasUniformNonPrimitiveValueShape doc comment.
      const shape = deriveShape({ tags: ["a"], categories: ["b"] });
      expect(shape).toEqual({
        type: "object",
        keys: { "<dynamic>": { type: "array", items: { type: "string" } } },
      });
    });

    it("redacts the whole object when only one of several keys looks dynamic (safe over-redaction)", () => {
      const shape = deriveShape({
        status: "ok",
        "bob@example.com": { calories: 100 },
      });
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("bob@example.com");
      expect(
        Object.keys((shape as Extract<Shape, { type: "object" }>).keys),
      ).toEqual(["<dynamic>"]);
    });

    it("redacts a dynamically-keyed object nested inside a static object", () => {
      const shape = deriveShape({
        data: { "carol@example.com": { calories: 200 } },
      });
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("carol@example.com");
      expect(shape).toEqual({
        type: "object",
        keys: {
          data: {
            type: "object",
            keys: {
              "<dynamic>": {
                type: "object",
                keys: { calories: { type: "number" } },
              },
            },
          },
        },
      });
    });

    it("redacts a dynamically-keyed object wrapped in an array", () => {
      const shape = deriveShape([{ "dan@example.com": { calories: 300 } }]);
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("dan@example.com");
      expect(shape).toEqual({
        type: "array",
        items: {
          type: "object",
          keys: {
            "<dynamic>": {
              type: "object",
              keys: { calories: { type: "number" } },
            },
          },
        },
      });
    });

    it("does not redact an ordinary small static object (no regression)", () => {
      const shape = deriveShape({ id: 1, name: "a", email: "contact@app.com" });
      // "email" is a static field NAME here, not a dynamic key -- only the field's
      // *value* would ever be an actual address, and values are always discarded.
      expect(shape).toEqual({
        type: "object",
        keys: {
          email: { type: "string" },
          id: { type: "number" },
          name: { type: "string" },
        },
      });
    });
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
