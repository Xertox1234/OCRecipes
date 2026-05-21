# LSP Rules

Binding rules for the TypeScript LSP (`LSP` tool) in OCRecipes. The backing
server is `typescript-language-server` 5.2.0; `tsconfig.json` has
`incremental: true`.

## Always

- Prefer the `LSP` tool over `grep` for find-references, go-to-definition,
  rename-safety, implementation lookup, and symbol-by-name search. It matches
  semantic identity and resolves the `@/` and `@shared/` path aliases; `grep`
  matches text (comments, strings, unrelated same-name identifiers).
- Warm the server with a throwaway `hover` as the first LSP action of a session.
  If any result looks impossibly small (e.g. `findReferences` returns only the
  definition), re-run the same query once — the second call is correct. Positions
  are 1-based (line and character).
- Use call hierarchy (`incomingCalls` / `outgoingCalls`) for impact analysis
  across the `routes → services → storage → db` layering — more precise than a
  flat `findReferences` list.
- Use `goToImplementation` for interface → concrete-impl on the storage facade
  (`server/storage/index.ts`).
- Use `workspaceSymbol` to jump to a symbol by name across the tree.

## Never

- Never rely on `grep` alone to assert a symbol is unused, or that a rename /
  signature change is safe — confirm with `findReferences` / call-hierarchy.
- Never treat the LSP as a type checker — it has no diagnostics operation. Type
  errors come from `npm run check:types` / CI.

## When grep is still correct

Plain-text / string searches, and `.sql`, config, and native (non-TypeScript)
files. The LSP is TypeScript-only.

## Delegating to non-editable agents

`Explore`, `Plan`, and `feature-dev:*` live in the plugin/harness layer and their
definitions cannot be edited. When dispatching symbol work to them, include the
LSP-first directive and the cold-start warm-up note in the dispatch prompt.

## Canonical agent block

The block below is the single source of truth, duplicated verbatim into each
symbol-working agent in `.claude/agents/`. **Edit it HERE only.** The drift-check
(`npm run lsp:check-agent-block`) fails if any agent copy diverges.

<!-- LSP-AGENT-BLOCK:START -->

## Tooling: LSP-First Symbol Navigation

This repo has the TypeScript LSP wired into the `LSP` tool. For any symbol-level
work, prefer it over `grep` — it matches semantic identity and resolves the `@/`
and `@shared/` path aliases; `grep` matches text (comments, strings, unrelated
same-name identifiers).

- **Find usages / rename-safety:** `findReferences` (not grep).
- **Jump to a definition:** `goToDefinition`.
- **Find interface implementations:** `goToImplementation` — e.g. the storage
  facade interface in `server/storage/index.ts` → its concrete modules.
- **Impact analysis across layers:** `incomingCalls` / `outgoingCalls` (call
  hierarchy) — trace `routes → services → storage → db` precisely instead of a
  flat reference list.
- **Locate a symbol by name across the repo:** `workspaceSymbol`.

**Cold-start gotcha:** the FIRST LSP query in a session often returns degraded
results (e.g. `findReferences` returns only the definition). Warm the server with
a throwaway `hover` first; if any result looks impossibly small, re-run the same
query once — the second call is correct. Positions are 1-based.

**Ceiling:** the LSP tool is navigation-only — no diagnostics operation, so type
errors still come from `npm run check:types` / CI. It is TypeScript-only: keep
using `grep` for `.sql`, config, native code, and plain-text searches.

<!-- LSP-AGENT-BLOCK:END -->
