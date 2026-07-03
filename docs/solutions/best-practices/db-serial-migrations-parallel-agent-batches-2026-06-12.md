---
title: 'Schema-migration todos are DB-serial: parallel agent batches share one dev Postgres'
track: knowledge
category: best-practices
module: server
tags: [database, migrations, parallel-agents, todo-workflow, vitest, worktrees]
symptoms: ['Mid-/todo-batch, sibling executors report mass test failures: PG 42703 (undefined column) or 42P01 (undefined table) from test factories or db-test-utils', 'Failures look like ''local DB needs db:push'' environmental drift, reproduce on a clean checkout, then vanish once the schema branch merges']
applies_to: [migrations/*.sql, shared/schema.ts, .claude/skills/todo/**]
created: '2026-06-12'
---

# Schema-migration todos are DB-serial: parallel agent batches share one dev Postgres

## Rule

Any todo whose execution applies destructive DDL to the local dev DB (a migration, `db:push`, `DROP COLUMN/TABLE`) must run **DB-serial**: in its own batch (or last), with its branch merged to main before any later batch with DB-hitting tests is dispatched. File-overlap analysis cannot catch this — worktrees isolate files, not the database.

## Smell patterns

- An orchestrator batch plan that parallelizes a `migrations/` or `shared/schema.ts` todo with anything whose tests touch Postgres.
- An executor diagnosing its own 42703/42P01 failures as "pre-existing local DB drift" while a schema todo runs in the same session.

## Why

Vitest in every worktree connects to the single `postgresql://localhost/nutricam` instance. In the 2026-06-11 /todo run, the drop-adaptive-goals-columns executor applied its column drop mid-batch; sibling executors still carried the OLD factory code inserting those columns and saw 627 "pre-existing" failures. Two independent executors misdiagnosed it as environmental drift. It self-healed only when the schema branch merged, making main's code match the mutated DB.

## Examples

- Correct: 2026-06-11 run batch 3 — the carouselSuggestionCache **table** drop was allowed to parallelize only after confirming the table had zero writers/readers in any test path (orphaned), so dropping it could not break a sibling.
- Incorrect: same run batch 2 — the **users-column** drop ran alongside two DB-test-hitting todos; both reported mass 42703.

## Exceptions

- Dropping a verified-orphaned object (no factory, no test, no code reference) is safe to parallelize — verify with an exhaustive reference sweep first, not assumption.
- Additive, backward-compatible DDL (new nullable column, new table) is generally safe: old code in sibling worktrees ignores it.

## Related Files

- `server/test/db-test-utils.ts` — where the shared-DB inserts fail
- `server/__tests__/factories/` — factory defaults that pin the expected schema
- `.claude/skills/todo/SKILL.md` — Phase 3 batching, where the DB-serial constraint applies

## See Also

- [agent-worktree-isolation](agent-worktree-isolation-2026-05-16.md) — the file-level sibling of this rule: worktrees don't isolate everything
- [deploy-before-drop-column-migration](../conventions/deploy-before-drop-column-migration-2026-06-10.md) — the prod-side ordering rule for the same class of migration
