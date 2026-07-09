#!/usr/bin/env tsx
/**
 * scripts/pg-lab/symbol-graph.ts — TypeScript module-import/export graph snapshot
 * (PG Lab Batch C), backed by the ocrecipes_lab lab DB: repo.modules / repo.imports /
 * repo.exports / repo.snapshot_meta — see scripts/pg-lab/schema/symbol-graph.sql.
 *
 * Snapshot-only: `--rebuild` is the ONLY mode. There is no incremental update — every run
 * fully re-derives the graph from source and replaces the tables wholesale (TRUNCATE +
 * repopulate; the tables themselves are never dropped, matching the
 * scripts/pg-lab/codify-neardup.sh precedent). Staleness between rebuilds is expected
 * ("Nightly-manual, not a hook" per the owning todo's Implementation Notes) — the recorded
 * git SHA + timestamp in repo.snapshot_meta is what lets scripts/pg-lab/symbol-graph.sh
 * state that staleness on every query instead of hiding it.
 *
 * Usage:
 *   tsx scripts/pg-lab/symbol-graph.ts --rebuild [--project <path-to-tsconfig.json>]
 *
 * --project overrides which tsconfig ts-morph loads (default: <repo-root>/tsconfig.json).
 * This is the test seam: .claude/hooks/test-pg-lab-symbol-graph.sh points it at a small
 * fixture tsconfig instead of the real monorepo, mirroring codify-neardup.sh's
 * PG_LAB_SOLUTIONS_DIR seam. The directory containing whichever tsconfig is loaded is
 * treated as "repo root" for the purpose of computing repo-relative module paths, so a
 * fixture project's own file layout (e.g. `server/routes/x.ts`) round-trips through the
 * same canned queries as the real repo.
 *
 * Alias resolution ("@/", "@shared/", or whatever a fixture tsconfig declares): ts-morph's
 * Project, built from the tsconfig's `compilerOptions.paths`, resolves aliases NATIVELY for
 * every static `import`/`export ... from` declaration via
 * `getModuleSpecifierSourceFile()` — no hand-rolled alias-root table is needed for those,
 * unlike scripts/worklet-directive-guard.ts (which uses the raw `typescript` compiler API
 * and therefore hand-resolves aliases itself). A small hand-rolled resolver
 * (`resolveModuleBase`, reusing that file's alias/suffix-guessing shape) is still needed,
 * but ONLY for the string literal inside a dynamic `import(...)`, `require(...)`, or
 * `vi.mock(...)`/`jest.mock(...)` call — those are plain CallExpressions, not import
 * declarations, so ts-morph's declaration-level resolution doesn't see them at all. Per
 * the owning todo's Implementation Notes, these ARE real edges (a test file that
 * `vi.mock('@/lib/foo')`s a module has a real dependency on it) and are captured here so
 * blast-radius/cycle queries don't miss them — but the alias table used to resolve them is
 * still read dynamically from the SAME tsconfig (`buildAliasRoots`), never hardcoded, so it
 * can't drift from the real `@/`/`@shared/` config the todo's AC requires.
 *
 * ref_count (two-pass — see the repo.exports comment in the schema file for the "why"):
 *   Pass 1 (cheap): one project-wide walk collecting every named-import/re-export binding
 *   (from static ImportDeclarations/ExportDeclarations only) into a
 *   `Map<"<toPath>::<name>", count>`. Pure AST enumeration — no type-checker/symbol
 *   resolution, so it's cheap even across shared/schema.ts's 40+ table exports.
 *   Pass 2 (per-candidate, expensive): for each export whose pass-1 count is 0,
 *   `findReferencesAsNodes()` on its declaration — a real, project-wide, symbol-aware
 *   reference count (the raw node count IS the external-usage count: verified empirically
 *   that ts-morph's findReferencesAsNodes() returns only usage sites, never the
 *   declaration's own name node, so no "minus 1" adjustment is needed or correct -- EXCEPT
 *   a barrel's own `export {x} from "./y"` specifier, which DOES show up as a spurious
 *   reference and must be filtered out; see findReferencesCount's ExportSpecifier check).
 *   This is the ONLY class of export that pays for the expensive check. It matters a great deal in
 *   practice: this repo's `server/storage/index.ts` re-exports every domain module via
 *   `import * as users from "./users"` (a NAMESPACE import), so pass 1 alone would
 *   misreport nearly every storage-domain export as "0 references" — pass 2 is what
 *   correctly resolves `storage.getUser(...)`-style namespace/property access (and
 *   same-file-only usage) back to the real declaration before anything is called dead.
 *
 * DB write: unlike codify-neardup.sh (bash + `psql -f` + `\copy` CSV), this script uses the
 * `pg` package directly (already a project dependency via drizzle-orm's Postgres driver).
 * The whole tool is inherently TS/node-based (ts-morph has no bash equivalent), so a second
 * CSV round-trip through awk-generated Postgres array literals for the `names text[]`
 * column would be pure overhead — node-postgres serializes a JS string array into a
 * `text[]` parameter natively.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import pg from "pg";
import {
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  type CompilerOptions,
} from "ts-morph";

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_TSCONFIG = path.join(REPO_ROOT, "tsconfig.json");
const SCHEMA_FILE = path.join(__dirname, "schema/symbol-graph.sql");

// Hard safety rail, mirroring scripts/pg-lab/init.sh and codify-neardup.sh: this tool must
// never write into a real app database, no matter what LAB_DATABASE_URL is set to.
function assertSafeLabUrl(url: string): void {
  const dbName = url.split("/").pop() ?? "";
  if (dbName === "nutricam" || dbName === "ocrecipes_solutions") {
    throw new Error(
      `symbol-graph.ts: refusing — LAB_DATABASE_URL resolves to '${dbName}', a real app database, not a PG Lab database`,
    );
  }
}

function getGitSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null; // not a git repo (e.g. the test fixture) -- staleness reporting degrades gracefully
  }
}

/** Read the client entrypoint path out of `package.json`'s "main" field instead of a
 * hardcoded literal -- `main` is this repo's actual, git-history-stable source of truth
 * for "the" registered root entrypoint (Metro/Expo resolve it the same way), so a future
 * rename only requires editing package.json, not this script too. Only called for the
 * real-repo config (never the test fixture, which has no package.json and doesn't take
 * this code path -- see loadProject's isDefaultRepoConfig guard). */
