/**
 * Guard: every response schema the client parses with
 * (`<name>Schema.safeParse(` / `.parse(` under client/) has a provider-side
 * assertion — a server test whose code (not its comments) references the
 * same schema name (see
 * test/utils/expect-response-schema.ts).
 *
 * Two halves. (1) A synthetic positive control proving the pure function
 * fails on an uncovered name — a guard never seen red is not evidence.
 * (2) The repo walk. CONTRACT_ALLOWLIST is a RATCHET: it ships with the
 * names that were uncovered when the guard landed and must reach empty; an
 * entry that has since become covered fails the guard so it gets removed.
 *
 * Walk exclusions are a denylist (like fast-check-property-seed-guard) so a
 * client file dropped somewhere new is still scanned — an allowlist of roots
 * would fail OPEN.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  computeCoverage,
  extractParsedSchemaNames,
} from "../lib/contract-coverage";

/** Ratchet — remove an entry as soon as its provider-side assertion lands. */
const CONTRACT_ALLOWLIST: ReadonlySet<string> = new Set([
  "recipeSearchResponseSchema",
  "catalogSearchResponseSchema",
  "catalogConfigResponseSchema",
  "receiptAnalysisResultSchema",
  "receiptConfirmResultSchema",
  "tastePickCandidatesResponseSchema",
  "tastePicksResponseSchema",
  "coachBlockSchema",
]);

/**
 * Permanent: schemas the client parses that are NOT server responses (form
 * or local-state validation). Add with a one-line reason; never add a
 * response schema here to silence the guard.
 */
const NON_RESPONSE_SCHEMAS: ReadonlySet<string> = new Set<string>([]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".worktrees",
  ".expo",
  ".husky",
  ".eas",
  ".github",
  "ios",
  "android",
  "dist",
  "build",
  "coverage",
  ".stryker-tmp",
  "server_dist",
  "uploads",
  "assets",
]);

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (EXCLUDED_DIRS.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p, keep);
    return keep(p) ? [p] : [];
  });
}

const isClientSource = (p: string) =>
  /\.(ts|tsx)$/.test(p) &&
  !/\.test\.(ts|tsx)$/.test(p) &&
  !p.includes("__tests__");
const isServerTest = (p: string) =>
  (p.includes("__tests__") && /\.test\.ts$/.test(p)) || /\.itest\.ts$/.test(p);

describe("contract-coverage: pure functions (positive control)", () => {
  it("extracts schema names from safeParse and parse call sites", () => {
    const src = `
      const a = fooResponseSchema.safeParse(json);
      const b = barSchema.parse(data);
      const c = notAValidator.safeParse(x); // no Schema suffix → ignored
      const d = fooResponseSchema.safeParse(other);
    `;
    expect(extractParsedSchemaNames(src)).toEqual([
      "barSchema",
      "fooResponseSchema",
    ]);
  });

  it("reports an uncovered client-parsed schema with its file", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: ["expect(res.status).toBe(200);"],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([
      { name: "fooResponseSchema", files: ["client/hooks/useFoo.ts"] },
    ]);
  });

  it("treats a whole-word reference in any server test as coverage", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: [
        "expectResponseToMatch(res.body, fooResponseSchema);",
      ],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([]);
  });

  it("does not let a longer identifier count as coverage", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooSchema", ["client/x.ts"]]]),
      serverTestSources: ["expectResponseToMatch(res.body, fooSchemaV2);"],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered.map((u) => u.name)).toEqual(["fooSchema"]);
  });

  it("exempts allowlisted names but flags them as stale once covered", () => {
    const report = computeCoverage({
      clientSites: new Map([
        ["fooResponseSchema", ["client/a.ts"]],
        ["barResponseSchema", ["client/b.ts"]],
      ]),
      serverTestSources: [
        "expectResponseToMatch(res.body, barResponseSchema);",
      ],
      allowlist: new Set(["fooResponseSchema", "barResponseSchema"]),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([]);
    expect(report.staleAllowlist).toEqual(["barResponseSchema"]);
  });

  it("ignores non-response schemas entirely", () => {
    const report = computeCoverage({
      clientSites: new Map([["loginFormSchema", ["client/screens/Login.tsx"]]]),
      serverTestSources: [],
      allowlist: new Set(),
      nonResponse: new Set(["loginFormSchema"]),
    });
    expect(report.uncovered).toEqual([]);
  });

  it("does not count a schema name that appears only in a comment", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: [
        "// this test pins the fixture to fooResponseSchema permanently\nexpect(res.status).toBe(200);",
        "/* fooResponseSchema is asserted elsewhere */\nexpect(res.status).toBe(200);",
      ],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered.map((u) => u.name)).toEqual(["fooResponseSchema"]);
  });

  it("keeps a reference that follows a // inside a string literal on the same line", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: [
        'const res = await get("https://api.example.test/foo"); expectResponseToMatch(res.body, fooResponseSchema);',
      ],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([]);
  });

  it("keeps a reference after a regex literal with escaped slashes on the same line", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: [
        "const re = /https?:\\/\\//; expectResponseToMatch(res.body, fooResponseSchema);",
      ],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([]);
  });
});

describe("contract-coverage: repo walk", () => {
  const clientFiles = walk("client", isClientSource);
  const serverTestFiles = [
    ...walk("server", isServerTest),
    ...walk("test", isServerTest),
  ];
  const clientSites = new Map<string, string[]>();
  for (const f of clientFiles) {
    for (const name of extractParsedSchemaNames(readFileSync(f, "utf8"))) {
      clientSites.set(name, [...(clientSites.get(name) ?? []), f]);
    }
  }
  const report = computeCoverage({
    clientSites,
    serverTestSources: serverTestFiles.map((f) => readFileSync(f, "utf8")),
    allowlist: CONTRACT_ALLOWLIST,
    nonResponse: NON_RESPONSE_SCHEMAS,
  });

  it("scans a non-empty client tree (denominator)", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(clientSites.size).toBeGreaterThan(0);
  });

  it("every client-parsed response schema has a provider-side assertion", () => {
    const msg = report.uncovered
      .map(
        (u) =>
          `${u.name} is parsed in ${u.files.join(", ")} but no server test references it. ` +
          `Add expectResponseToMatch(res.body, ${u.name}) to the route test's success path ` +
          `(or add it to NON_RESPONSE_SCHEMAS with a reason if it is not a server response).`,
      )
      .join("\n");
    expect(report.uncovered, msg).toEqual([]);
  });

  it("the allowlist ratchet has no stale entries", () => {
    expect(
      report.staleAllowlist,
      `Remove from CONTRACT_ALLOWLIST (now covered): ${report.staleAllowlist.join(", ")}`,
    ).toEqual([]);
  });
});
