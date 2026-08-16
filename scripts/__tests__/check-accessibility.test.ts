import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(__dirname, "..", "check-accessibility.js");

/**
 * The checker skips any file whose FULL resolved path contains one of its skip
 * substrings — regenerate until the realpath'd root is clean (mkdtemp's random
 * suffix could form "build"/"dist"). realpath matters on macOS.
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

function makeTmpDir(): string {
  for (let i = 0; i < 20; i++) {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "a11ychk-")),
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
  const result = spawnSync("node", [scriptPath, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

/** No-arg mode resolves `__dirname/../client` — copy-into-temp-repo pattern. */
function makeRepo(clientFiles: Record<string, string>): string {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "client"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-accessibility.js"),
  );
  for (const [name, content] of Object.entries(clientFiles)) {
    writeFixture(path.join(root, "client"), name, content);
  }
  return root;
}

describe("check-accessibility.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("arg mode (the lint-staged path)", () => {
    it("flags a Pressable with onPress but no accessibilityLabel", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Press.tsx",
        [
          "export function A() {",
          "  return (",
          "    <Pressable onPress={() => go()}>",
          "      <Text>Hi</Text>",
          "    </Pressable>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("ERROR");
      expect(out).toContain("Pressable with onPress should have");
      expect(out).toContain("Errors: 1");
    });

    it("flags a TouchableOpacity with onPress but no accessibilityLabel", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Touch.tsx",
        "export const B = () => <TouchableOpacity onPress={go}><Text>x</Text></TouchableOpacity>;\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("TouchableOpacity with onPress");
    });

    it("passes a labeled interactive element — and proves it scanned the file", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Labeled.tsx",
        'export const C = () => (\n  <Pressable onPress={go} accessibilityLabel="Go home">\n    <Text>Go</Text>\n  </Pressable>\n);\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      // Non-vacuity: an empty scan also exits 0, so anchor the file count.
      expect(out).toContain("No accessibility issues found in 1 files");
    });

    it("does not require a label on a non-interactive Pressable (no onPress)", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Static.tsx",
        "export const D = () => <Pressable style={styles.card}><Text>x</Text></Pressable>;\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No accessibility issues found in 1 files");
    });

    it("LOAD-BEARING PIN: an unlabeled TextInput warns but must still exit 0", () => {
      // The TextInput rule is advisory BY DESIGN (severity: warning; only
      // errors fail the run). Hardening it into exit 1 would fail every
      // commit touching legacy inputs — do not "fix" this to be stricter.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Input.tsx",
        "export const E = () => <TextInput value={v} onChangeText={set} />;\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(out).toContain("WARNING");
      expect(out).toContain("Warnings: 1");
      expect(status, out).toBe(0);
    });

    it("scanner pin: a `>` inside a JSX expression does not truncate the element", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Braces.tsx",
        [
          "export function F() {",
          "  return (",
          "    <Pressable",
          "      style={styles.btn}",
          "      onPress={() => submit(a > b)}",
          "    >",
          "      <Text>Go</Text>",
          "    </Pressable>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      // Exactly one error: the missing label — the arrow's `>` inside braces
      // must not end the opening tag early or double-count the element.
      expect(status).toBe(1);
      expect(out).toContain("Errors: 1");
    });

    it("scanner pin: a quoted `>` before the label does not hide the label", () => {
      // If the string-literal handling broke, the element text would be cut at
      // `"a >` and the accessibilityLabel after it would be invisible — turning
      // a correctly-labeled element into a false ERROR.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "Quoted.tsx",
        'export const G = () => (\n  <Pressable onPress={go} testID="a > b" accessibilityLabel="Go">\n    <Text>Go</Text>\n  </Pressable>\n);\n',
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No accessibility issues found in 1 files");
    });
  });

  describe("no-arg mode (the CI / preflight path)", () => {
    it("discovers client/ and FAILS on a violation", () => {
      const root = makeRepo({
        "Bad.tsx":
          "export const H = () => <Pressable onPress={go}><Text>x</Text></Pressable>;\n",
      });
      const { status, out } = run(
        path.join(root, "scripts", "check-accessibility.js"),
        [],
      );
      expect(status).toBe(1);
      expect(out).toContain("Pressable with onPress");
    });

    it("scans the whole client tree on a clean repo — and says how many files", () => {
      const root = makeRepo({
        "A.tsx": "export const a = 1;\n",
        "B.tsx": "export const b = 2;\n",
      });
      const { status, out } = run(
        path.join(root, "scripts", "check-accessibility.js"),
        [],
      );
      expect(status, out).toBe(0);
      // Non-vacuity: a broken walker that finds nothing would also exit 0.
      expect(out).toContain("No accessibility issues found in 2 files");
    });
  });
});