function readMainEntrypoint(configDir: string): string {
  const packageJsonPath = path.join(configDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    main?: string;
  };
  if (typeof pkg.main !== "string" || pkg.main.length === 0) {
    throw new Error(
      `readMainEntrypoint: package.json has no "main" field at ${packageJsonPath} -- symbol-graph.ts's loadProject depends on this to find the client entrypoint file.`,
    );
  }
  return pkg.main;
}

/** Build the alias-prefix -> absolute-root-dir table from the SAME tsconfig ts-morph
 * loaded (compilerOptions.paths / baseUrl) -- never hardcoded, so it can't drift from the
 * real `@/`/`@shared/` config (or a fixture's own aliases in tests). */
function buildAliasRoots(
  compilerOptions: CompilerOptions,
  configDir: string,
): Record<string, string> {
  const baseDir = compilerOptions.baseUrl
    ? path.resolve(configDir, compilerOptions.baseUrl)
    : configDir;
  const roots: Record<string, string> = {};
  for (const [key, targets] of Object.entries(compilerOptions.paths ?? {})) {
    if (!targets || targets.length === 0) continue;
    const prefix = key.replace(/\/\*$/, "");
    const target = targets[0].replace(/\/\*$/, "");
    roots[prefix] = path.resolve(baseDir, target);
  }
  return roots;
}

/** Resolve a relative or aliased module specifier to a base path (no extension yet).
 * Returns null for a bare package specifier (node_modules) -- those are out of scope, same
 * as scripts/worklet-directive-guard.ts's resolveModuleBase. ONLY used for dynamic
 * import()/require()/vi.mock() string literals -- static import/export declarations are
 * resolved by ts-morph itself via getModuleSpecifierSourceFile(). */
function resolveModuleBase(
  fromAbsPath: string,
  specifier: string,
  aliasRoots: Record<string, string>,
): string | null {
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromAbsPath), specifier);
  }
  for (const [alias, root] of Object.entries(aliasRoots)) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      const rest = specifier.slice(alias.length).replace(/^\//, "");
      return rest ? path.join(root, rest) : root;
    }
  }
  return null;
}

const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Match a resolved-but-extensionless base path against the set of source files ts-morph
 * actually loaded, trying the same extension/index-file guesses as
 * scripts/worklet-directive-guard.ts's readResolvedFile. */
function resolveToLoadedSourceFile(
  basePath: string,
  loadedPaths: ReadonlySet<string>,
): string | null {
  if (loadedPaths.has(basePath)) return basePath;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = basePath + suffix;
    if (loadedPaths.has(candidate)) return candidate;
  }
  return null;
}

