<!-- Filename: P3-2026-07-10-pg-session-coordination-implementation.md -->

---

title: "PG Lab: implement session coordination (registry + warnings + DB-serial mutex) per reviewed spec"
status: backlog
priority: low
created: 2026-07-10
updated: 2026-07-10
assignee:
labels: [deferred, harness, pg-lab]
github_issue:

---

# PG Lab: implement session coordination (registry + warnings + DB-serial mutex) per reviewed spec

## Summary

Implement the session-coordination design that passed `/spec-review` on 2026-07-10
(verdict approve-with-edits, edits applied): a Postgres-backed visibility registry with
warn-only collision warnings for all session types, drift-detect attribution enrichment,
and ONE advisory lock (ephemeral background-psql holder) turning the /todo DB-serial
convention into an enforced mutex.

## Background

Spec (canonical, local-only): `docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md`.
Spec-phase todo: `todos/archive/P3-2026-07-05-pg-session-coordination.md` (decision: PROCEED).
Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md` (Phase D).

Key shape (details in spec): schema `harness` in `ocrecipes_lab` — two ephemeral lease
tables (`session_registry`, `files_in_flight`, TTL 10 min, reap-on-read) + append-only
`coordination_log`; `session-coord.sh` CLI with thin hook wrappers (SessionStart register,
PostToolUse record async, PreToolUse consult via ~25s local snapshot, SessionEnd deregister,
drift-detect `attribute-drift` enrichment); `db-serial-lock.sh` with explicit `--watch-pid`,
documented ps-walk, 15-min bounded wait → exit 2 → todo `blocked`, exit-3 refuse path when
watch-pid is unresolvable; pid→session_id bridge file for direct-CLI invocations (§5.1a).
All warn-only outside the mutex; everything fail-silent when Postgres is down.

## Acceptance Criteria

Three individually-reviewed PRs, in order (spec §11 — hooks touched, so every PR is
automerge-HELD and gets individual review; hook self-tests mandatory):

- [ ] **PR 1 — write path:** `scripts/pg-lab/schema/session-coordination.sql`,
      `session-coord.sh` (register/record/refresh-snapshot/deregister/reap + §5.1a bridge),
      SessionStart/PostToolUse/SessionEnd hook wiring, `.claude/hooks/test-session-coord.sh`
      covering lifecycle, TTL reaping, fail-silent (closed-port `LAB_DATABASE_URL`), and
      snapshot atomicity. No consumer-visible warnings yet — soak the write path. Verify
      during this PR: SessionEnd JSON-stdin contract (first SessionEnd hook in this repo)
      and whether `CLAUDE_SESSION_ID` exists in Bash env (would simplify the §5.1a bridge).
- [ ] **PR 2 — read path:** `consult` warnings (same-abs_path collision + cross-worktree
      rel_path note, self-suppression), drift-detect enrichment via `attribute-drift`
      (same repo_root only), stale-while-revalidate snapshot with `flock -n` refresh guard,
      tests for both warning levels + suppression + corrupt-snapshot silence.
- [ ] **PR 3 — mutex:** `db-serial-lock.sh` (acquire/release/status, `--watch-pid`
      required from orchestrator dispatch, ps-walk fallback with exit-3 refuse,
      `application_name`-keyed server-side release fallback), /todo orchestrator
      dispatch-prompt update for schema/DDL todos (`register --kind todo-executor` first
      action; `acquire --watch-pid` before first DDL, `release` on completion), mutex test
      suite: competing holders, kill −9 release, **orphan test that kills the WATCHED pid**
      (proves resolution correctness), timeout exit 2, unresolvable exit 3.
- [ ] **Live-fire kind check** (spec-review validation requirement): dispatch a real
      todo-executor subagent and confirm post-hoc that `harness.session_registry.session_kind`
      reads `todo-executor` — not merely that the code path was written.
- [ ] Value probe scheduled: ~60 days post-merge (align with injection-telemetry probe),
      questions + prune rule in spec §10 — zero true-positive warnings AND zero
      `lock-waited` events by probe date → simplify to drift-attribution-only or drop.

## Implementation Notes

- Follow the spec exactly; it survived review with correctness fixes (watch-pid target,
  release fallback, rel_path-per-file) that are easy to reintroduce as bugs by "simplifying."
- Fail-silent is doubly binding here: a coordination layer that blocks work when Postgres
  is down is worse than no layer. The ONLY non-silent paths are `acquire`'s WARN lines and
  exit 2/3.
- `rel_path` is computed from the FILE's containing worktree root
  (`git -C <dir> rev-parse --show-toplevel`), never the session's cwd — subagents edit
  outside their session's repo_root (feedback_subagent_worktree_cwd).
- Hot-path budget: `consult` is one file read; live psql only in async spawns. Per-Bash
  hook overhead is already ~140ms/8 spawns — add zero Bash-path spawns.
- DB-serial batching convention stays as the first line of defense; the lock enforces the
  cases discipline misses (second orchestrator run, manual session, transitive slip).

## Dependencies

- Spec-phase todo complete (archived 2026-07-10). No code dependencies; PRs 1→2→3 in order.

## Risks

- Touches multiple hooks → automerge-HELD, individual review, self-tests mandatory (each PR).
- PR 3 modifies /todo orchestrator dispatch behavior — coordinate with any in-flight /todo
  batch runs; do not land mid-batch.

## Updates

### 2026-07-10

- Filed from the completed spec-phase brainstorm + `/spec-review` (approve-with-edits,
  edits applied same day). Decision recorded: PROCEED.
