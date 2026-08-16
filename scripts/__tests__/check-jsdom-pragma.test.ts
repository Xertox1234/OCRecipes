import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(__dirname, "..", "check-jsdom-pragma.js");

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  // realpath matters on macOS: /var vs /private/var (see check-rules-file-size.test.ts).
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "jsdomchk-")),
  );
  tmpDirs.push(root);
  return root;
}

/**
 * isInScope is a pure path-suffix regex — arg-mode fixtures only need the
 * literal `client/components/**\/__tests__/*.test.tsx` shape inside the temp
 * dir, no script copy required.
 */
function writeScoped(root: string, name: string, content: string): string {
  const dir = path.join(root, "client", "components", "__tests__");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function run(scriptPath: string, args: string[]) {
  const result = spawnSync("node", [scriptPath, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
    stdout: result.stdout ?? "",
  };
}

/** No-arg mode resolves `__dirname/../client/components` — copy-into-temp-repo. */
function makeRepo(): string {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-jsdom-pragma.js"),
  );
  return root;
}

const BODY = 'describe("x", () => {});\n';

describe("check-jsdom-pragma.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("arg mode (the lint-staged path)", () => {
    it("accepts the line pragma on line 1", () => {
      const root = makeTmpDir();
      const file = writeScoped(
        root,
        "A.test.tsx",
        "// @vitest-environment jsdom\n" + BODY,
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      // Non-vacuity: out-of-scope args are dropped to a silent zero-file pass.
      expect(out).toContain("jsdom pragma present in 1 files");
    });

    it("accepts the JSDoc block pragma", () => {
      const root = makeTmpDir();
      const file = writeScoped(
        root,
        "B.test.tsx",
        "/** @vitest-environment jsdom */\n" + BODY,
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("jsdom pragma present in 1 files");
    });

    it("accepts the pragma on line 3 (last allowed line)", () => {
      const root = makeTmpDir();
      const file = writeScoped(
        root,
        "C.test.tsx",
        "// header\n// header 2\n// @vitest-environment jsdom\n" + BODY,
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("jsdom pragma present in 1 files");
    });

    it("rejects the pragma on line 4 (first-3-lines rule)", () => {
      const root = makeTmpDir();
      const file = writeScoped(
        root,
        "D.test.tsx",
        "// a\n// b\n// c\n// @vitest-environment jsdom\n" + BODY,
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("Errors: 1");
    });

    it("rejects a file with no pragma at all", () => {
      const root = makeTmpDir();
      const file = writeScoped(root, "E.test.tsx", BODY);
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("missing '// @vitest-environment jsdom' pragma");
    });

    it("rejects a pragma with a trailing comment (regex is $-anchored)", () => {
      const root = makeTmpDir();
      const file = writeScoped(
        root,
        "F.test.tsx",
        "// @vitest-environment jsdom — because DOM\n" + BODY,
      );
      const { status } = run(realScript, [file]);
      expect(status).toBe(1);
    });

    it("rejects a different environment (happy-dom is not jsdom)", () => {
      const root = makeTmpDir();
      const file = writeScoped(
        root,
        "G.test.tsx",
        "// @vitest-environment happy-dom\n" + BODY,
      );
      const { status } = run(realScript, [file]);
      expect(status).toBe(1);
    });

    it("PIN: silently drops out-of-scope args (exit 0, no output)", () => {
      // Correct-by-construction under lint-staged: its glob only feeds scoped
      // files, so a dropped arg means a mis-glob, not a missed file. Turning
      // this into a failure would break the hook on unrelated staged paths —
      // do not "fix" it.
      const root = makeTmpDir();
      const dir = path.join(root, "client", "components", "__tests__");
      fs.mkdirSync(dir, { recursive: true });
      const outOfScope = path.join(dir, "NotATest.tsx"); // .tsx, not .test.tsx
      fs.writeFileSync(outOfScope, BODY);
      const { status, stdout } = run(realScript, [outOfScope]);
      expect(status).toBe(0);
      // Pin the SCRIPT's silence on stdout only — newer Node versions print a
      // MODULE_TYPELESS_PACKAGE_JSON warning to stderr when spawning this
      // ESM-syntax .js file (no "type" in package.json), which is harness
      // noise, not script output. Asserting the combined stream empty made
      // this green locally and red on CI's Node.
      expect(stdout.trim()).toBe("");
    });

    it("PIN: no-arg run with no client/components dir exits 0 with a notice", () => {
      const root = makeRepo();
      const { status, out } = run(
        path.join(root, "scripts", "check-jsdom-pragma.js"),
        [],
      );
      expect(status).toBe(0);
      expect(out).toContain("client/components directory not found");
    });
  });

  describe("no-arg mode (the CI / preflight path)", () => {
    it("discovers scoped test files and FAILS on a missing pragma", () => {
      const root = makeRepo();
      writeScoped(root, "Bad.test.tsx", BODY);
      const { status, out } = run(
        path.join(root, "scripts", "check-jsdom-pragma.js"),
        [],
      );
      expect(status).toBe(1);
      expect(out).toContain("Bad.test.tsx");
    });
  });
});