const DYNAMIC_CALLEE_NAMES = new Set(["require", "vi.mock", "jest.mock"]);

/** Every dynamic import()/require()/vi.mock()/jest.mock() call in `sourceFile` whose first
 * argument is a string literal that resolves to another file ts-morph loaded. Capturing
 * these as edges (even though their imported NAMES can't be statically enumerated from the
 * call site) is what the owning todo's Implementation Notes call out explicitly --
 * omitting them would under-count blast radius and mis-classify modules as unreachable. */
function collectDynamicEdgeTargets(
  sourceFile: SourceFile,
  aliasRoots: Record<string, string>,
  loadedPaths: ReadonlySet<string>,
): string[] {
  const targets: string[] = [];
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    if (!isDynamicImport && !DYNAMIC_CALLEE_NAMES.has(callee.getText())) return;

    const [firstArg] = node.getArguments();
    if (!firstArg || !Node.isStringLiteral(firstArg)) return; // not statically resolvable

    const base = resolveModuleBase(
      sourceFile.getFilePath(),
      firstArg.getLiteralValue(),
      aliasRoots,
    );
    if (!base) return;
    const resolved = resolveToLoadedSourceFile(base, loadedPaths);
    if (resolved) targets.push(resolved);
  });
  return targets;
}

/** A declaration is reference-findable in ts-morph when it (or its name node) implements
 * `findReferencesAsNodes()` -- true for FunctionDeclaration, ClassDeclaration,
 * VariableDeclaration, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration, and
 * similar named declarations, but not every member of ts-morph's broad
 * `ExportedDeclarations` union (e.g. a bare expression in `export default <expr>`).
 * `Node.isReferenceFindable()` is ts-morph's own type guard for exactly this mixin --
 * preferred over a hand-rolled `as unknown as {...}` duck-type cast (banned by this
 * project's TypeScript conventions), with identical runtime behavior. An unsupported
 * declaration kind degrades to "leave the cheap (zero) count as-is" instead of throwing. */
function findReferencesCount(declaration: Node): number {
  if (!Node.isReferenceFindable(declaration)) return 0;
  // No "subtract the declaration's own occurrence" adjustment: verified empirically (a
  // throwaway ts-morph script against a synthetic fixture) that findReferencesAsNodes()
  // returns ONLY external usage-site nodes, never the declaration's own name node -- a
  // genuinely unused export returns length 0, and one real call site returns length 1. An
  // earlier version of this function subtracted 1 on the (wrong) assumption that the
  // declaration itself was always included, which floored every single-usage export's
  // ref_count to 0 and misreported it as dead -- caught by the fixture test's
  // namespace-import assertion (server/routes/orders.ts's `storageInternal
  // .getOrderInternal()` access).
  //
  // findReferencesAsNodes() DOES count a barrel's `export { x } from "./y"` specifier as a
  // reference to `x` -- verified empirically against a synthetic fixture (a name node whose
  // parent is an ExportSpecifier under an ExportDeclaration with a module specifier). That
  // is the SAME pass-through-is-not-a-use bug the ImportEdge.kind/cheapCounts fix addresses
  // for pass 1, reached via pass 2 instead: a barrel-only-re-exported export with zero real
  // importers would otherwise still report ref_count 1 here even after the cheapCounts fix,
  // since the barrel's own re-export specifier is the "reference" being counted. A LOCAL
  // `export { x }` (no `from` clause, i.e. no module specifier) is not a re-export edge --
  // it genuinely exposes the declaration under a public name and still counts.
  return declaration.findReferencesAsNodes().filter((ref) => {
    const parent = ref.getParent();
    if (!Node.isExportSpecifier(parent)) return true;
    // getExportDeclaration() is ts-morph's own non-optional accessor for an
    // ExportSpecifier's owning ExportDeclaration -- preferred over hand-walking
    // parent.getParent() twice, since it can't silently resolve the wrong ancestor if a
    // future ts-morph version changes the AST's exact nesting depth.
    return !parent.getExportDeclaration().hasModuleSpecifier();
  }).length;
}

