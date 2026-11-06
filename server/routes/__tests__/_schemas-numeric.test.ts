import { describe, it, expect } from "vitest";
import {
  numericStringField,
  nullableNumericStringField,
  boundedNumericStringField,
} from "../_schemas";

// These fields feed decimal columns whose `>= 0` CHECKs let a NaN through
// (Postgres sorts NaN above every number), and one NaN row turns a whole
// day's SUM into NaN. They must accept only finite, non-negative numbers.
describe("numericStringField", () => {
  it("passes numbers and numeric strings through as strings", () => {
    expect(numericStringField.parse(12.5)).toBe("12.5");
    expect(numericStringField.parse("200")).toBe("200");
    expect(numericStringField.parse(0)).toBe("0");
  });

  it("treats absent and empty as absent", () => {
    expect(numericStringField.parse(undefined)).toBeUndefined();
    expect(numericStringField.parse("")).toBeUndefined();
  });

  it.each(["NaN", "abc", "-5", "Infinity", "1e400", -1])(
    "rejects %s",
    (value) => {
      expect(numericStringField.safeParse(value).success).toBe(false);
    },
  );

  // z.coerce.number() is Number(v): it would turn these into "0"/"1"/"5"
  // and store a silent 0 kcal. Only numbers and numeric strings count.
  it.each([null, true, [], [5], {}, "0x10", "2 cups", "1/2"])(
    "rejects non-numeric input %o instead of coercing it",
    (value) => {
      expect(numericStringField.safeParse(value).success).toBe(false);
    },
  );

  it("treats a whitespace-only string as absent, not 0", () => {
    expect(numericStringField.parse("  ")).toBeUndefined();
  });

  it("trims a padded numeric string", () => {
    expect(numericStringField.parse(" 12.5 ")).toBe("12.5");
  });

  it("rejects a value too big for a decimal(10,2) column", () => {
    expect(numericStringField.safeParse(100_000_000).success).toBe(false);
  });
});

describe("nullableNumericStringField", () => {
  it("returns null when absent, null or empty", () => {
    expect(nullableNumericStringField.parse(undefined)).toBeNull();
    expect(nullableNumericStringField.parse(null)).toBeNull();
    expect(nullableNumericStringField.parse("")).toBeNull();
  });

  it("passes a valid number through as a string", () => {
    expect(nullableNumericStringField.parse("3")).toBe("3");
  });

  it.each(["NaN", "x", "-0.5", "Infinity", true, []])("rejects %o", (value) => {
    expect(nullableNumericStringField.safeParse(value).success).toBe(false);
  });

  it("treats a whitespace-only string as null, not 0", () => {
    expect(nullableNumericStringField.parse("  ")).toBeNull();
  });
});

describe("boundedNumericStringField", () => {
  it("rejects a value over its cap and keeps one at it", () => {
    const calories = boundedNumericStringField(50_000);
    expect(calories.safeParse(50_001).success).toBe(false);
    expect(calories.parse(50_000)).toBe("50000");
  });

  it("is nullable when asked", () => {
    const perServing = boundedNumericStringField(5_000, { nullable: true });
    expect(perServing.parse(undefined)).toBeNull();
    expect(perServing.safeParse(5_001).success).toBe(false);
  });
});
