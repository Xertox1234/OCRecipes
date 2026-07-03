<!-- Filename: P3-2026-07-02-solutions-kb-markdown-canonical.md -->

---

title: "Solutions KB: make the markdown mirror canonical, retire the Postgres/pgvector layer"
status: done
priority: low
created: 2026-07-02
updated: 2026-07-03
assignee:
labels: [deferred, harness]
github_issue:

---

# Solutions KB: make the markdown mirror canonical, retire the Postgres/pgvector layer

## Summary

Collapse the dual-source solutions knowledge base to a single source of truth: the markdown
tree. Decision made 2026-07-02 during the harness audit (`docs/research/2026-07-02-harness-audit.md`).

## Background

The 2026-07-02 harness audit found the solutions DB and its markdown mirror are contractually
byte-identical (Gate C equivalence, `inject-patterns.sh:32`), making one redundant by
construction. The pgvector/HNSW/tsvector machinery is never used by the injection hook (plain
regex tag filter at `inject-patterns.sh:184-186`), MCP semantic search has zero usage evidence,
and the dual-path apparatus costs three parity checkers, a 13.5KB hook test, 9 npm scripts,
embedding spend, and a running Postgres. User decision: **markdown-canonical**.

## Acceptance Criteria

- [ ] `docs/solutions/` is git-tracked (remove from `.gitignore`) and becomes the canonical store
- [ ] `inject-patterns.sh` is markdown-only: delete `solutions_from_db` and the Gate C dual-path
      equivalence contract; update `test-inject-patterns.sh` accordingly
- [ ] `session-recent-issues.sh` reads the last-14-days digest from the filesystem (solution
      filenames carry `-YYYY-MM-DD` dates) instead of psql — no DB dependency
- [ ] `/codify` (`.claude/skills/codify/SKILL.md`) and todo-executor Step 9 write markdown
      directly; near-dup check becomes a title/slug grep (no embeddings)
- [ ] Delete `scripts/solutions-db/` (MCP server, add/export/parity/hook-equivalence/ingest),
      the `solutions:db:*` npm scripts, and the `solutions-db` entry in `.mcp.json`
- [ ] Remove the `solutions-db-gates` job from `.github/workflows/ci.yml`
- [ ] Remove the `docs/solutions` symlink provisioning from `.husky/post-checkout` /
      `worktree-deps.sh` (tracked files exist in worktrees natively)
- [ ] Purge the confirmed-stale row/file ("Trusted Kimi PR diff gates", references deleted CI)
- [ ] CLAUDE.md "Key Patterns" section updated to describe the markdown-only flow
- [ ] `npm run preflight` green

## Implementation Notes

Files in scope: `.claude/hooks/inject-patterns.sh`, `.claude/hooks/test-inject-patterns.sh`,
`.claude/hooks/session-recent-issues.sh`, `scripts/solutions-db/**`, `.mcp.json`,
`.github/workflows/ci.yml` (solutions-db-gates job), `.husky/post-checkout`,
`.claude/hooks/worktree-deps.sh`, `package.json` (solutions:db:\* scripts),
`.claude/skills/codify/SKILL.md`, `.claude/agents/todo-executor.md` (Step 3a/9),
`docs/PATTERNS.md`, `CLAUDE.md` (local, untracked).

Sequencing: export a final `--all` mirror from the DB first (verify file count == row count),
commit the tracked tree, THEN remove the DB paths. Optional follow-up: triage the 2026-05-13
bulk-backfill rows (~200 rederivable convention files) — separate pass, not part of this todo.

Executor note: this todo touches `.claude/hooks/` and `scripts/` — the automerge guard will
correctly HOLD it for individual review.

## Risks

- Losing the 0.88-cosine near-dup advisory at codify time (mitigation: title grep is adequate
  at 568 files).
- Step 3a read-back in todo-executor.md references MCP tools; its markdown fallback path
  already exists and becomes the primary — verify the fallback greps still match the corpus.

## Updates

### 2026-07-03 (completion)

- **DONE** — implemented on `todo/solutions-kb-markdown-canonical` (4 commits: corpus tracked,
  hooks markdown-only, DB layer deleted, prose inverted). All acceptance criteria met. Final
  export verified at exact parity (573 rows == 573 files, round-trip green) before cutover;
  injection output byte-identical to the pre-cutover baseline; digest row set identical to the
  retired SQL. Stale trusted-kimi file purged. Every hook test suite green.

### 2026-07-03

- Bumped `status: backlog → planned` — staged as the **keystone** harness item for the next
  session. Do this first: it retires the DB layer so the sibling
  `P3-2026-07-02-inject-patterns-payload-tuning` collapses to a single markdown-only edit
  (its Gate C equivalence AC is voided once this lands).
- Serialization note: this shares `inject-patterns.sh` + `test-inject-patterns.sh` with the
  inject-patterns todo, and `codify/SKILL.md` + `todo-executor.md` with
  `P3-2026-07-02-typescript-crosscut-label-in-path-domains-cli`. Those cannot run as a parallel
  `/todo` batch — one reviewed PR at a time. All touch `.claude/`/`scripts/`, so the automerge
  guard HOLDS each for individual review.
