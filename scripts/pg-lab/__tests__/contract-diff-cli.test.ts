import { describe, it, expect } from "vitest";
import {
  buildDiffReport,
  formatReport,
  type SnapshotRow,
} from "../contract-diff-cli";
import type { Shape } from "../../../server/lib/contract-shape";

const objShape = (keys: Record<string, Shape>): Shape => ({
  type: "object",
  keys,
});

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    route_pattern: "/api/foo",
    method: "GET",
    status: 200,
    shape: objShape({ id: { type: "number" } }),
    sample_count: 1,
    ...overrides,
  };
}

describe("buildDiffReport", () => {
  it("reports no differences for identical rows on both branches", () => {
    const shared = row();
    const report = buildDiffReport({ base: [shared], feature: [shared] });
    expect(report).toMatchObject({
      addedRoutes: [],
      removedRoutes: [],
      keyDiffs: [],
      hasDifferences: false,
    });
  });

  it("reports an added route present only on feature", () => {
    const report = buildDiffReport({
      base: [],
      feature: [
        row({ route_pattern: "/api/new-thing", method: "POST", status: 201 }),
      ],
    });
    expect(report.addedRoutes).toEqual(["POST /api/new-thing [201]"]);
    expect(report.removedRoutes).toEqual([]);
    expect(report.hasDifferences).toBe(true);
  });

  it("reports a removed route present only on base", () => {
    const report = buildDiffReport({
      base: [
        row({ route_pattern: "/api/gone", method: "DELETE", status: 200 }),
      ],
      feature: [],
    });
    expect(report.removedRoutes).toEqual(["DELETE /api/gone [200]"]);
    expect(report.addedRoutes).toEqual([]);
    expect(report.hasDifferences).toBe(true);
  });

  it("reports added/removed/retyped keys for a route present on both branches", () => {
    const base = row({
      shape: objShape({
        count: { type: "number" },
        label: { type: "string" },
      }),
    });
    const feature = row({
      shape: objShape({
        count: { type: "string" },
        extra: { type: "boolean" },
        label: { type: "string" },
      }),
    });
    const report = buildDiffReport({ base: [base], feature: [feature] });
    expect(report.addedRoutes).toEqual([]);
    expect(report.removedRoutes).toEqual([]);
    expect(report.keyDiffs).toEqual([
      {
        route: "GET /api/foo [200]",
        added: ["extra"],
        removed: [],
        retyped: ["count"],
      },
    ]);
    expect(report.hasDifferences).toBe(true);
  });

  it("does not silently drop a route whose status code changed between branches (regression)", () => {
    // Same route_pattern + method on both branches, but base only ever recorded a 200
    // and feature only ever recorded a 201 with an extra field -- this must NOT be
    // reported as "no differences" just because a status-agnostic key would treat the
    // route as present on both sides.
    const base = row({
      status: 200,
      shape: objShape({ id: { type: "number" } }),
    });
    const feature = row({
      status: 201,
      shape: objShape({ id: { type: "number" }, extra: { type: "boolean" } }),
    });
    const report = buildDiffReport({ base: [base], feature: [feature] });
    expect(report.addedRoutes).toEqual(["GET /api/foo [201]"]);
    expect(report.removedRoutes).toEqual(["GET /api/foo [200]"]);
    expect(report.hasDifferences).toBe(true);
  });

  it("sums sample_count across rows per branch", () => {
    const report = buildDiffReport({
      base: [
        row({ sample_count: 3 }),
        row({ route_pattern: "/api/bar", sample_count: 4 }),
      ],
      feature: [row({ sample_count: 5 })],
    });
    expect(report.baseSampleCount).toBe(7);
    expect(report.featureSampleCount).toBe(5);
  });
});

describe("formatReport", () => {
  it("prints 'no differences' when there are none", () => {
    const report = buildDiffReport({ base: [row()], feature: [row()] });
    expect(formatReport(report)).toContain("no differences");
  });

  it("warns when one side has zero recorded traffic", () => {
    const report = buildDiffReport({ base: [], feature: [row()] });
    expect(formatReport(report)).toContain("zero recorded traffic");
  });

  it("prints added routes, removed routes, and key diffs", () => {
    const report = buildDiffReport({
      base: [row({ route_pattern: "/api/gone" })],
      feature: [row({ route_pattern: "/api/new" })],
    });
    const out = formatReport(report);
    expect(out).toContain("ROUTES ADDED:");
    expect(out).toContain("+ GET /api/new [200]");
    expect(out).toContain("ROUTES REMOVED:");
    expect(out).toContain("- GET /api/gone [200]");
  });

  it("prints a KEY DIFFS section with +/-/~ lines for a shared route's key changes", () => {
    const base = row({
      shape: objShape({
        count: { type: "number" },
        label: { type: "string" },
      }),
    });
    const feature = row({
      shape: objShape({
        count: { type: "string" },
        extra: { type: "boolean" },
        label: { type: "string" },
      }),
    });
    const report = buildDiffReport({ base: [base], feature: [feature] });
    const out = formatReport(report);
    expect(out).toContain("KEY DIFFS:");
    expect(out).toContain("GET /api/foo [200]:");
    expect(out).toContain("+ extra");
    expect(out).toContain("~ count");
  });

  it("never prints real dynamic key names when diffing a pre-#544 snapshot against a post-#544 one (regression)", () => {
    // base = a snapshot recorded before PR #544's redaction fix (real user emails
    // stored as object keys); feature = the same route recorded after the fix
    // (collapsed to <dynamic>) with a genuinely different value shape. The report
    // must surface the value-shape change WITHOUT ever reprinting the real emails.
    const base = row({
      shape: objShape({
        "alice@example.com": { type: "number" },
        "bob@example.com": { type: "number" },
      }),
    });
    const feature = row({
      shape: objShape({ "<dynamic>": { type: "string" } }),
    });
    const report = buildDiffReport({ base: [base], feature: [feature] });
    const out = formatReport(report);
    expect(out).toContain("~ <dynamic>");
    expect(out).not.toContain("@example.com");
  });
});
