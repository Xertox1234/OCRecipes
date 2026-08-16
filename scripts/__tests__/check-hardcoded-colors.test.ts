import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(__dirname, "..", "check-hardcoded-colors.js");

/**
 * The checker skips any file whose FULL resolved path contains one of its skip
 * substrings. mkdtemp's random suffix can form one (e.g. "…buildX"), which
 * would silently skip every fixture and turn the suite green over zero files —
 * so regenerate until the realpath'd root is clean. realpath matters on macOS:
 * os.tmpdir() is /var/… but resolves to /private/var/….
 */
const SKIP_PATTERNS = [
  "node_modules",
  "__tests__",
  ".test.",
  ".spec.",
  "dist",
  "build",
];
const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  for (let i = 0; i < 20; i++) {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
    );
    if (!SKIP_PATTERNS.some((p) => root.includes(p))) {
      tmpDirs.push(root);
      return root;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  throw new Error("could not create a skip-pattern-free temp dir");
}

function writeFixture(dir: string, name: string, content: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function run(scriptPath: string, args: string[]) {
  const result = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

/**
 * No-arg mode resolves `__dirname/../client`, so those tests copy the script
 * into `<tmp>/scripts/` and build a fixture `<tmp>/client/` tree — the copy's
 * own location makes the temp tree the repo root (same pattern as
 * check-rules-file-size.test.ts).
 */
function makeRepo(clientFiles: Record<string, string>): string {
  const root = makeTmpDir("colorchk-");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "client"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-hardcoded-colors.js"),
  );
  for (const [name, content] of Object.entries(clientFiles)) {
    writeFixture(path.join(root, "client"), name, content);
  }
  return root;
}

function runNoArg(root: string) {
  return run(path.join(root, "scripts", "check-hardcoded-colors.js"), []);
}

describe("check-hardcoded-colors.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("arg mode (the lint-staged path)", () => {
    it("flags a hex color literal", () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Hex.tsx",
        'export const s = { backgroundColor: "#FF6B35" };\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("#FF6B35");
      expect(out).toContain("Errors: 1");
    });

    it("flags a named CSS color literal", () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Named.tsx",
        'export const s = { color: "white" };\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("Errors: 1");
    });

    it("passes a clean theme-based file — and proves it scanned it", () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Clean.tsx",
        "export const s = (theme: T) => ({ backgroundColor: theme.background });\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      // Non-vacuity: an empty scan also exits 0, so anchor the file count.
      expect(out).toContain("No hardcoded colors found in 1 files");
    });

    it("the // hardcoded opt-out exempts only its own line", () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "OptOut.tsx",
        [
          'const a = { color: "#123456" }; // hardcoded',
          'const b = { color: "#654321" };',
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      // Two-sided: the opt-out works AND does not bleed into the next line.
      expect(status).toBe(1);
      expect(out).toContain("Errors: 1");
      expect(out).toContain("#654321");
      expect(out).not.toContain("#123456");
    });

    it("ignores a hex color in a trailing line comment", () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Trailing.tsx",
        "const y = theme.backgroundSecondary; // #393948 in dark\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No hardcoded colors found in 1 files");
    });

    it("ignores import lines even when they contain color-like strings", () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Imports.tsx",
        'import white from "white";\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No hardcoded colors found in 1 files");
    });

    it('exempts type-literal usage: "red" as const', () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "AsConst.tsx",
        'const kind = "red" as const;\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No hardcoded colors found in 1 files");
    });

    it('exempts comparison usage: x === "red"', () => {
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Compare.tsx",
        'if (x === "red") {\n  doThing();\n}\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No hardcoded colors found in 1 files");
    });

    it("a second identical literal on the same line does NOT inherit the first one's exemption", () => {
      // Regression: the exemption check used indexOf(match), so every duplicate
      // literal resolved to the FIRST occurrence's surroundings — here the
      // ternary's "white" (a real hardcoded color) inherited the comparison
      // exemption of the "white" before === and was silently skipped.
      const dir = makeTmpDir("colorchk-");
      const file = writeFixture(
        dir,
        "Twice.tsx",
        'const c = x === "white" ? "white" : theme.text;\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("Errors: 1");
    });

    it("silently ignores a nonexistent path and reports a zero-file scan", () => {
      // Pinned fail-open: matches the other checkers' arg-mode semantics under
      // lint-staged (a deleted-but-staged path must not fail the commit).
      const dir = makeTmpDir("colorchk-");
      const { status, out } = run(realScript, [path.join(dir, "nope.tsx")]);
      expect(status, out).toBe(0);
      expect(out).toContain("No hardcoded colors found in 0 files");
    });
  });

  describe("no-arg mode (the CI / preflight path)", () => {
    it("discovers client/ and FAILS on a violation instead of no-opping", () => {
      // Regression: the no-arg branch printed usage and exited 0 having scanned
      // ZERO files — which made the CI and preflight invocations (which pass no
      // args) complete no-ops while lint-staged kept the corpus clean.
      const root = makeRepo({
        "Bad.tsx": 'export const s = { color: "#FF0000" };\n',
      });
      const { status, out } = runNoArg(root);
      expect(status).toBe(1);
      expect(out).toContain("#FF0000");
    });

    it("scans the whole client tree on a clean repo — and says how many files", () => {
      const root = makeRepo({
        "A.tsx": "export const a = (t: T) => t.background;\n",
        "B.tsx": "export const b = (t: T) => t.text;\n",
      });
      const { status, out } = runNoArg(root);
      expect(status, out).toBe(0);
      // Non-vacuity: a broken walker that finds nothing would also exit 0.
      expect(out).toContain("No hardcoded colors found in 2 files");
    });
  });
});