interface ImportEdge {
  fromPath: string;
  toPath: string;
  names: string[];
  // "import" -- a genuine ImportDeclaration or dynamic import()/require()/vi.mock() edge:
  // the FROM file actually consumes the named bindings, so it counts as a reference.
  // "reexport" -- a barrel's `export {...} from "./y"` / `export * from "./y"`: the FROM
  // file merely passes the binding through without consuming it itself. The edge is still
  // real for blast-radius/cycle purposes (changing `y.ts` can affect the barrel and its own
  // consumers), so it stays in `imports`, but it must NOT count as a reference to the names
  // it re-exports -- a barrel's mere re-export of `x` is not a USE of `x` (see cheapCounts).
  kind: "import" | "reexport";
}

interface ExportRow {
  path: string;
  name: string;
  refCount: number;
}

interface ExtractedGraph {
  modules: string[];
  imports: ImportEdge[];
  exportsList: ExportRow[];
}

function loadProject(tsConfigFilePath: string): Project {
  const isDefaultRepoConfig = tsConfigFilePath === DEFAULT_TSCONFIG;
  const project = new Project({
    tsConfigFilePath,
    // For the real repo, add files ourselves (scoped, see below) instead of letting
    // ts-morph glob-add everything the tsconfig's `include` matches -- the owning todo's
    // Risks section flags full-monorepo load time as a real cost to manage. A test
    // fixture's tiny tsconfig is left on the default (auto-add) path since it has only a
    // handful of files.
    skipAddingFilesFromTsConfig: isDefaultRepoConfig,
    compilerOptions: { skipLibCheck: true },
  });
  if (isDefaultRepoConfig) {
    const configDir = path.dirname(tsConfigFilePath);
    // The app's registered root entrypoint (package.json "main",
    // `registerRootComponent(App)`) -- read from package.json itself (readMainEntrypoint),
    // never a hardcoded literal, so a future rename only requires editing package.json --
    // is a plain .js file, so the "client/**/*.{ts,tsx}" glob below never matches it,
    // making it (and its one real edge into client/App.tsx) invisible to blast/cycles
    // entirely, not just ref-counting. ts-morph parses an explicitly-added .js file fine
    // without "allowJs" in the tsconfig (verified empirically) -- this is the ONLY
    // root-level .js entrypoint in the tracked repo (the sibling root-level `/index.js` is
    // a gitignored build artifact, not source). Added as an exact path, not a broader
    // glob, to avoid pulling in unrelated .js files under client/ (there are none today,
    // but a future one shouldn't silently join the graph without a deliberate glob
    // change).
    const entryPointPath = path.join(configDir, readMainEntrypoint(configDir));
    const added = project.addSourceFilesAtPaths([
      path.join(configDir, "server/**/*.ts"),
      path.join(configDir, "client/**/*.{ts,tsx}"),
      path.join(configDir, "shared/**/*.ts"),
      path.join(configDir, "scripts/**/*.ts"),
      entryPointPath,
    ]);
    // addSourceFilesAtPaths() silently adds zero files for a literal path that matches
    // nothing -- no throw, no warning (verified against ts-morph's glob-based
    // implementation). Without this check, a future rename/move of the package.json
    // "main" entrypoint (or a stale "main" field pointing at a moved file) would silently
    // drop its edge into client/App.tsx from the graph -- and since symbol-graph.sh's
    // dead-exports allowlist no longer carries a client/App.tsx fallback entry (removed
    // once this entrypoint edge made it unnecessary), App.tsx would start silently
    // false-flagging as dead with no test catching it.
    if (!added.some((sf) => sf.getFilePath() === entryPointPath)) {
      throw new Error(
        `loadProject: expected entrypoint not found at ${entryPointPath} -- did package.json's "main" field move or get renamed? symbol-graph.sh's dead-exports allowlist depends on this file being scanned.`,
      );
    }
  }
  return project;
}

