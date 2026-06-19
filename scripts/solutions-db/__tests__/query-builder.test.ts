import { describe, it, expect } from "vitest";
import {
  buildSearchQuery,
  buildDuplicatesCategoryClause,
  buildRecentQuery,
} from "../lib/query-builder";

// Hand-written expectations only — never re-derive the running `$n` index with
// a loop, or the test would mirror the function and be blind to its own bugs.
const VEC = "[0.1,0.2]";

describe("buildSearchQuery", () => {
  it("reuses $1 for the vector in SELECT and ORDER BY", () => {
    const { sql, params } = buildSearchQuery(VEC, {}, 8);
    // $1 appears in both the similarity SELECT and the ORDER BY.
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS similarity");
    expect(sql).toContain("ORDER BY embedding <=> $1::vector");
    expect(params[0]).toBe(VEC);
  });

  it("with no filters puts k at $2 (base clause is the only WHERE term)", () => {
    const { sql, params } = buildSearchQuery(VEC, {}, 8);
    expect(sql).toContain("WHERE embedding IS NOT NULL");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([VEC, 8]);
  });

  it("indexes a single `track` filter at $2 and k at $3", () => {
    const { sql, params } = buildSearchQuery(VEC, { track: "bug" }, 5);
    expect(sql).toContain("track = $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual([VEC, "bug", 5]);
  });

  it("indexes a single `category` filter at $2 and k at $3", () => {
    const { sql, params } = buildSearchQuery(
      VEC,
      { category: "logic-errors" },
      5,
    );
    expect(sql).toContain("category = $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual([VEC, "logic-errors", 5]);
  });

  it("indexes a single `module` filter at $2 and k at $3", () => {
    const { sql, params } = buildSearchQuery(VEC, { module: "server" }, 5);
    expect(sql).toContain("module = $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual([VEC, "server", 5]);
  });

  it("indexes a single `severity` filter at $2 and k at $3", () => {
    const { sql, params } = buildSearchQuery(VEC, { severity: "high" }, 5);
    expect(sql).toContain("severity = $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual([VEC, "high", 5]);
  });

  it("uses array-containment `tags && $n` for the tags filter", () => {
    const { sql, params } = buildSearchQuery(VEC, { tags: ["vitest"] }, 5);
    expect(sql).toContain("tags && $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual([VEC, ["vitest"], 5]);
  });

  it("omits the tags clause for an empty tags array (no $n consumed)", () => {
    const { sql, params } = buildSearchQuery(VEC, { tags: [] }, 8);
    expect(sql).not.toContain("tags &&");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([VEC, 8]);
  });

  it("assigns contiguous indices for all filters combined in fixed order", () => {
    const { sql, params } = buildSearchQuery(
      VEC,
      {
        track: "bug",
        category: "logic-errors",
        module: "server",
        severity: "high",
        tags: ["vitest", "ci"],
      },
      8,
    );
    // Fixed order: track $2, category $3, module $4, severity $5, tags $6, k $7.
    expect(sql).toContain("track = $2");
    expect(sql).toContain("category = $3");
    expect(sql).toContain("module = $4");
    expect(sql).toContain("severity = $5");
    expect(sql).toContain("tags && $6");
    expect(sql).toContain("LIMIT $7");
    expect(sql).toContain(
      "WHERE embedding IS NOT NULL AND track = $2 AND category = $3 AND module = $4 AND severity = $5 AND tags && $6",
    );
    expect(params).toEqual([
      VEC,
      "bug",
      "logic-errors",
      "server",
      "high",
      ["vitest", "ci"],
      8,
    ]);
  });

  it("omits clauses for absent filters and keeps remaining indices contiguous", () => {
    // Only category + tags present: category $2, tags $3, k $4.
    const { sql, params } = buildSearchQuery(
      VEC,
      { category: "conventions", tags: ["lazy-init"] },
      8,
    );
    expect(sql).not.toContain("track =");
    expect(sql).not.toContain("module =");
    expect(sql).not.toContain("severity =");
    expect(sql).toContain("category = $2");
    expect(sql).toContain("tags && $3");
    expect(sql).toContain("LIMIT $4");
    expect(params).toEqual([VEC, "conventions", ["lazy-init"], 8]);
  });
});

describe("buildDuplicatesCategoryClause", () => {
  it("returns an empty clause and no params when category is omitted", () => {
    expect(buildDuplicatesCategoryClause(undefined)).toEqual({
      catClause: "",
      params: [],
    });
  });

  it("references $2 twice and binds the category once when provided", () => {
    const { catClause, params } = buildDuplicatesCategoryClause("logic-errors");
    expect(catClause).toBe("AND a.category = $2 AND b.category = $2");
    expect(params).toEqual(["logic-errors"]);
  });
});

describe("buildRecentQuery", () => {
  it("no filters: orders by created DESC and puts k at $1", () => {
    const { sql, params } = buildRecentQuery({}, 20);
    expect(sql).toContain("ORDER BY created DESC");
    expect(sql).toContain("ORDER BY created DESC, source_path DESC");
    expect(sql).not.toContain("WHERE");
    expect(sql).toContain("LIMIT $1");
    expect(params).toEqual([20]);
  });

  it("days filter goes to $1 (interval-from-today) and k to $2", () => {
    const { sql, params } = buildRecentQuery({ days: 14 }, 10);
    expect(sql).toContain("created >= (CURRENT_DATE - $1::int)");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([14, 10]);
  });

  it("track filter goes to $1 and k to $2", () => {
    const { sql, params } = buildRecentQuery({ track: "bug" }, 5);
    expect(sql).toContain("track = $1");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual(["bug", 5]);
  });

  it("days + track + category index in order ($1,$2,$3) with k at $4", () => {
    const { sql, params } = buildRecentQuery(
      { days: 30, track: "bug", category: "runtime-errors" },
      8,
    );
    expect(sql).toContain("created >= (CURRENT_DATE - $1::int)");
    expect(sql).toContain("track = $2");
    expect(sql).toContain("category = $3");
    expect(sql).toContain("LIMIT $4");
    expect(params).toEqual([30, "bug", "runtime-errors", 8]);
  });
});
