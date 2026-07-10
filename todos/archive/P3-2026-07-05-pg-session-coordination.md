<!-- Filename: P3-2026-07-05-pg-session-coordination.md -->

---

title: "PG Lab (spec-first): cross-terminal session coordination via advisory locks + LISTEN/NOTIFY"
status: complete
priority: low
created: 2026-07-05
updated: 2026-07-10
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

- [x] Brainstorm session covering: registry schema and staleness/reaping (crashed sessions must not leave phantom locks — advisory locks auto-release on disconnect, but a hook-based writer has no persistent connection; this tension is THE core design problem to solve); which hooks participate (SessionStart register, PreToolUse Edit/Write consult, git-op consult à la drift-detect); warn-only vs blocking semantics (drift-detect precedent: never block); how /todo orchestrator + executors use advisory locks for DB-serial batches; overlap with what drift-detect.sh already covers (this must complement, not duplicate — consider whether drift-detect folds into it). _(Done 2026-07-10 — five decisions user-confirmed, recorded in spec §3.)_
- [x] Spec written to `docs/superpowers/specs/` and passed through `/spec-review`. _(`2026-07-10-pg-session-coordination-design.md`; verdict approve-with-edits, all required edits applied same day.)_
- [x] Explicit failure-mode table: Postgres down, stale registrations, two sessions in same checkout vs separate worktrees, subagents (which don't inherit worktree cwd — see feedback*subagent_worktree_cwd). *(15 rows, spec §7.)\_
- [x] Decision recorded: proceed / simplify (e.g. registry-only without locks) / drop. _(**PROCEED** — registry + warnings for all session types, ONE advisory lock scoped to the /todo DB-serial case; LISTEN/NOTIFY and per-session daemons dropped. Implementation: `todos/P3-2026-07-10-pg-session-coordination-implementation.md`.)_

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

### 2026-07-07

- Marked `blocked` by the `/todo` orchestrator (P3-only run). This is the highest-complexity
  PG Lab item and its own Acceptance Criteria requires an interactive `superpowers:brainstorming`
  session (registry schema, staleness/reaping, which hooks participate, overlap with
  `drift-detect.sh`) — decisions only the user can make, not something an autonomous
  `todo-executor` should fabricate. Unblock by running the brainstorming session directly with
  the user in a dedicated interactive session, then write and `/spec-review` the resulting spec.

### 2026-07-10 — COMPLETE

- Interactive brainstorm run with the user; five decisions confirmed: (1) both pains,
  registry-first — locks scoped ONLY to the /todo DB-serial case; (2) mutex bounded-wait
  15 min then todo `blocked` + ACTION NEEDED (Postgres-down stays fail-open); (3) drift-detect
  enriched with registry attribution, local trigger kept; (4) cached pre-edit consult
  (~25s snapshot TTL, stale-while-revalidate, no psql on the edit hot path); (5) hybrid
  architecture — TTL lease rows for visibility, ephemeral background-psql holder for the
  advisory lock (crash → release via connection death, no TTL tuning).
- Spec written and `/spec-review`ed same day (verdict: approve-with-edits). Required edits
  applied: explicit `--watch-pid` + documented ps-walk + exit-3 refuse path for the lock
  holder; `register --kind` CLI re-upsert replacing env-var kind detection; attribute-drift
  join tightened to same repo_root only. Review also surfaced that the spec's core mechanisms
  needed a pid→session_id bridge for direct-CLI invocations (hooks get session_id on stdin;
  Bash calls don't) — added as spec §5.1a.
- Known stated limitation: same-run executor collisions stay with the orchestrator's
  in-process overlap map (executors share the orchestrator's session_id → self-suppressed);
  the registry's unique value is CROSS-session visibility.
- Decision: **PROCEED**. Implementation filed as
  `todos/P3-2026-07-10-pg-session-coordination-implementation.md` (3 individually-reviewed
  PRs per spec §11). Archiving this spec-phase todo.
