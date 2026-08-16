import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(__dirname, "..", "check-idor-storage.js");

/**
 * checkFile skips any path containing "__tests__" (and index.ts/helpers.ts),
 * so fixture roots must not accidentally contain a skip token. realpath
 * matters on macOS (/var vs /private/var).
 */
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "idor-")));
  tmpDirs.push(root);
  return root;
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

/**
 * No-arg mode resolves `__dirname/../server/storage`, so those tests copy the
 * script into `<tmp>/scripts/` and build `<tmp>/server/storage/` (same pattern
 * as check-rules-file-size.test.ts).
 */
function makeRepo(storageFiles: Record<string, string>): string {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "storage"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-idor-storage.js"),
  );
  for (const [name, content] of Object.entries(storageFiles)) {
    writeFixture(path.join(root, "server", "storage"), name, content);
  }
  return root;
}

describe("check-idor-storage.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("arg mode (the lint-staged path)", () => {
    it("flags an exported function taking an id-like param without a userId", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "meals.ts",
        "export async function getMealLogById(logId: number) {\n  return logId;\n}\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getMealLogById");
      expect(out).toContain("logId");
      expect(out).toContain("without a userId parameter");
      expect(out).toContain("Errors: 1");
    });

    it("flags a multi-line signature (params spanning several lines)", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "entries.ts",
        [
          "export async function updateNotebookEntry(",
          "  entryId: number,",
          "  data: Partial<Entry>,",
          ") {",
          "  return data;",
          "}",
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("updateNotebookEntry");
      expect(out).toContain("entryId");
    });

    it("passes a user-scoped function — and proves it scanned the file", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "recipes.ts",
        "export async function getRecipeForUser(recipeId: number, userId: string) {\n  return { recipeId, userId };\n}\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      // Non-vacuity: an empty scan also exits 0, so anchor the file count.
      expect(out).toContain("No IDOR-risk storage functions found in 1 files");
    });

    it("pins the // idor-safe opt-out on the declaration line (fail-open seam)", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "flags.ts",
        "export async function getFlagById(flagId: number) { // idor-safe\n  return flagId;\n}\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No IDOR-risk storage functions found in 1 files");
    });

    it("pins the ALLOWLIST exemption (fail-open seam — entries only ever grow)", () => {
      const dir = makeTmpDir();
      // getMealPlanRecipe is allowlisted in the script ("route verifies ownership").
      const file = writeFixture(
        dir,
        "mealplan.ts",
        "export async function getMealPlanRecipe(id: number) {\n  return id;\n}\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No IDOR-risk storage functions found in 1 files");
    });

    it("pins the known matcher blind spot: exported arrow consts are invisible", () => {
      // EXPORT_FN_START only matches `export [async] function name(` — an
      // exported arrow function with a naked id param passes the scan today.
      // Documented follow-up, not a behavior this test endorses; widening the
      // matcher requires re-auditing server/storage and the ALLOWLIST.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrows.ts",
        "export const getEntryById = async (entryId: number) => {\n  return entryId;\n};\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No IDOR-risk storage functions found in 1 files");
    });

    it("silently ignores a nonexistent path and reports a zero-file scan", () => {
      // Pinned fail-open: a deleted-but-staged path must not fail the commit.
      const dir = makeTmpDir();
      const { status, out } = run(realScript, [path.join(dir, "gone.ts")]);
      expect(status, out).toBe(0);
      expect(out).toContain("No IDOR-risk storage functions found in 0 files");
    });
  });

  describe("no-arg mode (the CI / preflight path)", () => {
    it("discovers server/storage and FAILS on a violation", () => {
      const root = makeRepo({
        "unsafe.ts":
          "export async function getSessionByToken(tokenId: string) {\n  return tokenId;\n}\n",
      });
      const { status, out } = run(
        path.join(root, "scripts", "check-idor-storage.js"),
        [],
      );
      expect(status).toBe(1);
      expect(out).toContain("getSessionByToken");
    });

    it("fails loudly when server/storage does not exist (fail-closed discovery)", () => {
      // Unlike the other checkers, a missing storage dir is exit 1 — a scan
      // that cannot find its subject must not report success.
      const root = makeTmpDir();
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      fs.copyFileSync(
        realScript,
        path.join(root, "scripts", "check-idor-storage.js"),
      );
      const { status, out } = run(
        path.join(root, "scripts", "check-idor-storage.js"),
        [],
      );
      expect(status).toBe(1);
      expect(out).toContain("Storage directory not found");
    });
  });
});
