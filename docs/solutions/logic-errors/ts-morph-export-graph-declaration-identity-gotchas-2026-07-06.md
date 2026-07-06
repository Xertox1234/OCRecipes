---
title: 'ts-morph getExportedDeclarations()/findReferencesAsNodes() gotchas when building a project-wide export/reference graph'
track: bug
category: logic-errors
module: scripts
severity: medium
tags: [ts-morph, typescript-compiler-api, static-analysis, ast, dead-code, reference-count, pg-lab]
symptoms: ['A barrel-re-exported symbol (`export { x } from "./y"` or `export * from "./y"`) appears as TWO separate export candidates when iterating `getExportedDeclarations()` over every source file in a project', 'A reference-count computed as `findReferencesAsNodes().length - 1` reports 0 for an export that has exactly one real external usage', 'A dead-code/unused-export detector built on these APIs produces both false-positive duplicates and false-positive "unused" results for exports that are actually used']
applies_to: [scripts/pg-lab/**/*.ts]
created: '2026-07-06'
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

## Related Files

- `scripts/pg-lab/symbol-graph.ts` — `extractGraph`'s origin-file filter and
  `findReferencesCount`'s `Node.isReferenceFindable()` guard
- `.claude/hooks/test-pg-lab-symbol-graph.sh` — the fixture test's namespace-import
  (`getOrderInternal`) and barrel (`server/storage/index.ts`) shapes

## See Also

- [AST-based cross-file static guard (TypeScript compiler API) for a per-declaration property, placed in scripts/](../design-patterns/ast-cross-file-import-directive-guard-2026-07-05.md) — the sibling pattern for cross-file AST resolution using the raw `typescript` compiler API instead of ts-morph, for when a full semantic reference graph isn't needed
