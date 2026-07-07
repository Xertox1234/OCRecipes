---
title: 'ts-morph getExportedDeclarations()/findReferencesAsNodes() gotchas when building a project-wide export/reference graph'
track: bug
category: logic-errors
module: scripts
severity: medium
tags: [ts-morph, typescript-compiler-api, static-analysis, ast, dead-code, reference-count, pg-lab, silent-failure]
symptoms: ['A barrel-re-exported symbol (`export { x } from "./y"` or `export * from "./y"`) appears as TWO separate export candidates when iterating `getExportedDeclarations()` over every source file in a project', 'A reference-count computed as `findReferencesAsNodes().length - 1` reports 0 for an export that has exactly one real external usage', 'A dead-code/unused-export detector built on these APIs produces both false-positive duplicates and false-positive "unused" results for exports that are actually used', 'findReferencesAsNodes() counts a barrel\'s own export specifier as a reference, so a symbol reachable ONLY through an unused barrel reports a nonzero reference count even though it has no real external usage', 'project.addSourceFilesAtPaths([...]) silently adds zero files for one literal path in the array that no longer matches anything on disk — no throw, no console warning, and the returned SourceFile[] is easy to discard without checking it']
applies_to: [scripts/pg-lab/**/*.ts]
created: '2026-07-06'
last_updated: '2026-07-07'
---

# ts-morph getExportedDeclarations()/findReferencesAsNodes() gotchas when building a project-wide export/reference graph

## Problem

Building a project-wide "every export, with a reference count" graph via ts-morph, by
calling `sourceFile.getExportedDeclarations()` for every loaded source file and
`declaration.findReferencesAsNodes()` for reference counting, produced two distinct
incorrect results that only surfaced when run against a real ~1000-file repo (a small
hand-built fixture missed both):

1. A symbol declared in one file and re-exported by a barrel (`export { x } from
   "./helpers"` or `export * from "./helpers"`) was recorded as an export candidate under
   **both** the origin file and every barrel that re-exports it, producing duplicate rows
   for the same underlying declaration in a table keyed on `(path, name)`.
2. A reference-count helper that did `findReferencesAsNodes().length - 1` (on the
   assumption the method always includes the declaration's own name occurrence alongside
   real usages) floored every export with exactly one real external usage to a
   reference count of 0, misreporting it as unused.

## Symptoms

- Iterating `sourceFile.getExportedDeclarations()` across every file in a project and
  collecting `(sourceFile.path, exportedName)` pairs produces more rows than there are
  actual distinct declarations — a symbol re-exported through an `index.ts`-style barrel
  shows up once per re-exporting file, not once.
- A "dead code" / "unused export" detector's false-positive rate is anomalously high
  specifically for files that are the ORIGIN of a barrel re-export (most real consumers
  import from the barrel, not the origin file directly, so the origin file's own
  reference count looks artificially low).
- A single-real-usage export is reported as having zero references.
- `findReferencesAsNodes()` counts a barrel's own export specifier as a reference, so a
  symbol that is reachable only through an unused barrel (e.g., `export { deadFn } from
  "./origin"` with no other importers) reports a nonzero reference count even though it
  has zero real external usages — the barrel's `ExportSpecifier` node is returned as a
  reference.
- `project.addSourceFilesAtPaths([...literal paths...])` returns the `SourceFile[]` it
  actually added — but if one literal path in the array (as opposed to a glob) no longer
  matches any file on disk (renamed, moved, deleted), that entry contributes zero files to
  the result with no exception and no console output. Code that discards the return value
  has no way to tell "the file was scanned" from "the file silently dropped out of the
  project."

## Root Cause

1. `SourceFile#getExportedDeclarations()` returns a `Map<name, ExportedDeclarations[]>`
   that resolves what a file makes available under `import { name } from thisFile` —
   which, for a re-export, is genuinely the SAME declaration node as the one the origin
   file's own `getExportedDeclarations()` call returns. ts-morph does not tag one of the
   two occurrences as "canonical"; both are equally valid answers to "what does this file
   export," and nothing warns that iterating this per-file breaks the 1-declaration-to-1-
   row assumption a graph table needs.
