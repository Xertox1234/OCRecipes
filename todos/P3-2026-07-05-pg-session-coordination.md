<!-- Filename: P3-2026-07-05-pg-session-coordination.md -->

---

title: "PG Lab (spec-first): cross-terminal session coordination via advisory locks + LISTEN/NOTIFY"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness, spec-first]
github_issue:

---

# PG Lab (spec-first): cross-terminal session coordination via advisory locks + LISTEN/NOTIFY

## Summary

Design (spec first) a Postgres-backed session registry for parallel Claude Code terminals/worktrees: each session registers (pid, cwd/worktree, branch, files-in-flight); PreToolUse hooks consult it to warn _which other session_ is mid-edit on the same file, and advisory locks turn the "schema/DDL todos are DB-serial" convention into an actual mutex.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. This attacks the most-documented recurring pain family in project memory: parallel-terminal git drift (drift-detect.sh warns only after HEAD moved), /todo executor collisions, transitive shared-hook batch collisions, and the DB-serial convention for schema todos. Postgres advisory locks + LISTEN/NOTIFY are purpose-built for exactly this. Highest novelty, touches hooks → spec-first, dedicated session.

## Acceptance Criteria (for the SPEC phase)

- [ ] Brainstorm session covering: registry schema and staleness/reaping (crashed sessions must not leave phantom locks — advisory locks auto-release on disconnect, but a hook-based writer has no persistent connection; this tension is THE core design problem to solve); which hooks participate (SessionStart register, PreToolUse Edit/Write consult, git-op consult à la drift-detect); warn-only vs blocking semantics (drift-detect precedent: never block); how /todo orchestrator + executors use advisory locks for DB-serial batches; overlap with what drift-detect.sh already covers (this must complement, not duplicate — consider whether drift-detect folds into it).
- [ ] Spec written to `docs/superpowers/specs/` and passed through `/spec-review`.
- [ ] Explicit failure-mode table: Postgres down, stale registrations, two sessions in same checkout vs separate worktrees, subagents (which don't inherit worktree cwd — see feedback_subagent_worktree_cwd).
- [ ] Decision recorded: proceed / simplify (e.g. registry-only without locks) / drop.

## Implementation Notes

- Do NOT implement from this todo; deliverable is the reviewed spec.
- The no-persistent-connection problem has known shapes: session-scoped `pg_advisory_lock` held by a tiny daemon per session, vs table-row "leases" with TTL + reap-on-read. The spec must pick one with eyes open.
- Fail-silent rail applies doubly: a coordination layer that blocks work when Postgres is down would be worse than no layer.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Highest-complexity PG Lab item; real chance the honest spec conclusion is "registry + warnings yes, locks no" — that's a valid outcome, record it.
- Touches multiple hooks → automerge-HELD, individual review, hook self-tests mandatory.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Phase D, spec-first).
