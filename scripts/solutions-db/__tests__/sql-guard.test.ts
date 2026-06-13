import { describe, it, expect } from "vitest";
import { isReadOnlyQuery } from "../lib/sql-guard";

describe("isReadOnlyQuery", () => {
  it("accepts a plain SELECT", () => {
    expect(
      isReadOnlyQuery(
        "SELECT * FROM solutions WHERE category = 'logic-errors'",
      ),
    ).toBe(true);
  });
  it("accepts a leading CTE", () => {
    expect(isReadOnlyQuery("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(true);
  });
  it("accepts a trailing semicolon", () => {
    expect(isReadOnlyQuery("SELECT 1;")).toBe(true);
  });
  it("does not flag column names containing keyword substrings", () => {
    expect(isReadOnlyQuery("SELECT created, last_updated FROM solutions")).toBe(
      true,
    );
  });
  it("rejects writes", () => {
    for (const q of [
      "INSERT INTO solutions DEFAULT VALUES",
      "UPDATE solutions SET title='x'",
      "DELETE FROM solutions",
      "DROP TABLE solutions",
      "TRUNCATE solutions",
      "ALTER TABLE solutions ADD COLUMN z int",
    ])
      expect(isReadOnlyQuery(q)).toBe(false);
  });
  it("rejects multiple statements", () => {
    expect(isReadOnlyQuery("SELECT 1; DROP TABLE solutions")).toBe(false);
  });
  it("rejects a data-modifying CTE", () => {
    expect(
      isReadOnlyQuery(
        "WITH x AS (DELETE FROM solutions RETURNING *) SELECT * FROM x",
      ),
    ).toBe(false);
  });
  it("is case-insensitive (accepts lowercase select)", () => {
    expect(isReadOnlyQuery("select * from solutions")).toBe(true);
  });
});
