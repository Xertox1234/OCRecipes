// scripts/__tests__/mutation-on-diff.test.ts
/**
 * Floor rule for Lane F: the eligible-set function must exclude what the
 * registry excludes, skip what the registry already gates, report untested
 * modules, enforce the cap, and the score maths must match Stryker's
 * definition — each proven on synthetic input using the REAL registry
 * predicates so a regex drift in stryker.targets.mjs shows up here.
 */
import { describe, it, expect } from "vitest";
import {
  isApprovedExclusion,
  isHardExclusion,
  MUTATION_TARGETS,
} from "../../stryker.targets.mjs";
import {
  MAX_FILES,
  renderSummary,
  rowFromRun,
  scoreFromReport,
  selectEligible,
  testGlob,
} from "../ci/mutation-on-diff.mjs";

const registered = new Set(
  Object.values(MUTATION_TARGETS).flatMap((t) => t.mutate),
);
// Modules exist unless listed as deleted; a test exists only if listed.
const deps = (
  tests: string[],
  { max, deleted = [] }: { max?: number; deleted?: string[] } = {},
) => ({
  isHardExclusion,
  isApprovedExclusion,
  registeredMutatePaths: registered,
  exists: (p: string) =>
    !deleted.includes(p) &&
    (p.includes("/__tests__/") ? tests.includes(p) : true),
  max,
});

describe("selectEligible", () => {
  it("pairs an eligible module with its co-located test", () => {
    const r = selectEligible(
      ["server/lib/foo.ts"],
      deps(["server/lib/__tests__/foo.test.ts"]),
    );
    expect(r.eligible).toEqual([
      { file: "server/lib/foo.ts", test: "server/lib/__tests__/foo.test.ts" },
    ]);
  });

  it("reports a module with no co-located test as untested", () => {
    const r = selectEligible(["server/services/bar.ts"], deps([]));
    expect(r.untested).toEqual(["server/services/bar.ts"]);
    expect(r.eligible).toEqual([]);
  });

  it("ignores tests, .d.ts, .tsx, and files outside the eligible roots", () => {
    const r = selectEligible(
      [
        "server/lib/__tests__/foo.test.ts",
        "server/lib/foo.property.test.ts",
        "server/lib/types.d.ts",
        "client/components/Button.tsx",
        "server/routes/recipes.ts",
        "scripts/ci/visual-diff.ts",
      ],
      deps(["server/lib/__tests__/foo.test.ts"]),
    );
    expect(r).toEqual({
      eligible: [],
      untested: [],
      excluded: [],
      skippedRegistered: [],
      overflow: [],
    });
  });

  it("includes modules in folders nested under an eligible root", () => {
    const r = selectEligible(
      ["server/services/recipe-finder/classify-turn.ts"],
      deps(["server/services/recipe-finder/__tests__/classify-turn.test.ts"]),
    );
    expect(r.eligible).toEqual([
      {
        file: "server/services/recipe-finder/classify-turn.ts",
        test: "server/services/recipe-finder/__tests__/classify-turn.test.ts",
      },
    ]);
  });

  it("drops a module the PR deleted, from every category", () => {
    const r = selectEligible(["server/lib/gone.ts", "server/lib/gone2.ts"], {
      ...deps(["server/lib/__tests__/gone.test.ts"], {
        deleted: ["server/lib/gone.ts", "server/lib/gone2.ts"],
      }),
    });
    expect(r).toEqual({
      eligible: [],
      untested: [],
      excluded: [],
      skippedRegistered: [],
      overflow: [],
    });
  });

  it("includes client/**/*-utils.ts (the pure-function-extraction convention)", () => {
    const r = selectEligible(
      ["client/components/nutrition/label-utils.ts"],
      deps(["client/components/nutrition/__tests__/label-utils.test.ts"]),
    );
    expect(r.eligible).toEqual([
      {
        file: "client/components/nutrition/label-utils.ts",
        test: "client/components/nutrition/__tests__/label-utils.test.ts",
      },
    ]);
  });

  it("excludes a Hard-Exclusion path using the registry predicate", () => {
    const hard = "server/services/iap-receipt-validation.ts";
    // Guards the fixture: if HARD_EXCLUSION_RE stops matching it, this says so.
    expect(isHardExclusion(hard)).toBe(true);
    const r = selectEligible(
      [hard],
      deps(["server/services/__tests__/iap-receipt-validation.test.ts"]),
    );
    expect(r.excluded).toEqual([hard]);
    expect(r.eligible).toEqual([]);
  });

  it("lets an APPROVED exclusion through when nothing else gates it", () => {
    const approved = "server/services/goal-calculator.ts";
    expect(isHardExclusion(approved) && isApprovedExclusion(approved)).toBe(
      true,
    );
    // goal-calculator is also a registered target; drop the registry set so the
    // approval branch alone decides.
    const r = selectEligible([approved], {
      ...deps(["server/services/__tests__/goal-calculator.test.ts"]),
      registeredMutatePaths: new Set<string>(),
    });
    expect(r.excluded).toEqual([]);
    expect(r.eligible).toEqual([
      {
        file: approved,
        test: "server/services/__tests__/goal-calculator.test.ts",
      },
    ]);
  });

  it("skips registered targets (their required gates cover them)", () => {
    const r = selectEligible(
      ["server/lib/macro-gap-context.ts", "server/services/goal-calculator.ts"],
      deps([
        "server/lib/__tests__/macro-gap-context.test.ts",
        "server/services/__tests__/goal-calculator.test.ts",
      ]),
    );
    expect(r.skippedRegistered).toEqual([
      "server/lib/macro-gap-context.ts",
      "server/services/goal-calculator.ts",
    ]);
    expect(r.eligible).toEqual([]);
  });

  it("enforces the cap and lists the overflow", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"].map(
      (n) => `server/lib/${n}.ts`,
    );
    const tests = files.map((f) =>
      f.replace(/server\/lib\/(\w+)\.ts$/, "server/lib/__tests__/$1.test.ts"),
    );
    // No max passed: the default cap applies.
    const r = selectEligible(files, deps(tests));
    expect(MAX_FILES).toBe(6);
    expect(r.eligible.map((e) => e.file)).toEqual(files.slice(0, 6));
    expect(r.overflow).toEqual(["server/lib/g.ts", "server/lib/h.ts"]);
  });
});

