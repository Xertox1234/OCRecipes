import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  computeTotals,
  parseArgs,
  proposeThresholds,
  readCurrentThresholds,
  applyThresholds,
} from "../coverage-ratchet";

const SCRIPT = path.resolve(__dirname, "..", "coverage-ratchet.ts");

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-")),
  );
  tmpDirs.push(root);
  return root;
}

/**
 * A config file mimicking the real vitest.config.ts thresholds block.
 * `before` is inserted ABOVE the block — used to plant decoy `lines: NN`
 * matches that the old whole-file regexes latched onto.
 */
function writeConfig(
  dir: string,
  thresholds: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  },
  before = "",
  nestedBefore = "",
): string {
  const file = path.join(dir, "vitest.config.ts");
  fs.writeFileSync(
    file,
    [
      'import { defineConfig } from "vitest/config";',
      "export default defineConfig({",
      "  test: {",
      before,
      "    coverage: {",
      "      thresholds: {",
      nestedBefore,
      "        autoUpdate: false,",
      `        lines: ${thresholds.lines},`,
      `        functions: ${thresholds.functions},`,
      `        branches: ${thresholds.branches},`,
      `        statements: ${thresholds.statements},`,
      "      },",
      "    },",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  return file;
}

/** Minimal complete Istanbul file-coverage entry. */
function istanbulFile(opts: {
  path: string;
  statements: { line: number; hits: number }[];
  fnHits: number[];
  branchHits: number[][];
}) {
  const statementMap: Record<
    string,
    {
      start: { line: number; column: number };
      end: { line: number; column: number };
    }
  > = {};
  const s: Record<string, number> = {};
  opts.statements.forEach((st, i) => {
    statementMap[String(i)] = {
      start: { line: st.line, column: 0 },
      end: { line: st.line, column: 10 },
    };
    s[String(i)] = st.hits;
  });
  const fnMap: Record<
    string,
    { name: string; loc: (typeof statementMap)[string] }
  > = {};
  const f: Record<string, number> = {};
  opts.fnHits.forEach((hits, i) => {
    fnMap[String(i)] = {
      name: `fn${i}`,
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    };
    f[String(i)] = hits;
  });
  const branchMap: Record<
    string,
    { type: string; locations: (typeof statementMap)[string][]; line: number }
  > = {};
  const b: Record<string, number[]> = {};
  opts.branchHits.forEach((hits, i) => {
    branchMap[String(i)] = { type: "if", locations: [], line: 1 };
    b[String(i)] = hits;
  });
  return { path: opts.path, statementMap, fnMap, branchMap, s, f, b };
}

/** Coverage where every metric is exactly 50%. */
function halfCoveredCoverage() {
  return {
    "/x/a.ts": istanbulFile({
      path: "/x/a.ts",
      statements: [
        { line: 1, hits: 1 },
        { line: 2, hits: 0 },
      ],
      fnHits: [1, 0],
      branchHits: [[1, 0]],
    }),
  };
}

function writeCoverage(dir: string, data: unknown): string {
  const file = path.join(dir, "coverage-final.json");
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function runCli(args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--import=tsx", SCRIPT, ...args],
    { encoding: "utf8", timeout: 30_000 },
  );
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

describe("coverage-ratchet", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("computeTotals", () => {
    it("computes all four metrics from a two-file fixture", () => {
      const data = {
        "/x/a.ts": istanbulFile({
          path: "/x/a.ts",
          statements: [
            { line: 1, hits: 1 },
            { line: 2, hits: 0 },
          ],
          fnHits: [1],
          branchHits: [[1, 0]],
        }),
        "/x/b.ts": istanbulFile({
          path: "/x/b.ts",
          statements: [{ line: 1, hits: 5 }],
          fnHits: [0],
          branchHits: [],
        }),
      };
      const totals = computeTotals(data);
      expect(totals.statements).toBeCloseTo((2 / 3) * 100, 5);
      expect(totals.functions).toBeCloseTo(50, 5);
      expect(totals.branches).toBeCloseTo(50, 5);
      expect(totals.lines).toBeCloseTo((2 / 3) * 100, 5);
    });

    it("returns 100 for every metric on empty coverage (empty denominators)", () => {
      const totals = computeTotals({});
      expect(totals).toEqual({
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      });
    });

    it("counts a line once even when several statements share it", () => {
      const data = {
        "/x/a.ts": istanbulFile({
          path: "/x/a.ts",
          statements: [
            { line: 1, hits: 0 },
            { line: 1, hits: 2 },
          ],
          fnHits: [],
          branchHits: [],
        }),
      };
      const totals = computeTotals(data);
      expect(totals.lines).toBe(100); // one line, covered by its second statement
      expect(totals.statements).toBe(50);
    });
  });

  describe("proposeThresholds", () => {
    const t = (n: number) => ({
      lines: n,
      statements: n,
      functions: n,
      branches: n,
    });

    it("never lowers a threshold (ratchet-up-only)", () => {
      // floor(50.9) - 4 = 46 < current 48 → stays 48.
      expect(proposeThresholds(t(48), t(50.9), 4)).toEqual(t(48));
    });

    it("raises to floor(actual) - buffer when that exceeds current", () => {
      expect(proposeThresholds(t(40), t(50.9), 4)).toEqual(t(46));
    });
  });

  describe("readCurrentThresholds", () => {
    it("reads the four metrics from the thresholds block", () => {
      const dir = makeTmpDir();
      const cfg = writeConfig(dir, {
        lines: 53,
        functions: 58,
        branches: 55,
        statements: 53,
      });
      expect(readCurrentThresholds(cfg)).toEqual({
        lines: 53,
        statements: 53,
        functions: 58,
        branches: 55,
      });
    });

    it("is not fooled by a decoy metric mention above the block", () => {
      // Regression: the old whole-file regex took the FIRST `lines: N` in the
      // file — a baseline comment or per-glob config above the block silently
      // retargeted both the read and the patch.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "    // legacy baseline — lines: 99, statements: 99",
      );
      const current = readCurrentThresholds(cfg);
      expect(current.lines).toBe(53);
      expect(current.statements).toBe(53);
    });

    it("throws when the config has no thresholds block", () => {
      const dir = makeTmpDir();
      const cfg = path.join(dir, "vitest.config.ts");
      fs.writeFileSync(cfg, "export default {};\n");
      expect(() => readCurrentThresholds(cfg)).toThrow(/thresholds/);
    });

    it("throws /Unbalanced/ when the thresholds block never closes", () => {
      // Distinct from the "no thresholds block" case above: here the
      // `thresholds: {` match succeeds (so the block-locate loop starts),
      // but depth never returns to 0 — the loop falls through to the
      // Unbalanced throw instead of the "Could not find" one.
      const dir = makeTmpDir();
      const cfg = path.join(dir, "vitest.config.ts");
      fs.writeFileSync(
        cfg,
        [
          "export default defineConfig({",
          "  test: {",
          "    coverage: {",
          "      thresholds: {",
          "        lines: 50,",
          "        statements: 50,",
          // deliberately no closing braces
        ].join("\n"),
      );
      expect(() => readCurrentThresholds(cfg)).toThrow(/Unbalanced/);
    });

    it("parses correctly with a BALANCED brace-expansion glob key", () => {
      // `"client/{a,b}/**"` is vitest-native and already the house style in
      // the repo's own `coverage.include`. The brace PAIR self-corrects the
      // depth counter (1→2→1) before any real metric is reached, so both the
      // block-locate and the mask stay correct. A guard that rejected "any
      // brace in a literal" broke this working input — this pins that it
      // parses, and returns the FLAT metrics, not the per-glob ones.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "",
        '        "client/{screens,components}/**": { lines: 80, functions: 70, branches: 60, statements: 80 },',
      );
      expect(readCurrentThresholds(cfg)).toEqual({
        lines: 53,
        statements: 53,
        functions: 58,
        branches: 55,
      });
    });

    it("throws a clear error on an UNBALANCED brace inside a glob key", () => {
      // The shape that genuinely desyncs the brace counter. It already failed
      // before the check existed — but only downstream, as a misleading
      // `Could not parse threshold for "lines"`. Pin the message that names
      // the real cause.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "",
        '        "client/{screens/**": { lines: 80, functions: 70, branches: 60, statements: 80 },',
      );
      expect(() => readCurrentThresholds(cfg)).toThrow(
        /unbalanced brace inside a string literal/i,
      );
    });

    it("still sees an unbalanced brace in a literal that contains `//`", () => {
      // Regression: a comment-strip PRE-PASS (`block.replace(/\/\/[^\n]*/g,
      // "")`) is not literal-aware — it truncated `"https://example.com/{a"`
      // to `"https`, which then matched no complete literal, so the check
      // silently did not fire and the failure degraded back to the
      // downstream `Could not parse threshold` message. The fixture pairs
      // `//` with an UNBALANCED brace on purpose: a BALANCED one would parse
      // correctly under both the broken and the fixed scan and so could not
      // discriminate between them.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "",
        '        "https://example.com/{a": { lines: 80, functions: 70, branches: 60, statements: 80 },',
      );
      expect(() => readCurrentThresholds(cfg)).toThrow(
        /unbalanced brace inside a string literal/i,
      );
    });

    it("does not throw on two adjacent per-glob keys", () => {
      // History: a candidate implementation matched from a quote character to
      // a LATER same-type quote character while excluding only quote
      // characters (not braces) from the interior. Since the value object
      // between "client/**" and "server/**" below (`: { lines: 80, ... },`)
      // contains no quote characters, that construction tunnelled straight
      // through it — closing quote of "client/**" to opening quote of
      // "server/**" — and false-positived on this legal config.
      //
      // NOTE this fixture no longer *discriminates* against that
      // construction: the span it would capture is itself brace-BALANCED, so
      // the narrowed unbalanced-only check passes it either way. It is kept
      // as a plain "legal config must not throw" regression, not as a proof
      // that literals are enumerated as whole tokens.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "",
        [
          '        "client/**": { lines: 80, functions: 70, branches: 60, statements: 80 },',
          '        "server/**": { lines: 70, functions: 60, branches: 50, statements: 70 },',
        ].join("\n"),
      );
      expect(() => readCurrentThresholds(cfg)).not.toThrow();
    });

    it("does not throw on a brace-containing string literal above the block (out of scope)", () => {
      // Mirrors the real vitest.config.ts: `coverage.include` (a sibling of
      // `thresholds`) uses a brace-expansion glob string. The check must be
      // scoped to the located thresholds block only, or this would throw on
      // the repo's own real config.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        '    include: ["client/**/*.{ts,tsx}"],',
      );
      expect(() => readCurrentThresholds(cfg)).not.toThrow();
    });

    it("does not throw when two apostrophes in a line comment straddle a brace", () => {
      // Without stripping comments first, "don't" ... "that's" forms a false
      // pseudo string-literal ("t use {invalid}, that") spanning the brace.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "",
        "        // don't use {invalid}, that's the point",
      );
      expect(() => readCurrentThresholds(cfg)).not.toThrow();
    });

    it("reads the FLAT metrics when a per-glob sub-object precedes them", () => {
      // Vitest supports per-glob threshold sub-objects INSIDE the block. The
      // naive non-greedy block regex ended at the sub-object's own `}` and a
      // first-match metric scan then read the per-glob numbers — the exact
      // retargeting failure class this refactor claims to eliminate.
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 53, functions: 58, branches: 55, statements: 53 },
        "",
        '        "client/**": { lines: 80, functions: 70, branches: 60, statements: 80 },',
      );
      expect(readCurrentThresholds(cfg)).toEqual({
        lines: 53,
        statements: 53,
        functions: 58,
        branches: 55,
      });
    });
  });

  describe("applyThresholds", () => {
    it("patches inside the block and leaves a decoy above it untouched", () => {
      const dir = makeTmpDir();
      const cfg = writeConfig(
        dir,
        { lines: 40, functions: 40, branches: 40, statements: 40 },
        "    // legacy baseline — lines: 99, statements: 99",
      );
      applyThresholds(
        { lines: 60, statements: 61, functions: 62, branches: 63 },
        cfg,
      );
      const source = fs.readFileSync(cfg, "utf8");
      expect(source).toContain("lines: 60,");
      expect(source).toContain("statements: 61,");
      expect(source).toContain("functions: 62,");
      expect(source).toContain("branches: 63,");
      // The decoy is untouched — and no stray 40 survives in the block.
      expect(source).toContain("lines: 99");
      expect(source).not.toContain(": 40,");
    });

    it("patches ONLY the flat metrics when a per-glob sub-object precedes them", () => {
      const dir = makeTmpDir();
      const nested =
        '        "client/**": { lines: 80, functions: 70, branches: 60, statements: 80 },';
      const cfg = writeConfig(
        dir,
        { lines: 40, functions: 41, branches: 42, statements: 43 },
        "",
        nested,
      );
      applyThresholds(
        { lines: 60, statements: 61, functions: 62, branches: 63 },
        cfg,
      );
      const source = fs.readFileSync(cfg, "utf8");
      // The per-glob sub-object survives byte-for-byte…
      expect(source).toContain(nested.trim());
      // …and the flat metrics (not the nested ones) took the new values.
      expect(source).toContain("lines: 60,");
      expect(source).toContain("statements: 61,");
      expect(source).toContain("functions: 62,");
      expect(source).toContain("branches: 63,");
      expect(source).not.toContain("lines: 40,");
    });

    it("stays index-accurate when replacements cross digit-length boundaries", () => {
      // patchMetric re-masks the CURRENT block on every call precisely so a
      // 1→3-digit replacement can't drift later matches' indices. A hoisted
      // once-computed mask would pass the equal-length fixture above and
      // silently corrupt this one — this fixture is the discriminator.
      const dir = makeTmpDir();
      const nested =
        '        "client/**": { lines: 80, functions: 70, branches: 60, statements: 80 },';
      const cfg = writeConfig(
        dir,
        { lines: 9, functions: 8, branches: 7, statements: 6 },
        "",
        nested,
      );
      applyThresholds(
        { lines: 100, statements: 61, functions: 62, branches: 63 },
        cfg,
      );
      const source = fs.readFileSync(cfg, "utf8");
      expect(source).toContain(nested.trim());
      expect(source).toContain("lines: 100,");
      expect(source).toContain("statements: 61,");
      expect(source).toContain("functions: 62,");
      expect(source).toContain("branches: 63,");
      // Round-trip through the reader proves the block is still parseable.
      expect(readCurrentThresholds(cfg)).toEqual({
        lines: 100,
        statements: 61,
        functions: 62,
        branches: 63,
      });
    });
  });

  describe("parseArgs", () => {
    it("defaults to the repo coverage file and config, buffer 4, report mode", () => {
      const parsed = parseArgs([]);
      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      expect(parsed.buffer).toBe(4);
      expect(parsed.applyMode).toBe(false);
      expect(parsed.coverageFile.endsWith("coverage-final.json")).toBe(true);
      expect(parsed.configFile.endsWith("vitest.config.ts")).toBe(true);
    });

    it("accepts --apply, --buffer, --coverage-file, and --config-file", () => {
      const parsed = parseArgs([
        "--apply",
        "--buffer",
        "3",
        "--coverage-file",
        "cov.json",
        "--config-file",
        "cfg.ts",
      ]);
      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      expect(parsed.applyMode).toBe(true);
      expect(parsed.buffer).toBe(3);
      expect(parsed.coverageFile.endsWith("cov.json")).toBe(true);
      expect(parsed.configFile.endsWith("cfg.ts")).toBe(true);
    });

    it("rejects an unknown argument instead of silently running in report mode", () => {
      const parsed = parseArgs(["--aply"]);
      expect(parsed.kind).toBe("error");
      if (parsed.kind !== "error") return;
      expect(parsed.message).toContain("Unknown argument");
    });

    it("rejects a negative buffer", () => {
      expect(parseArgs(["--buffer", "-1"]).kind).toBe("error");
    });

    it("recognizes --help", () => {
      expect(parseArgs(["--help"]).kind).toBe("help");
    });
  });

  describe("CLI", () => {
    it("exits 2 when the coverage file does not exist", () => {
      const dir = makeTmpDir();
      const cfg = writeConfig(dir, {
        lines: 46,
        functions: 46,
        branches: 46,
        statements: 46,
      });
      const { status, out } = runCli([
        "--coverage-file",
        path.join(dir, "nope.json"),
        "--config-file",
        cfg,
      ]);
      expect(status).toBe(2);
      expect(out).toContain("Coverage file not found");
    });

    it("exits 1 when a metric is below its threshold", () => {
      const dir = makeTmpDir();
      const cov = writeCoverage(dir, {
        "/x/a.ts": istanbulFile({
          path: "/x/a.ts",
          statements: [{ line: 1, hits: 0 }],
          fnHits: [0],
          branchHits: [[0]],
        }),
      });
      const cfg = writeConfig(dir, {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      });
      const { status, out } = runCli([
        "--coverage-file",
        cov,
        "--config-file",
        cfg,
      ]);
      expect(status).toBe(1);
      expect(out).toContain("below their thresholds");
    });

    it("exits 0 with no raise needed when passing at the buffered threshold", () => {
      const dir = makeTmpDir();
      const cov = writeCoverage(dir, halfCoveredCoverage());
      const cfg = writeConfig(dir, {
        lines: 46,
        functions: 46,
        branches: 46,
        statements: 46,
      });
      const { status, out } = runCli([
        "--coverage-file",
        cov,
        "--config-file",
        cfg,
      ]);
      expect(status, out).toBe(0);
      // Non-vacuity: the report actually rendered over the fixture.
      expect(out).toContain("Coverage Ratchet");
      expect(out).toContain("No threshold updates needed");
    });

    it("exits 1 and points at --apply when a raise is available", () => {
      const dir = makeTmpDir();
      const cov = writeCoverage(dir, halfCoveredCoverage());
      const cfg = writeConfig(dir, {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40,
      });
      const { status, out } = runCli([
        "--coverage-file",
        cov,
        "--config-file",
        cfg,
      ]);
      expect(status).toBe(1);
      expect(out).toContain("--apply");
    });

    it("--apply rewrites the given config file in place and exits 0", () => {
      const dir = makeTmpDir();
      const cov = writeCoverage(dir, halfCoveredCoverage());
      const cfg = writeConfig(dir, {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40,
      });
      const { status, out } = runCli([
        "--coverage-file",
        cov,
        "--config-file",
        cfg,
        "--apply",
      ]);
      expect(status, out).toBe(0);
      expect(out).toContain("updated with proposed thresholds");
      const source = fs.readFileSync(cfg, "utf8");
      expect(source).toContain("lines: 46,"); // floor(50) - 4
      expect(source).not.toContain("lines: 40,");
    });

    it("exits 2 on an unknown argument", () => {
      const { status, out } = runCli(["--nope"]);
      expect(status).toBe(2);
      expect(out).toContain("Unknown argument");
    });

    it("exits 2 when the config file does not exist (not the coverage-failing 1)", () => {
      // Exit 1 means "coverage is failing" per the documented contract; a
      // missing/unreadable config is a usage error and must be a clean 2,
      // not an uncaught ENOENT stack trace.
      const dir = makeTmpDir();
      const cov = writeCoverage(dir, halfCoveredCoverage());
      const { status, out } = runCli([
        "--coverage-file",
        cov,
        "--config-file",
        path.join(dir, "nope.config.ts"),
      ]);
      expect(status).toBe(2);
      expect(out).toContain("Config file not found");
    });

    it("exits 2 with a clean message on malformed or wrong-shape coverage JSON", () => {
      // An interrupted test:coverage run leaves a truncated JSON file — a
      // real failure mode. An uncaught SyntaxError exits 1, which this
      // script's contract defines as "coverage is failing"; it must be a
      // clean usage-error 2 instead (same contract as the config guards).
      const dir = makeTmpDir();
      const cfg = writeConfig(dir, {
        lines: 46,
        functions: 46,
        branches: 46,
        statements: 46,
      });
      const malformed = path.join(dir, "coverage-final.json");
      fs.writeFileSync(malformed, '{"truncated": ');
      const bad = runCli(["--coverage-file", malformed, "--config-file", cfg]);
      expect(bad.status).toBe(2);
      expect(bad.out).toContain("Could not read coverage data");

      // Well-formed JSON with the wrong shape (entry.s missing) is the same
      // contract violation via TypeError instead of SyntaxError.
      fs.writeFileSync(malformed, '{"/x/a.ts": {"path": "/x/a.ts"}}');
      const wrongShape = runCli([
        "--coverage-file",
        malformed,
        "--config-file",
        cfg,
      ]);
      expect(wrongShape.status).toBe(2);
      expect(wrongShape.out).toContain("Could not read coverage data");
    });

    it("exits 2 with a clean message when the config has no thresholds block", () => {
      const dir = makeTmpDir();
      const cov = writeCoverage(dir, halfCoveredCoverage());
      const cfg = path.join(dir, "vitest.config.ts");
      fs.writeFileSync(cfg, "export default {};\n");
      const { status, out } = runCli([
        "--coverage-file",
        cov,
        "--config-file",
        cfg,
      ]);
      expect(status).toBe(2);
      expect(out).toContain("thresholds");
    });
  });
});
