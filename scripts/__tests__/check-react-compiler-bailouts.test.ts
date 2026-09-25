import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  findTsxFiles,
  isBailout,
  loadBaseline,
  writeBaseline,
  diffBailouts,
  parseArgs,
} from "../check-react-compiler-bailouts.js";

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "check-react-compiler-bailouts.js",
);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  // realpath matters on macOS: /var vs /private/var (see check-rules-file-size.test.ts).
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "rcbailout-")),
  );
  tmpDirs.push(root);
  return root;
}

const CLEAN_COMPONENT = `import { Text } from "react-native";

export function Clean({ label }: { label: string }) {
  return <Text>{label}</Text>;
}
`;

// try/finally is an unsupported construct in the pinned
// babel-plugin-react-compiler@1.0.0 (docs/solutions/conventions/
// react-compiler-discards-unread-usememo-dependency-2026-09-02.md's
// CORRECTION section) — a reliable, minimal way to force a real bailout.
const BROKEN_COMPONENT = `import { Text } from "react-native";

export function Broken({ label }: { label: string }) {
  try {
    return <Text>{label}</Text>;
  } finally {
    // no-op
  }
}
`;

function writeFile(root: string, relPath: string, content: string): string {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

/** A minimal fixture repo: client/components/ThemedText.tsx as a clean control. */
function makeFixtureRoot(): string {
  const root = makeTmpDir();
  writeFile(root, "client/components/ThemedText.tsx", CLEAN_COMPONENT);
  return root;
}

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

describe("check-react-compiler-bailouts", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("findTsxFiles", () => {
    it("finds .tsx files recursively, relative to root", () => {
      const root = makeTmpDir();
      writeFile(root, "client/components/A.tsx", CLEAN_COMPONENT);
      writeFile(root, "client/screens/nested/B.tsx", CLEAN_COMPONENT);
      const files = findTsxFiles(path.join(root, "client"), root).sort();
      expect(files).toEqual([
        "client/components/A.tsx",
        "client/screens/nested/B.tsx",
      ]);
    });

    it("excludes any path containing a __tests__ segment", () => {
      const root = makeTmpDir();
      writeFile(root, "client/components/A.tsx", CLEAN_COMPONENT);
      writeFile(
        root,
        "client/components/__tests__/A.test.tsx",
        CLEAN_COMPONENT,
      );
      const files = findTsxFiles(path.join(root, "client"), root);
      expect(files).toEqual(["client/components/A.tsx"]);
    });

    it("excludes node_modules and ignores non-.tsx files", () => {
      const root = makeTmpDir();
      writeFile(root, "client/components/A.tsx", CLEAN_COMPONENT);
      writeFile(root, "client/components/A.ts", "export const x = 1;\n");
      writeFile(root, "client/node_modules/pkg/Vendored.tsx", CLEAN_COMPONENT);
      const files = findTsxFiles(path.join(root, "client"), root);
      expect(files).toEqual(["client/components/A.tsx"]);
    });

    it("returns an empty array for a directory that does not exist", () => {
      const root = makeTmpDir();
      expect(findTsxFiles(path.join(root, "nope"), root)).toEqual([]);
    });
  });

  describe("isBailout", () => {
    it("returns false for a clean component", () => {
      const root = makeTmpDir();
      const file = writeFile(root, "Clean.tsx", CLEAN_COMPONENT);
      expect(isBailout(file)).toBe(false);
    });

    it("returns true for a component with a try/finally (unsupported construct)", () => {
      const root = makeTmpDir();
      const file = writeFile(root, "Broken.tsx", BROKEN_COMPONENT);
      expect(isBailout(file)).toBe(true);
    });

    it("returns true when the transform throws (invalid syntax)", () => {
      const root = makeTmpDir();
      const file = writeFile(root, "Invalid.tsx", "export function( {\n");
      expect(isBailout(file)).toBe(true);
    });

    // Regression pin for the classification bug found while writing this
    // script: checking `events.length > 0` instead of the event *kind* flags
    // 225/226 real files, because CompileSuccess is itself a logged event.
    it("PIN: does not flag a file solely for producing a CompileSuccess event", () => {
      const root = makeTmpDir();
      const file = writeFile(root, "Clean.tsx", CLEAN_COMPONENT);
      // A component with more than one exported function produces multiple
      // CompileSuccess events for a single file — still not a bailout.
      const multiComponent =
        CLEAN_COMPONENT +
        `
export function CleanToo({ label }: { label: string }) {
  return <Text>{label}</Text>;
}
`;
      fs.writeFileSync(file, multiComponent);
      expect(isBailout(file)).toBe(false);
    });

    it("real repo pin: the positive control (ThemedText.tsx) compiles clean", () => {
      const control = path.join(REPO_ROOT, "client/components/ThemedText.tsx");
      expect(isBailout(control)).toBe(false);
    });

    it("real repo pin: a known baseline file still bails out", () => {
      // If this ever flips to false, the file was fixed — shrink
      // scripts/react-compiler-bailout-baseline.json via --update-baseline
      // rather than "fixing" this test.
      const known = path.join(REPO_ROOT, "client/components/Button.tsx");
      expect(isBailout(known)).toBe(true);
    });
  });

  describe("loadBaseline", () => {
    it("returns an empty array (ok) when the file does not exist", () => {
      const root = makeTmpDir();
      const result = loadBaseline(path.join(root, "nope.json"));
      expect(result).toEqual({ kind: "ok", data: [] });
    });

    it("reads a valid JSON array", () => {
      const root = makeTmpDir();
      const file = path.join(root, "baseline.json");
      fs.writeFileSync(file, JSON.stringify(["a.tsx", "b.tsx"]));
      expect(loadBaseline(file)).toEqual({
        kind: "ok",
        data: ["a.tsx", "b.tsx"],
      });
    });

    it("errors on malformed JSON", () => {
      const root = makeTmpDir();
      const file = path.join(root, "baseline.json");
      fs.writeFileSync(file, "{not json");
      const result = loadBaseline(file);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.message).toContain("Could not parse");
    });

    it("errors when the JSON is not an array", () => {
      const root = makeTmpDir();
      const file = path.join(root, "baseline.json");
      fs.writeFileSync(file, JSON.stringify({ a: 1 }));
      const result = loadBaseline(file);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.message).toContain("not a JSON array");
    });
  });

  describe("writeBaseline", () => {
    it("writes a sorted, de-duplicated array and round-trips through loadBaseline", () => {
      const root = makeTmpDir();
      const file = path.join(root, "baseline.json");
      const written = writeBaseline(["b.tsx", "a.tsx", "a.tsx"], file);
      expect(written).toEqual(["a.tsx", "b.tsx"]);
      expect(loadBaseline(file)).toEqual({
        kind: "ok",
        data: ["a.tsx", "b.tsx"],
      });
    });
  });

  describe("diffBailouts", () => {
    it("finds new bailouts not present in the baseline", () => {
      const { newBailouts, fixed } = diffBailouts(
        ["a.tsx", "b.tsx"],
        ["a.tsx"],
      );
      expect(newBailouts).toEqual(["b.tsx"]);
      expect(fixed).toEqual([]);
    });

    it("finds baseline entries that no longer bail out (fixed)", () => {
      const { newBailouts, fixed } = diffBailouts(
        ["a.tsx"],
        ["a.tsx", "b.tsx"],
      );
      expect(newBailouts).toEqual([]);
      expect(fixed).toEqual(["b.tsx"]);
    });

    it("reports neither when current matches baseline exactly", () => {
      const { newBailouts, fixed } = diffBailouts(["a.tsx"], ["a.tsx"]);
      expect(newBailouts).toEqual([]);
      expect(fixed).toEqual([]);
    });
  });

  describe("parseArgs", () => {
    it("defaults to no update, the repo root, and the checked-in baseline", () => {
      const parsed = parseArgs([]);
      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      expect(parsed.updateMode).toBe(false);
      expect(
        parsed.baselineFile.endsWith("react-compiler-bailout-baseline.json"),
      ).toBe(true);
    });

    it("accepts --update-baseline, --root, and --baseline-file", () => {
      const parsed = parseArgs([
        "--update-baseline",
        "--root",
        "/tmp/some-root",
        "--baseline-file",
        "/tmp/some-baseline.json",
      ]);
      expect(parsed.kind).toBe("ok");
      if (parsed.kind !== "ok") return;
      expect(parsed.updateMode).toBe(true);
      expect(parsed.root).toBe(path.resolve("/tmp/some-root"));
      expect(parsed.baselineFile).toBe(path.resolve("/tmp/some-baseline.json"));
    });

    it("rejects an unknown argument instead of silently ignoring it", () => {
      const parsed = parseArgs(["--bogus"]);
      expect(parsed.kind).toBe("error");
      if (parsed.kind !== "error") return;
      expect(parsed.message).toContain("Unknown argument");
    });
  });

  describe("CLI", () => {
    it("exits 0 with a notice when the root has no client/ directory", () => {
      const root = makeTmpDir();
      const { status, out } = runCli(["--root", root]);
      expect(status).toBe(0);
      expect(out).toContain("client/ directory not found");
    });

    it("exits 2 when the positive control file is missing", () => {
      const root = makeTmpDir();
      fs.mkdirSync(path.join(root, "client"), { recursive: true });
      const { status, out } = runCli(["--root", root]);
      expect(status).toBe(2);
      expect(out).toContain("Positive control file missing");
    });

    it("exits 2 (harness error) when the positive control itself bails out", () => {
      const root = makeTmpDir();
      writeFile(root, "client/components/ThemedText.tsx", BROKEN_COMPONENT);
      const { status, out } = runCli(["--root", root]);
      expect(status).toBe(2);
      expect(out).toContain("Harness error");
    });

    it("exits 1 and lists a new bailout not in the baseline", () => {
      const root = makeFixtureRoot();
      writeFile(root, "client/components/NewlyBroken.tsx", BROKEN_COMPONENT);
      const baselineFile = path.join(root, "baseline.json");
      writeBaseline([], baselineFile);
      const { status, out } = runCli([
        "--root",
        root,
        "--baseline-file",
        baselineFile,
      ]);
      expect(status).toBe(1);
      expect(out).toContain("client/components/NewlyBroken.tsx");
      expect(out).toContain("--update-baseline");
    });

    it("exits 0 when every bailout is already in the baseline", () => {
      const root = makeFixtureRoot();
      writeFile(root, "client/components/KnownBroken.tsx", BROKEN_COMPONENT);
      const baselineFile = path.join(root, "baseline.json");
      writeBaseline(["client/components/KnownBroken.tsx"], baselineFile);
      const { status, out } = runCli([
        "--root",
        root,
        "--baseline-file",
        baselineFile,
      ]);
      expect(status, out).toBe(0);
      expect(out).toContain("0 new");
    });

    it("reports a fixed file (in baseline, no longer bailing) without failing", () => {
      const root = makeFixtureRoot();
      const baselineFile = path.join(root, "baseline.json");
      // Baseline claims a file bails out, but it does not exist on disk at
      // all any more (the strongest form of "no longer bails out").
      writeBaseline(["client/components/LongGoneFixed.tsx"], baselineFile);
      const { status, out } = runCli([
        "--root",
        root,
        "--baseline-file",
        baselineFile,
      ]);
      expect(status, out).toBe(0);
      expect(out).toContain("no longer bail out (fixed!)");
      expect(out).toContain("client/components/LongGoneFixed.tsx");
    });

    it("--update-baseline writes the current bailout set and exits 0", () => {
      const root = makeFixtureRoot();
      writeFile(root, "client/components/NewlyBroken.tsx", BROKEN_COMPONENT);
      const baselineFile = path.join(root, "baseline.json");
      const { status, out } = runCli([
        "--root",
        root,
        "--baseline-file",
        baselineFile,
        "--update-baseline",
      ]);
      expect(status, out).toBe(0);
      expect(out).toContain("baseline updated");
      expect(loadBaseline(baselineFile)).toEqual({
        kind: "ok",
        data: ["client/components/NewlyBroken.tsx"],
      });
    });

    it("exits 2 on an unknown argument", () => {
      const { status, out } = runCli(["--nope"]);
      expect(status).toBe(2);
      expect(out).toContain("Unknown argument");
    });
  });
});
