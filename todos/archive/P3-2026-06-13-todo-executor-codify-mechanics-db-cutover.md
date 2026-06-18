---
title: "Reconcile todo-executor Step 9 codify mechanics to solutions:db:add"
status: done
priority: low
created: 2026-06-13
updated: 2026-06-13
assignee:
labels: [deferred, hooks, database]
github_issue:
---

# Reconcile todo-executor Step 9 codify mechanics to solutions:db:add

## Background

SP2 (the solutions-DB enforcement cut-over) made the `ocrecipes_solutions` Postgres DB
the canonical store and added `npm run solutions:db:add` as the single write path. The
`/codify`, `/audit`, and `/todo` skill PROSE and the 11 `.claude/agents/*.md` files were
redirected to the DB-canonical model (SP2 Tasks 11-12). However, `.claude/agents/todo-executor.md`
**Step 9** still contains the older _mechanical_ codify procedure — a `kimi-write` block that
writes solution markdown directly to `$MAIN_CHECKOUT/docs/solutions/...`, a frontmatter
sanity-check that references `docs/solutions/README.md`, and `grep` commands in **Step 3a** —
none of which run `solutions:db:add`. So a solution codified via the executor's Step 9 path
would land on disk (the gitignored mirror) but **not** in the canonical DB until the next
manual `solutions:db:ingest`. Surfaced by the SP2 Task 12 implementer as out-of-scope for a
prose redirect (it's a procedure rewrite).

Severity is low: the executor's Step 9 codify path fires rarely, the prose already points at
the DB, and a periodic `solutions:db:ingest` reconciles disk → DB. But the mechanics should
match the canonical write path so codified knowledge reaches the DB immediately.

## Acceptance Criteria

- [ ] `todo-executor.md` Step 9 writes the solution file, then runs
      `npm run solutions:db:add -- <file>` (mirrors `/codify` Step 6c).
- [ ] The Step 9 overlap/dedup check uses `solutions:db:add -- <draft> --dry-run` (semantic,
      cosine ≥ 0.88) instead of (or in addition to) the `rg`/`grep` lexical scan.
- [ ] Step 3a's `docs/solutions/` grep references are updated to reflect the DB-canonical model
      (the markdown tree is a regenerated mirror; query via the MCP `search_solutions` tool).
- [ ] No remaining instruction in `todo-executor.md` writes a solution file without a following
      `solutions:db:add`.

## Implementation Notes

- Files in scope: `.claude/agents/todo-executor.md` (Step 9 codify block, Step 3a grep, the
  `docs/solutions/README.md` frontmatter sanity-check reference).
- Mirror the wording already applied to `.claude/skills/codify/SKILL.md` Steps 6b/6c/7 in SP2.
- `solutions:db:add` reuses `ingest.ts`'s parse→embed→upsert and re-exports the canonical mirror;
  it auto-loads `.env` via dotenv (needs `SOLUTIONS_DATABASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`).
- No code changes — this is a skill/agent prose-and-procedure edit.

## Dependencies

- Builds on SP2 (merged via the `feat/solutions-db-sp2` branch). No external blockers.

## Updates

### 2026-06-13

- Initial creation — deferred from SP2 Task 12 (agent/doc prose redirect); the executor's
  mechanical Step 9 codify procedure was out of scope for a prose-only task.
