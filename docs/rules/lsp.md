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

## Agent guidance

This file is the single source of truth for LSP usage. Agent files in
`.claude/agents/` carry only a one-line pointer here — never a copied block.
Read-only agents (the reviewers, `todo-researcher`) must read this file
directly; the inject hook fires only on Edit/Write, so nothing is auto-injected
into their context.
