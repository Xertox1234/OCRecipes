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

    it("redacts a free-text-keyed object when every value has the identical structural shape (regression: server/routes/grocery.ts allergenFlags)", () => {
      // Neither "shrimp" nor "peanut butter" matches any DYNAMIC_KEY_PATTERN, and two
      // entries is far under MAX_STATIC_OBJECT_KEYS -- looksDynamicallyKeyed alone
      // would miss this. hasUniformNonPrimitiveValueShape is what catches it: both
      // values are the identical { allergenId, severity } shape grocery.ts actually
      // rebuilds (server/routes/grocery.ts:238-241).
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

    it("redacts a free-text-keyed object when every value has the identical structural shape (regression: server/services/menu-analysis.ts allergenFlags — real 5-field AllergenMatch shape)", () => {
      // menu-analysis.ts assigns the full AllergenMatch object verbatim
      // (server/services/menu-analysis.ts:200: `allergenFlags[itemName] = m`), which
      // has 5 fields (shared/constants/allergens.ts's AllergenMatch: allergenId,
      // severity, ingredientName, matchedKeyword, isDerived) -- NOT grocery.ts's
      // hand-rebuilt 2-field { allergenId, severity }. This test pins the real
      // menu-analysis.ts shape so it can't pass on a fixture that only matches
      // grocery.ts's differently-shaped allergenFlags.
      const shape = deriveShape({
        allergenFlags: {
          shrimp: {
            allergenId: "shellfish",
            severity: "high",
            ingredientName: "shrimp",
            matchedKeyword: "shrimp",
            isDerived: false,
          },
          "peanut butter": {
            allergenId: "peanut",
            severity: "severe",
            ingredientName: "peanut butter",
            matchedKeyword: "peanut",
            isDerived: true,
          },
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
                  ingredientName: { type: "string" },
                  matchedKeyword: { type: "string" },
                  isDerived: { type: "boolean" },
                },
              },
            },
          },
        },
      });
    });

    it("stores a literal '__proto__' key as a normal field instead of silently dropping it (prototype-pollution guard)", () => {
      // JSON.parse gives an object a REAL own property named "__proto__" ([[DefineOwnProperty]]
      // semantics, not [[Set]]) -- but a naive `keys[key] = value` bracket assignment on a
      // plain-object accumulator invokes Object.prototype's legacy __proto__ SETTER instead
      // of creating an own property, silently vanishing the key rather than storing or
      // redacting it. Both keys here are short, pattern-free, and primitive-valued so
      // neither redaction signal fires and this reaches the plain (non-redacted) key-copy
      // path in deriveShape where the bug lives.
      const shape = deriveShape(
        JSON.parse('{"__proto__": "high", "shrimp": "high"}'),
      ) as Extract<Shape, { type: "object" }>;

      expect(Object.getPrototypeOf(shape.keys)).toBe(Object.prototype);
      expect(Object.keys(shape.keys)).toEqual(["__proto__", "shrimp"]);
      expect(shape).toEqual({
        type: "object",
        keys: {
          ["__proto__"]: { type: "string" }, // computed key -- a literal `"__proto__":` here would hit the same spec special-case
          shrimp: { type: "string" },
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

  describe("forcedDynamicKeys marker (closes the two accepted heuristic gaps for a marked field, see server/lib/dynamic-key-fields.ts)", () => {
    it("redacts a single-entry map at a marked key even though neither heuristic alone would catch it (closes gap 1: fewer than MIN_UNIFORM_MAP_KEYS entries)", () => {
      // Exactly one flagged allergen -- the todo's stated COMMON case for
      // server/routes/grocery.ts and server/services/menu-analysis.ts.
      // "shrimp" matches no DYNAMIC_KEY_PATTERN, and 1 entry is under
      // MIN_UNIFORM_MAP_KEYS, so looksDynamicallyKeyed and
      // hasUniformNonPrimitiveValueShape both miss this on their own (see the
      // negative test below) -- marking "allergenFlags" as forced closes it.
      const shape = deriveShape(
        {
          allergenFlags: {
            shrimp: { allergenId: "shellfish", severity: "high" },
          },
        },
        new Set(["allergenFlags"]),
      );
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("shrimp");
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

    it("does NOT redact that same single-entry map without the marker (documents the residual heuristic-only gap for an unmarked field)", () => {
      const shape = deriveShape({
        allergenFlags: {
          shrimp: { allergenId: "shellfish", severity: "high" },
        },
      });
      // No forcedDynamicKeys passed -- the real key name survives, proving the
      // marker (not some other change) is what closes gap 1 above.
      expect(shape).toEqual({
        type: "object",
        keys: {
          allergenFlags: {
            type: "object",
            keys: {
              shrimp: {
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

    it("redacts an all-primitive-valued map at a marked key at any entry count (closes gap 2: hasUniformNonPrimitiveValueShape only fires on object/array values)", () => {
      const shape = deriveShape(
        { allergenFlags: { shrimp: "high", peanuts: "severe" } },
        new Set(["allergenFlags"]),
      );
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("shrimp");
      expect(serialized).not.toContain("peanuts");
      expect(shape).toEqual({
        type: "object",
        keys: {
          allergenFlags: {
            type: "object",
            keys: { "<dynamic>": { type: "string" } },
          },
        },
      });
    });

    it("does NOT redact that same all-primitive-valued map without the marker (documents the residual heuristic-only gap for an unmarked field)", () => {
      const shape = deriveShape({
        allergenFlags: { shrimp: "high", peanuts: "severe" },
      });
      expect(shape).toEqual({
        type: "object",
        keys: {
          allergenFlags: {
            type: "object",
            keys: {
              peanuts: { type: "string" },
              shrimp: { type: "string" },
            },
          },
        },
      });
    });

    it("leaves an empty map at a marked key as a plain empty object (nothing to redact)", () => {
      const shape = deriveShape(
        { allergenFlags: {} },
        new Set(["allergenFlags"]),
      );
      expect(shape).toEqual({
        type: "object",
        keys: { allergenFlags: { type: "object", keys: {} } },
      });
    });

    it("only force-redacts the marked key, leaving sibling static fields intact", () => {
      const shape = deriveShape(
        {
          restaurantName: "Test Cafe",
          allergenFlags: { shrimp: "high" },
        },
        new Set(["allergenFlags"]),
      );
      expect(shape).toEqual({
        type: "object",
        keys: {
          restaurantName: { type: "string" },
          allergenFlags: {
            type: "object",
            keys: { "<dynamic>": { type: "string" } },
          },
        },
      });
    });

    it("still force-redacts a second marked key nested inside an already-forced key's values (regression: forcedDynamicKeys was previously dropped across this recursion boundary)", () => {
      // otherDynamicField is marked alongside allergenFlags and happens to sit
      // inside one of allergenFlags's own entries -- deriveForcedDynamicShape must
      // forward forcedDynamicKeys into its own recursive deriveShape calls, or this
      // nested single-entry map would silently fall back to the heuristics alone
      // (which miss it -- see the "does NOT redact" negative test above) and leak
      // "onlyone" verbatim.
      const shape = deriveShape(
        {
          allergenFlags: {
            shrimp: { otherDynamicField: { onlyone: "x" } },
          },
        },
        new Set(["allergenFlags", "otherDynamicField"]),
      );
      const serialized = JSON.stringify(shape);
      expect(serialized).not.toContain("shrimp");
      expect(serialized).not.toContain("onlyone");
      // "allergenFlags" and "otherDynamicField" are the marked FIELD names (static,
      // hand-typed) and remain literal keys, same as the top-level test above --
      // it's each field's *value* (shrimp's map, then onlyone's map) that collapses
      // to <dynamic>, one level below each marked key.
      expect(shape).toEqual({
        type: "object",
        keys: {
          allergenFlags: {
            type: "object",
            keys: {
              "<dynamic>": {
                type: "object",
                keys: {
                  otherDynamicField: {
                    type: "object",
                    keys: {
                      "<dynamic>": { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    it("falls back to plain deriveShape for a non-object value at a marked key (e.g. null), rather than crashing or mis-redacting", () => {
      const shape = deriveShape(
        { allergenFlags: null },
        new Set(["allergenFlags"]),
      );
      expect(shape).toEqual({
        type: "object",
        keys: { allergenFlags: { type: "null" } },
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

  describe("one side redacted to <dynamic> (regression: pre-#544 snapshot vs post-#544)", () => {
    it("reports no diff when the redacted value shape matches the real keys' merged shape", () => {
      // base = what deriveShape produced BEFORE PR #544 (real key names stored
      // literally); feature = what it produces AFTER #544 (collapsed to <dynamic>).
      const base = objShape({
        "alice@example.com": { type: "number" },
        "bob@example.com": { type: "number" },
      });
      const feature = objShape({ "<dynamic>": { type: "number" } });

      const diff = diffRouteShapes(base, feature);
      expect(diff).toEqual({ added: [], removed: [], retyped: [] });
      expect(JSON.stringify(diff)).not.toContain("@example.com");
    });

    it("reports a <dynamic> retype (never the real key names) when the value shape actually changed", () => {
      const base = objShape({
        "alice@example.com": { type: "number" },
        "bob@example.com": { type: "number" },
      });
      const feature = objShape({ "<dynamic>": { type: "string" } });

      const diff = diffRouteShapes(base, feature);
      expect(diff).toEqual({ added: [], removed: [], retyped: ["<dynamic>"] });
      expect(JSON.stringify(diff)).not.toContain("@example.com");
    });

    it("holds symmetrically when the feature side has the real keys and base is redacted", () => {
      const base = objShape({ "<dynamic>": { type: "number" } });
      const feature = objShape({
        "alice@example.com": { type: "number" },
        "bob@example.com": { type: "number" },
      });

      const diff = diffRouteShapes(base, feature);
      expect(diff).toEqual({ added: [], removed: [], retyped: [] });
      expect(JSON.stringify(diff)).not.toContain("@example.com");
    });

    it("does NOT intercept a route that genuinely changed from a static object to an unrelated dynamic map (regression: false negative)", () => {
      // width/height are ordinary static fields -- deriveShape would never redact
      // them. A route that actually replaced them with a dynamically-keyed map is a
      // real, meaningful contract change and must still be reported, even though the
      // value types happen to coincide (both "number").
      const base = objShape({
        width: { type: "number" },
        height: { type: "number" },
      });
      const feature = objShape({ "<dynamic>": { type: "number" } });

      expect(diffRouteShapes(base, feature)).toEqual({
        added: ["<dynamic>"],
        removed: ["height", "width"],
        retyped: [],
      });
    });

    it("reports added/removed (not a lossy generic retype) when the non-dynamic side's value type also differs", () => {
      const base = objShape({
        width: { type: "number" },
        height: { type: "number" },
      });
      const feature = objShape({ "<dynamic>": { type: "string" } });

      expect(diffRouteShapes(base, feature)).toEqual({
        added: ["<dynamic>"],
        removed: ["height", "width"],
        retyped: [],
      });
    });

    it("does not misclassify a real static field literally named '<dynamic>' as a redaction placeholder", () => {
      const base = objShape({ "<dynamic>": { type: "boolean" } });
      const feature = objShape({ someFlag: { type: "boolean" } });

      expect(diffRouteShapes(base, feature)).toEqual({
        added: ["someFlag"],
        removed: ["<dynamic>"],
        retyped: [],
      });
    });
  });

  describe("__proto__ key handling (regression: `in` operator walks the prototype chain)", () => {
    it("reports a genuinely removed __proto__ key as removed, not silently dropped", () => {
      const base = objShape(
        Object.fromEntries([
          ["shrimp", { type: "string" }],
          ["__proto__", { type: "string" }],
        ]),
      );
      const feature = objShape({ shrimp: { type: "string" } });

      expect(diffRouteShapes(base, feature)).toEqual({
        added: [],
        removed: ["__proto__"],
        retyped: [],
      });
    });

    it("reports a genuinely added __proto__ key as added, not misclassified as retyped", () => {
      const base = objShape({ shrimp: { type: "string" } });
      const feature = objShape(
        Object.fromEntries([
          ["shrimp", { type: "string" }],
          ["__proto__", { type: "string" }],
        ]),
      );

      expect(diffRouteShapes(base, feature)).toEqual({
        added: ["__proto__"],
        removed: [],
        retyped: [],
      });
    });
  });
});