describe("scoreFromReport", () => {
  // Line 42 is "  return a >= b;", line 50 is '  const s = "x";' (1-based
  // columns, end exclusive, as in Stryker's report).
  const source = Array.from({ length: 60 }, (_, i) =>
    i === 41 ? "  return a >= b;" : i === 49 ? '  const s = "x";' : "",
  ).join("\n");
  const report = {
    files: {
      "server/lib/foo.ts": {
        source,
        mutants: [
          {
            status: "Killed",
            mutatorName: "EqualityOperator",
            replacement: ">",
            location: { start: { line: 10 } },
          },
          { status: "Timeout" },
          {
            status: "Survived",
            mutatorName: "ConditionalExpression",
            replacement: "true",
            location: {
              start: { line: 42, column: 10 },
              end: { line: 42, column: 16 },
            },
          },
          {
            status: "NoCoverage",
            mutatorName: "StringLiteral",
            replacement: '""',
            location: {
              start: { line: 50, column: 13 },
              end: { line: 50, column: 16 },
            },
          },
          { status: "Ignored" },
          { status: "CompileError" },
        ],
      },
    },
  };

  it("computes Stryker's score: detected / (detected + undetected)", () => {
    const r = scoreFromReport(report);
    expect(r).toMatchObject({
      total: 6,
      killed: 1,
      timeout: 1,
      survived: 1,
      noCoverage: 1,
      ignored: 1,
      errors: 1,
    });
    expect(r.score).toBe(50);
  });

  it("lists survivors and no-coverage mutants with line, mutator and the original code", () => {
    expect(scoreFromReport(report).survivors).toEqual([
      {
        file: "server/lib/foo.ts",
        line: 42,
        mutator: "ConditionalExpression",
        original: "a >= b",
        replacement: "true",
      },
      {
        file: "server/lib/foo.ts",
        line: 50,
        mutator: "StringLiteral",
        original: '"x"',
        replacement: '""',
      },
    ]);
  });

  it("slices a multi-line original and marks it unknown without a source", () => {
    const at = (line: number, column: number) => ({ line, column });
    const mutant = {
      status: "Survived",
      location: { start: at(2, 3), end: at(3, 2) },
    };
    const withSource = scoreFromReport({
      files: { m: { source: "a\n  {x;\n}; b", mutants: [mutant] } },
    });
    expect(withSource.survivors[0].original).toBe("{x;\n}");
    const noSource = scoreFromReport({ files: { m: { mutants: [mutant] } } });
    expect(noSource.survivors[0].original).toBe("?");
  });

  it("returns 0 when nothing is detectable", () => {
    expect(
      scoreFromReport({ files: { x: { mutants: [{ status: "Ignored" }] } } })
        .score,
    ).toBe(0);
  });
});

