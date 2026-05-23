import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "../db-errors";

describe("isUniqueViolation", () => {
  it("detects a top-level pg unique violation (pre-drizzle-0.44 shape)", () => {
    expect(
      isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" })),
    ).toBe(true);
  });

  it("detects a wrapped DrizzleQueryError whose cause carries the 23505 code", () => {
    // drizzle-orm 0.44+ wraps the driver error: message becomes "Failed query: ..."
    // and the original pg error (with .code) moves to .cause.
    const wrapped = Object.assign(new Error("Failed query: insert into ..."), {
      cause: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("detects a plain object with the code on cause", () => {
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("returns false for a different pg error code (e.g. 23503 FK violation)", () => {
    expect(
      isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" })),
    ).toBe(false);
    expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
  });

  it("returns false for errors without a code or cause", () => {
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });

  it("returns false for nullish and primitive values", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
