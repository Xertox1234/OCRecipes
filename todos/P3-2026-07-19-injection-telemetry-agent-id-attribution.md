---
title: "PG Lab injection telemetry rows lack agent_id — subagent rows indistinguishable from the orchestrator's"
status: backlog
priority: low
created: 2026-07-19
updated: 2026-07-19
assignee:
labels: [deferred, harness, injection]
github_issue:
---

# Injection telemetry rows lack agent_id attribution

## Summary

PR #667 keyed `inject-patterns.sh`'s dedup state on `session_id` + the per-context-window
`agent_id` from hook stdin, but the PG Lab telemetry rows (`LOG_TSV`) still log
`"$SESSION"` only. Post-#667, a subagent's "injected"/"pointer"/"deferred" rows are
indistinguishable from the orchestrator's own rows for the same `session_id` in
`ocrecipes_lab` `harness.injection_log` — an analytics-only blind spot (dedup behavior is
correct; only attribution is lossy).

## Background

Flagged as a non-blocking NOTE by the PR #667 pre-merge code review (2026-07-19). The
reviewer located the four logging call sites at `inject-patterns.sh:304,336,366,372`
(line numbers pre-#667-merge; re-locate via `grep -n LOG_TSV`). Telemetry fidelity was
explicitly outside #667's scope (dedup correctness). Relevant now that per-context-window
injection is live: first-touch/full-payload stats per context window can't be computed
without the discriminator that the dedup path already extracts.

## Acceptance Criteria

- [ ] Telemetry rows carry the agent discriminator (empty/`-` for the top-level context)
      alongside `session_id` — extend the TSV shape and, if needed, the
      `harness.injection_log` table in `ocrecipes_lab` (lab DB ONLY — never the app DBs;
      keep every telemetry write fail-silent per the PG Lab ground rules)
- [ ] Any PG Lab report/query that aggregates `injection_log` by session still works
      (check `scripts/pg-lab/` for injection-report consumers)
- [ ] `.claude/hooks/test-inject-patterns.sh` covers the new field if the TSV shape is
      asserted anywhere in the suite; kill switch `PATTERN_INJECT_NO_LOG=1` still honored

## Implementation Notes

- `.claude/hooks/inject-patterns.sh` — `AGENT_ID` is already extracted for the dedup key
  (PR #667); the change is plumbing it into the `LOG_TSV` writer, not new detection.
- Lab-DB DDL (an added column) is `ocrecipes_lab`, not the shared dev app DB — the
  db-serial batching rule for `nutricam` schema work does not apply, but keep the
  migration idempotent since the hook fail-silently no-ops when Postgres is down.
- `.claude/hooks/test-inject-patterns.sh` for coverage.

## Dependencies

- None (PR #667 merged 2026-07-19).

## Risks

- The telemetry writer must stay fail-silent and cheap — no new failure mode on the hot
  Edit/Write hook path if the column is missing (old-schema DB) or Postgres is down.