2. `Node#findReferencesAsNodes()` (a `ReferenceFindableNode` method — reachable via ts-
   morph's own `Node.isReferenceFindable(node)` type guard) returns only the actual
   USAGE-SITE nodes project-wide. It does **not** include the declaration's own name node
   as one of the results. Verified empirically: a function with zero external callers
   returns `refs.length === 0`; a function with exactly one external call site returns
   `refs.length === 1`. There is no implicit "+1 for the definition itself" the way some
   other language-service APIs behave.  
   **Crucially, this claim holds only when the symbol is not re-exported by a barrel.**  
   A symbol whose only export path is a barrel's `export { x } from "./y"` returns
   `refs.length === 1` in the zero-real-usage case (the one "reference" is the barrel's
   own `ExportSpecifier` identifier node). Empirically verified with a throwaway ts-morph
   fixture: `origin.ts` exports `deadFn` with zero external callers; `barrel.ts` does
   `export { deadFn } from "./origin"`; then
   `declaration.findReferencesAsNodes().length` is 1, not 0.
3. `addSourceFilesAtPaths()` is glob-based under the hood (`globSync` over each array
   entry) — a literal path with no glob metacharacters is just a degenerate glob that
   matches at most one file. Zero matches for a broken glob and zero matches for a
   correct-but-currently-empty glob are indistinguishable to the API, so it has no basis
   to warn; "matched nothing" is valid, ordinary glob behavior, not an error condition.
   The caller is the only one who knows a specific entry was meant to be load-bearing
   (e.g., a single hardcoded entrypoint file, as opposed to a directory glob where zero
   matches might be legitimate).

## Solution

1. **Dedupe export candidates by declaration origin, not by iterating file.** When
   building a candidate list from `getExportedDeclarations()`, only keep a `(name,
   declaration)` pair if the current source file IS the declaration's true origin:

   ```ts
   for (const [name, decls] of sourceFile.getExportedDeclarations()) {
     if (decls.length === 0) continue;
     if (decls[0].getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue; // barrel re-export -- skip
     candidates.push({ path: sourceFile.getFilePath(), name, declaration: decls[0] });
   }
   ```

2. **Use the raw `findReferencesAsNodes().length` directly — no `-1` adjustment**, and
   prefer `Node.isReferenceFindable(declaration)` over a hand-rolled `as unknown as
   { findReferencesAsNodes?: ... }` duck-type cast (this project's TypeScript conventions
   ban `as unknown as` double-casts; ts-morph's own guard is the supported, type-safe
   equivalent with identical runtime behavior):

   ```ts
   function referenceCount(declaration: Node): number {
     if (!Node.isReferenceFindable(declaration)) return 0;
     return declaration.findReferencesAsNodes().length; // no "- 1"
   }
   ```

3. **Filter out barrel re-export specifiers from `findReferencesAsNodes()` results.**  
   Even after fixing the `-1` adjustment (item 2) and deduplicating export candidates
   (item 1), an export that is only reachable through a barrel will still show a
   reference count of 1 (the barrel's own `ExportSpecifier`), making it appear falsely
   used. To correct this, apply a filter that excludes any reference whose immediate
   parent is an `ExportSpecifier` *and* whose containing `ExportDeclaration` has a
   module specifier (i.e., it is a re-export, not a local export). A local
   `export { x }` (no `from` clause) has `hasModuleSpecifier() === false` and should *not*
   be excluded — such an export is a genuine use. The correct implementation:

   ```ts
   function referenceCount(declaration: Node): number {
     if (!Node.isReferenceFindable(declaration)) return 0;
     const allRefs = declaration.findReferencesAsNodes();
     // Exclude refs that are barrel re-export specifiers (ExportSpecifier under
     // an ExportDeclaration with a module specifier), because a barrel passing
     // a symbol through is not itself a use of that symbol.
     const externalRefs = allRefs.filter(ref => {
       const parent = ref.getParent();
       if (!Node.isExportSpecifier(parent)) return true;               // keep if not an ExportSpecifier
       const exportDecl = parent.getParent()?.getParent();
       if (!Node.isExportDeclaration(exportDecl)) return true;         // should never happen, but keep safe
       return !exportDecl.hasModuleSpecifier();                        // keep only local exports (no "from")
     });
     return externalRefs.length;
   }
   ```

   This fix addresses the *expensive pass* (the semantic `findReferencesAsNodes()` call).
   A parallel fix is needed in the *cheap/AST-only pass-1* of the symbol graph
   (`cheapCounts` computation in `symbol-graph.ts`), which must skip edges of kind
   `'reexport'` so that barrel re-exports are never counted as a reference in the
   cheap pass either. That companion fix is tracked separately via a new discriminator
   `ImportEdge.kind: 'import' | 'reexport'`; this document focuses specifically on the
   `findReferencesAsNodes()` / `getExportedDeclarations()` API-gotchas class.

   **Update 2026-07-07 — prefer `ExportSpecifier.getExportDeclaration()` over the
   hand-rolled `parent.getParent()?.getParent()` walk shown above.** ts-morph exposes a
   direct, non-optional accessor for exactly this ancestor
   (`getExportDeclaration(): ExportDeclaration`, implemented as an unbounded
   `getFirstAncestorByKindOrThrow()` walk, not hardcoded to two levels), so the guarded
   two-hop climb and its "should never happen, but keep safe" `Node.isExportDeclaration`
   re-check are both unnecessary once `parent` is narrowed to `ExportSpecifier`:

   ```ts
   const externalRefs = allRefs.filter(ref => {
     const parent = ref.getParent();
     if (!Node.isExportSpecifier(parent)) return true;
     return !parent.getExportDeclaration().hasModuleSpecifier();
   });
   ```

   Same behavior for every case (local `export { x }`, named re-export, aliased
   `export { x as y } from`), one API call instead of two `getParent()` hops plus a
   defensive re-check, and resilient to a future ts-morph AST nesting change the
   hand-rolled walk would silently mis-navigate.

4. **Verify a load-bearing literal path was actually added, when using
   `addSourceFilesAtPaths()` for a single specific file (not a directory glob).** Capture
   the return value and confirm the expected absolute path is present; throw if not —
   silence here means the file quietly dropped out of the project with no other signal:

   ```ts
   const entryPointPath = path.join(configDir, "client/index.js");
   const added = project.addSourceFilesAtPaths([...globs, entryPointPath]);
   if (!added.some(sf => sf.getFilePath() === entryPointPath)) {
     throw new Error(`expected entrypoint not found at ${entryPointPath} -- did it move?`);
   }
   ```

   This converts a silent, permanent regression (the file drops out of the graph on a
   future rename with zero test coverage catching it — verified: no fixture-based test
   exercises this literal production path, since fixtures use a synthetic tsconfig, never
   the real repo's) into a loud, immediate failure the next time the tool is run.

## Prevention

- When iterating any per-file ts-morph API that can resolve to a declaration OUTSIDE the
  file being iterated (re-exports, barrels, `export *`), always compare
  `declaration.getSourceFile().getFilePath()` against the file you're currently iterating
  before treating the result as "belonging" to that file.
- Never assume a "find references" style API includes the declaration site itself without
  verifying empirically against both a zero-usage and a one-usage synthetic fixture first
  — the safest way to discover this class of gotcha before it reaches production code is a
  five-line throwaway script against a tiny in-memory or on-disk fixture, run BEFORE
  wiring the assumption into a larger pipeline.
- A synthetic test fixture with only 3-4 files is unlikely to exercise a barrel re-export
  AND a namespace-import-only usage AND a genuinely dead export all at once — if the tool
  under test is meant to run against a real, larger codebase, include at least one of each
  shape deliberately in the fixture (see `.claude/hooks/test-pg-lab-symbol-graph.sh` for an
  example: a `server/storage/index.ts`-style barrel plus a namespace-import consumer,
  specifically to catch both gotchas above), and additionally spot-check the tool's real
  output against the real repo before trusting any aggregate count it reports.
- When filtering `findReferencesAsNodes()` results for a project-wide reference graph,
  always check whether each reference node sits inside a re-export specifier (an
  `ExportSpecifier` whose grandparent `ExportDeclaration` has `hasModuleSpecifier() ===
  true`) and exclude it — a barrel passing a symbol through is not itself a use of that
  symbol. This applies symmetrically to whatever cheap/AST-only pass-1 mechanism a
  project uses too (not just the expensive pass).
- When a ts-morph node-navigation need matches a named accessor on the node class
  (`ExportSpecifier.getExportDeclaration()`, and others like it), prefer the accessor over
  hand-walking `getParent()` — grep the relevant `.d.ts` first (`node_modules/ts-morph/lib/
  ts-morph.d.ts`) before writing a multi-hop parent chain from scratch.
- `addSourceFilesAtPaths()` treats every array entry as a glob, including a literal path
  with no metacharacters — pass the return value through a presence check for any entry
  that MUST be found (a single hardcoded entrypoint file), not just entries meant as
  best-effort directory scans.
- When a local code comment is updated to correct or add a caveat to a claim (e.g. "no
  adjustment needed... EXCEPT for barrels"), grep the same file for other comments —
  especially a top-of-file header docstring — asserting the same now-qualified claim
  unconditionally. A caveat added only at the point of use, with the file's header still
  making the old unqualified claim, reads as internally contradictory to a future
  maintainer who trusts the header (the natural first-read entry point) and could
  "simplify away" the caveat's guard as apparently redundant.

## Related Files

- `scripts/pg-lab/symbol-graph.ts` — `extractGraph`'s origin-file filter,
  `findReferencesCount`'s `Node.isReferenceFindable()` guard and
  `getExportDeclaration()`-based barrel filter, and `loadProject`'s
  `addSourceFilesAtPaths()` presence check for the `client/index.js` entrypoint
- `.claude/hooks/test-pg-lab-symbol-graph.sh` — the fixture test's namespace-import
  (`getOrderInternal`) and barrel (`server/storage/index.ts`) shapes

## See Also

- [AST-based cross-file static guard (TypeScript compiler API) for a per-declaration property, placed in scripts/](../design-patterns/ast-cross-file-import-directive-guard-2026-07-05.md) — the sibling pattern for cross-file AST resolution using the raw `typescript` compiler API instead of ts-morph, for when a full semantic reference graph isn't needed