function extractGraph(
  project: Project,
  root: string,
  aliasRoots: Record<string, string>,
): ExtractedGraph {
  const sourceFiles = project.getSourceFiles();
  const loadedPaths = new Set(sourceFiles.map((sf) => sf.getFilePath()));
  const rel = (absPath: string) =>
    path.relative(root, absPath).split(path.sep).join("/");

  const modules: string[] = [];
  const imports: ImportEdge[] = [];
  const exportCandidates: { path: string; name: string; declaration: Node }[] =
    [];

  for (const sourceFile of sourceFiles) {
    const fromAbs = sourceFile.getFilePath();
    const fromPath = rel(fromAbs);
    modules.push(fromPath);

    for (const decl of sourceFile.getImportDeclarations()) {
      // `import type {...} from "./y"` is erased entirely at compile time -- no runtime
      // edge exists, so recording one would inflate blast/cycles/layering with
      // compile-time-only relationships (verified empirically against this repo's real
      // graph: RN navigation param types produce exactly this cross-file type-only
      // circularity, which is completely benign at runtime).
      if (decl.isTypeOnly()) continue;
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue; // bare package specifier -- out of scope
      const names: string[] = [];
      if (decl.getDefaultImport()) names.push("default");
      // Namespace imports (`import * as x from "./y"`) contribute NO discrete name to the
      // cheap pass -- every export of the target lands in pass 2 for those, which is
      // exactly the case this repo's server/storage/index.ts barrel exercises.
      for (const spec of decl.getNamedImports()) {
        if (spec.isTypeOnly()) continue; // inline `{ type Foo, bar }` -- Foo has no runtime edge
        names.push(spec.getName());
      }
      imports.push({
        fromPath,
        toPath: rel(target.getFilePath()),
        names,
        kind: "import",
      });
    }

    for (const decl of sourceFile.getExportDeclarations()) {
      if (decl.isTypeOnly()) continue; // `export type {...} from "./y"` -- same rationale as above
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue; // a local `export { x }` with no module specifier
      const names: string[] = [];
      for (const spec of decl.getNamedExports()) {
        if (spec.isTypeOnly()) continue;
        names.push(spec.getName());
      }
      // `export * from "./y"` (decl.isNamespaceExport()) contributes no discrete name,
      // same rationale as a namespace import above. kind: "reexport" -- see the ImportEdge
      // comment for why this must not feed cheapCounts.
      imports.push({
        fromPath,
        toPath: rel(target.getFilePath()),
        names,
        kind: "reexport",
      });
    }

    for (const toAbsPath of collectDynamicEdgeTargets(
      sourceFile,
      aliasRoots,
      loadedPaths,
    )) {
      imports.push({
        fromPath,
        toPath: rel(toAbsPath),
        names: [],
        kind: "import",
      });
    }

    for (const [name, decls] of sourceFile.getExportedDeclarations()) {
      if (decls.length === 0) continue;
      // getExportedDeclarations() returns a re-exported symbol's declaration under BOTH
      // the file that declares it AND every barrel that re-exports it (`export { x } from
      // "./y"` / `export * from "./y"`) -- verified empirically against this repo's
      // server/storage/index.ts-style barrels (33 `export {...} from` lines repo-wide).
      // Recording a candidate at every re-exporting path would insert duplicate
      // repo.exports rows for the same underlying declaration, and since a barrel is
      // exactly the case where the ORIGIN file's own cheap-pass count is 0 (most callers
      // import from the barrel, not the origin file directly), the origin-file row would
      // misreport a used symbol as dead. Only record the candidate at the declaration's
      // true origin file.
      if (decls[0].getSourceFile().getFilePath() !== fromAbs) continue;
      exportCandidates.push({ path: fromPath, name, declaration: decls[0] });
    }
  }

  const cheapCounts = new Map<string, number>();
  for (const edge of imports) {
    // A barrel's mere re-export of `x` is not a USE of `x` -- skip "reexport" edges here so
    // a barrel that pass-throughs an export nobody actually imports doesn't inflate its
    // ref_count and mask it as used (see the ImportEdge.kind comment).
    if (edge.kind === "reexport") continue;
    for (const name of edge.names) {
      const key = `${edge.toPath}::${name}`;
      cheapCounts.set(key, (cheapCounts.get(key) ?? 0) + 1);
    }
  }

  const exportsList: ExportRow[] = exportCandidates.map(
    ({ path: exportPath, name, declaration }) => {
      const cheap = cheapCounts.get(`${exportPath}::${name}`) ?? 0;
      const refCount = cheap > 0 ? cheap : findReferencesCount(declaration);
      return { path: exportPath, name, refCount };
    },
  );

  return { modules, imports, exportsList };
}