describe("renderSummary", () => {
  const noMeta = {
    untested: [],
    skippedRegistered: [],
    excluded: [],
    overflow: [],
  };
  const result = (killed: number, survived: number) =>
    scoreFromReport({
      files: {
        m: {
          mutants: [
            ...Array.from({ length: killed }, () => ({ status: "Killed" })),
            ...Array.from({ length: survived }, () => ({
              status: "Survived",
              mutatorName: "BooleanLiteral",
              replacement: "false",
              location: { start: { line: 7 } },
            })),
          ],
        },
      },
    });

  it("flags a score under 60 and not one at 60", () => {
    const out = renderSummary(
      [
        { file: "server/lib/low.ts", result: result(1, 1) },
        { file: "server/lib/edge.ts", result: result(3, 2) },
      ],
      noMeta,
    );
    expect(out).toContain("| server/lib/low.ts | 2 | 1 | 1 | 0 | 50.0% ⚠️ |");
    expect(out).toContain("| server/lib/edge.ts | 5 | 3 | 2 | 0 | 60.0% |");
    expect(out).toContain(
      "- line 7: `?` mutated to `false` (BooleanLiteral) — no test noticed",
    );
  });

  it("counts only scored mutants and notes the ignored and errored ones", () => {
    const r = scoreFromReport({
      files: {
        m: {
          mutants: [
            { status: "Killed" },
            { status: "Survived" },
            { status: "Ignored" },
            { status: "Ignored" },
            { status: "CompileError" },
          ],
        },
      },
    });
    const out = renderSummary(
      [{ file: "server/lib/ign.ts", result: r }],
      noMeta,
    );
    expect(out).toContain("| server/lib/ign.ts | 2 | 1 | 1 | 0 | 50.0% ⚠️ |");
    expect(out).toContain(
      "- server/lib/ign.ts: 2 ignored, 1 errored — not scored",
    );
  });

  it("lists survivors by line, each on one line in safe inline code", () => {
    const survivor = (line: number, replacement: string) => ({
      status: "Survived",
      mutatorName: "StringLiteral",
      replacement,
      location: { start: { line } },
    });
    const r = scoreFromReport({
      files: {
        m: {
          mutants: [
            survivor(9, "a(\n  b\n)"),
            survivor(3, "``"),
            survivor(5, "x".repeat(100)),
          ],
        },
      },
    });
    const out = renderSummary([{ file: "server/lib/s.ts", result: r }], noMeta);
    const said = (line: number, code: string) =>
      `- line ${line}: \`?\` mutated to ${code} (StringLiteral) — no test noticed`;
    const l3 = said(3, "``` `` ```");
    const l5 = said(5, `\`${"x".repeat(79)}…\``);
    const l9 = said(9, "`a( b )`");
    expect(out).toContain(l3);
    expect(out).toContain(l5);
    expect(out).toContain(l9);
    expect(out.indexOf(l3)).toBeLessThan(out.indexOf(l5));
    expect(out.indexOf(l5)).toBeLessThan(out.indexOf(l9));
  });

  it("says (empty) for an empty original or replacement", () => {
    const r = scoreFromReport({
      files: {
        m: {
          source: "f(x);",
          mutants: [
            {
              status: "Survived",
              mutatorName: "ArgumentRemoval",
              replacement: "",
              location: {
                start: { line: 1, column: 3 },
                end: { line: 1, column: 4 },
              },
            },
          ],
        },
      },
    });
    const out = renderSummary([{ file: "server/lib/e.ts", result: r }], noMeta);
    expect(out).toContain(
      "- line 1: `x` mutated to (empty) (ArgumentRemoval) — no test noticed",
    );
  });

  it("shows n/a, not a low-score flag, when no mutant was scored", () => {
    const r = scoreFromReport({
      files: { m: { mutants: [{ status: "Ignored" }] } },
    });
    const out = renderSummary([{ file: "server/lib/z.ts", result: r }], noMeta);
    expect(out).toContain("| server/lib/z.ts | 0 | 0 | 0 | 0 | n/a |");
  });

  it("keeps a harness error with a pipe or newline inside its table cell", () => {
    const out = renderSummary(
      [{ file: "server/lib/x.ts", result: null, error: "a | b\nc" }],
      noMeta,
    );
    expect(out).toContain("| server/lib/x.ts | — | — | — | — | ⚠️ a \\| b c |");
  });

  it("shows a harness error row instead of a score", () => {
    const out = renderSummary(
      [{ file: "server/lib/x.ts", result: null, error: "explore exited 1" }],
      noMeta,
    );
    expect(out).toContain(
      "| server/lib/x.ts | — | — | — | — | ⚠️ explore exited 1 |",
    );
  });

  it("lists every non-run category and says when nothing ran", () => {
    const out = renderSummary([], {
      untested: ["server/lib/u.ts"],
      skippedRegistered: ["server/lib/macro-gap-context.ts"],
      excluded: ["server/services/iap-receipt-validation.ts"],
      overflow: ["server/lib/h.ts"],
    });
    expect(out).toContain("_No eligible changed modules in this PR._");
    expect(out).toContain(
      "- Untested changed modules (no co-located test): server/lib/u.ts",
    );
    expect(out).toContain(
      "- Skipped (already a registered mutation target): server/lib/macro-gap-context.ts",
    );
    expect(out).toContain(
      "- Excluded (Hard-Exclusion, not human-approved): server/services/iap-receipt-validation.ts",
    );
    expect(out).toContain("- Over the cap, not run: server/lib/h.ts");
  });
});

