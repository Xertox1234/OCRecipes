---
title: "Extract and unit-test the solutions-db MCP server query/param builder"
status: done
priority: low
created: 2026-06-13
updated: 2026-06-13
assignee:
labels: [deferred, testing, database]
github_issue:
---

# Extract and unit-test the solutions-db MCP server query/param builder

## Summary

The `search_solutions` (and `find_duplicates`) SQL-building logic in `scripts/solutions-db/mcp-server.ts` constructs dynamic `WHERE` clauses with running `$n` placeholder indices, but has **no automated test coverage** (the DB-bound MCP server is validated only by real-DB runs + the standalone integration check, none of which run in CI). Extract the pure query/param builder and unit-test it so the most bug-prone code in the module joins the CI-safe suite.

## Background

Surfaced in the `/review` of PR #397 (solutions-db SP1). The dynamic parameter-indexing in `search_solutions` — `$1` reserved for the embedding vector, optional filters incrementing a running `$i`, then `LIMIT $kIdx` — is correct today but untested, so a future edit (e.g. adding a filter) could silently break the index alignment. CI cannot test the MCP server end-to-end (no DB / no OpenAI key in CI), so the fix is to isolate the _pure_ string/param assembly from the DB call and test that in isolation, consistent with the module's lazy-pool / pure-lib CI-safety design.

## Acceptance Criteria

- [ ] A pure function (e.g. `buildSearchQuery(filters): { sql: string; params: unknown[] }`) is extracted from `search_solutions`' handler in `mcp-server.ts` into a testable unit (a `lib/` module or co-located export).
- [ ] Unit tests assert correct `$n` indexing for: no filters (k at `$2`), each single filter, and all filters combined (contiguous indices, `LIMIT` index correct, `$1` reused for the vector in SELECT + ORDER BY).
- [ ] Tests assert `tags && $n` array-containment is used for the `tags` filter and that omitted filters add no clause.
- [ ] Tests run in CI with no DB and no API key (pure — no pool/client construction at import).
- [ ] `mcp-server.ts` uses the extracted builder (behavior unchanged; the boot smoke test still lists 7 tools).

## Implementation Notes

- Target file: `scripts/solutions-db/mcp-server.ts` → extract to `scripts/solutions-db/lib/query-builder.ts` (or similar), keeping it pure (no `pool`/`embedBatch` calls inside).
- Mirror the existing pure-lib test pattern in `scripts/solutions-db/__tests__/` (e.g. `globs.test.ts`, `sql-guard.test.ts`).
- Keep the embedding step (`embedQuery`) and the `pool.query` call in the handler; only the WHERE/param assembly moves.
- Consider giving `find_duplicates`' category-clause builder the same treatment if cheap.

## Dependencies

- Lives in the solutions-db SP1 module (merged via PR #397). No external blockers.

## Risks

- Low. Pure-refactor + tests; the boot smoke test + integration check guard against behavioral regressions.

## Updates

### 2026-06-13

- Initial creation — deferred from the PR #397 `/review` (untested MCP query builder).