async function bulkInsert(
  client: pg.PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  if (rows.length === 0) return;
  const CHUNK = 500; // keeps well under Postgres's 65535-parameter-per-query limit
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk.map((row, i) => {
      const base = i * columns.length;
      values.push(...row);
      return `(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

async function rebuildDb(
  pool: pg.Pool,
  extracted: ExtractedGraph,
  sha: string | null,
): Promise<void> {
  // Count-and-fail-on-zero (docs/solutions/logic-errors/glob-runner-loop-fails-open-count-
  // and-fail-on-zero-2026-07-03.md): an empty scan must never silently truncate the tables.
  if (extracted.modules.length === 0) {
    throw new Error(
      "0 modules scanned -- refusing to truncate repo.* (fail-on-zero guard)",
    );
  }

  const client = await pool.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    // Apply the schema defensively (idempotent, IF NOT EXISTS everywhere) so --rebuild
    // works even if scripts/pg-lab/init.sh alone was run and this item's tables don't
    // exist yet. Deliberately INSIDE this transaction (unlike codify-neardup.sh, which
    // applies its schema via a separate up-front `psql -f` outside its later
    // BEGIN/TRUNCATE/COMMIT) -- every statement here is IF-NOT-EXISTS-guarded DDL, and
    // Postgres DDL is fully transactional, so folding it in makes the whole rebuild
    // strictly all-or-nothing. Not a bug in the sibling script; just a shape this file
    // doesn't need to match.
    await client.query(fs.readFileSync(SCHEMA_FILE, "utf8"));

    await client.query("TRUNCATE repo.modules, repo.imports, repo.exports");

    await bulkInsert(
      client,
      "repo.modules",
      ["path"],
      extracted.modules.map((m) => [m]),
    );
    await bulkInsert(
      client,
      "repo.imports",
      ["from_path", "to_path", "names"],
      extracted.imports.map((e) => [e.fromPath, e.toPath, e.names]),
    );
    await bulkInsert(
      client,
      "repo.exports",
      ["path", "name", "ref_count"],
      extracted.exportsList.map((e) => [e.path, e.name, e.refCount]),
    );

    await client.query(
      `INSERT INTO repo.snapshot_meta (id, sha, rebuilt_at) VALUES (true, $1, now())
       ON CONFLICT (id) DO UPDATE SET sha = EXCLUDED.sha, rebuilt_at = EXCLUDED.rebuilt_at`,
      [sha],
    );

    await client.query("COMMIT");
  } catch (err) {
    // A failed ROLLBACK must not swallow the ORIGINAL error -- and per node-postgres
    // convention, release() needs the error passed through so the pool destroys (rather
    // than reuses) a client left in an unknown transaction state.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      client.release(rollbackErr as Error);
      released = true;
      throw err;
    }
    throw err;
  } finally {
    if (!released) client.release();
  }
}

export function runSymbolGraphCli(argv: readonly string[]): {
  rebuild: boolean;
  tsConfigFilePath: string;
} {
  const args = [...argv];
  const rebuild = args.includes("--rebuild");
  const projectIdx = args.indexOf("--project");
  const tsConfigFilePath =
    projectIdx !== -1 && args[projectIdx + 1]
      ? path.resolve(args[projectIdx + 1])
      : DEFAULT_TSCONFIG;
  return { rebuild, tsConfigFilePath };
}

async function main(): Promise<void> {
  const { rebuild, tsConfigFilePath } = runSymbolGraphCli(
    process.argv.slice(2),
  );
  if (!rebuild) {
    console.error(
      "Usage: tsx scripts/pg-lab/symbol-graph.ts --rebuild [--project <tsconfig-path>]",
    );
    process.exit(2);
    return;
  }
  if (!fs.existsSync(tsConfigFilePath)) {
    console.error(`symbol-graph.ts: tsconfig not found at ${tsConfigFilePath}`);
    process.exit(1);
    return;
  }

  const labUrl =
    process.env.LAB_DATABASE_URL ?? "postgresql://localhost/ocrecipes_lab";
  assertSafeLabUrl(labUrl);

  console.log(`▶ loading ts-morph project from ${tsConfigFilePath}`);
  const project = loadProject(tsConfigFilePath);
  const configDir = path.dirname(tsConfigFilePath);
  const aliasRoots = buildAliasRoots(project.getCompilerOptions(), configDir);

  console.log(
    `▶ extracting graph (${project.getSourceFiles().length} source files)`,
  );
  const extracted = extractGraph(project, configDir, aliasRoots);

  const sha = getGitSha(configDir);
  const pool = new pg.Pool({ connectionString: labUrl });
  try {
    await rebuildDb(pool, extracted, sha);
  } finally {
    await pool.end();
  }

  console.log(
    `✓ rebuilt repo.modules (${extracted.modules.length}), repo.imports (${extracted.imports.length}), ` +
      `repo.exports (${extracted.exportsList.length}) — snapshot sha ${sha ?? "unknown"}`,
  );
}

if (process.argv[1]?.endsWith("symbol-graph.ts")) {
  main().catch((err: unknown) => {
    console.error("symbol-graph.ts --rebuild failed:", err);
    process.exit(1);
  });
}