describe("testGlob", () => {
  it("widens the co-located test to its siblings (e.g. .property.test.ts)", () => {
    expect(testGlob("server/lib/__tests__/civil-date.test.ts")).toBe(
      "server/lib/__tests__/civil-date{,.*}.test.ts",
    );
  });
});

describe("rowFromRun", () => {
  const file = "server/lib/foo.ts";
  const report = JSON.stringify({
    files: { [file]: { mutants: [{ status: "Killed" }] } },
  });

  it("scores a clean run from its report", () => {
    const row = rowFromRun(file, { status: 0 }, report);
    expect(row.error).toBeUndefined();
    expect(row.result?.score).toBe(100);
  });

  it("is a harness error when explore exits non-zero, even with a report", () => {
    expect(rowFromRun(file, { status: 1 }, report)).toEqual({
      file,
      result: null,
      error: "explore exited 1",
    });
  });

  it("is a harness error when explore exits 0 but wrote no report", () => {
    expect(rowFromRun(file, { status: 0 }, null)).toEqual({
      file,
      result: null,
      error: "explore exited 0 without a report",
    });
  });

  it("names the errno when explore could not be started", () => {
    const error = Object.assign(new Error("spawnSync npm E2BIG"), {
      code: "E2BIG",
    });
    expect(rowFromRun(file, { status: null, error }, null)).toEqual({
      file,
      result: null,
      error: "could not start explore (E2BIG)",
    });
  });

  it("is a harness error when the report cannot be read", () => {
    expect(rowFromRun(file, { status: 0 }, "{not json")).toEqual({
      file,
      result: null,
      error: "unreadable report",
    });
  });
});
