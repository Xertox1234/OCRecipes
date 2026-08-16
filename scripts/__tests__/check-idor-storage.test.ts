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

    it("detects an exported async arrow-function const with a naked id param", () => {
      // EXPORT_FN_START now also matches `export const name = [async] (` —
      // an exported arrow function with a naked id param is caught.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrows.ts",
        "export const getEntryById = async (entryId: number) => {\n  return entryId;\n};\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getEntryById");
      expect(out).toContain("entryId");
      expect(out).toContain("without a userId parameter");
    });

    it("detects an exported sync (non-async) arrow-function const with a naked id param", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrows-sync.ts",
        "export const getEntryByIdSync = (entryId: number) => {\n  return entryId;\n};\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getEntryByIdSync");
      expect(out).toContain("entryId");
      expect(out).toContain("without a userId parameter");
    });

    it("flags a multi-line arrow-export signature (params spanning several lines)", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrow-multiline.ts",
        [
          "export const updateGroceryNote = async (",
          "  noteId: number,",
          "  data: Partial<Note>,",
          ") => {",
          "  return data;",
          "}",
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("updateGroceryNote");
      expect(out).toContain("noteId");
    });

    it("detects an arrow export whose const carries a type annotation", () => {
      // `: Getter` sits between the name and `=`, which the first widening of
      // EXPORT_FN_START (`(\w+)\s*=`) could not cross.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrow-typed.ts",
        "export const getEntryByIdTyped: Getter = async (entryId: number) => {\n  return entryId;\n};\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getEntryByIdTyped");
      expect(out).toContain("entryId");
      expect(out).toContain("without a userId parameter");
    });

    it("detects a generic arrow export (type params between async and the parens)", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrow-generic.ts",
        "export const getEntryByIdGeneric = async <T,>(entryId: number) => {\n  return entryId as T;\n};\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getEntryByIdGeneric");
      expect(out).toContain("entryId");
      expect(out).toContain("without a userId parameter");
    });

    it("detects a generic function declaration (type params between name and parens)", () => {
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "fn-generic.ts",
        "export async function getEntryByIdFnGeneric<T>(entryId: number) {\n  return entryId as T;\n}\n",
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getEntryByIdFnGeneric");
      expect(out).toContain("entryId");
    });

    it("ignores parenthesised non-function consts (no `=>` after the closing paren)", () => {
      // The arrow branch matches on `= (`, so these would otherwise be reported
      // as IDOR-risk "functions" — training developers to add `// idor-safe`
      // or an ALLOWLIST entry to something that is not a function at all.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "non-functions.ts",
        [
          "export const cache = (recipeId);",
          "export const LIMIT = (MAX_recipeId + 1);",
          "export const cachedIds = (() => { const recipeId = 1; return recipeId; })();",
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      expect(status, out).toBe(0);
      expect(out).toContain("No IDOR-risk storage functions found in 1 files");
    });

    it("parses arrow exports rather than skipping them — flags only the unscoped one", () => {
      // Discriminating by construction: with the pre-widening regex BOTH
      // exports are invisible and the run exits 0, so naming exactly one of
      // them proves the arrow branch matched and then judged each on its params.
      const dir = makeTmpDir();
      const file = writeFixture(
        dir,
        "arrows-safe.ts",
        [
          "export const getEntryForUser = async (entryId: number, userId: string) => {",
          "  return { entryId, userId };",
          "};",
          "export const getEntryById = async (entryId: number) => entryId;",
          "",
        ].join("\n"),
      );
      const { status, out } = run(realScript, [file]);
      expect(status).toBe(1);
      expect(out).toContain("getEntryById");
      expect(out).not.toContain("getEntryForUser");
      expect(out).toContain("Errors: 1");
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
