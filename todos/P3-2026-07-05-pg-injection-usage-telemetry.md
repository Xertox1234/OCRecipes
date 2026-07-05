<!-- Filename: P3-2026-07-05-pg-injection-usage-telemetry.md -->

---

title: "PG Lab: pattern-injection usage telemetry (which injected docs actually get used)"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: pattern-injection usage telemetry (which injected docs actually get used)

## Summary

Log what `inject-patterns.sh` delivers (session id, edited path, domain, rule/solution doc ids, deferred-or-injected, payload bytes) to `harness.injection_log`, so the 573-file solutions corpus and rules docs can be audited for dead weight instead of rotting silently.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. The 2026-07-04 research report's central lesson (R4): the retired pgvector DB died because nothing measured whether its retrieval was used — and the markdown corpus faces the same silent-rot risk. This todo instruments delivery (what was injected, how often, at what token cost). Correlating with _usage_ (did the session then follow the pattern?) is explicitly out of scope for v1 — delivery frequency alone already identifies never-matched docs and over-firing domains.

## Acceptance Criteria

- [ ] `scripts/pg-lab/schema/injection-log.sql`: append-only `harness.injection_log(ts, session_id, tool, edited_path, domain, doc_paths text[], action, payload_bytes)`.
- [ ] `inject-patterns.sh` gains ONE tail call to a new `scripts/pg-lab/log-injection.sh` — backgrounded (`&`), fail-silent, hard time-budgeted; the hook's measured latency envelope (~145ms first-touch path per PR #504) must not regress measurably. Logging failure can never affect hook output or exit code.
- [ ] `session-recent-issues.sh` digest delivery logged the same way (one-shot SessionStart events).
- [ ] `scripts/pg-lab/injection-report.sh`: docs never delivered in N days; top domains by payload bytes; defer frequency (complements the P3 itest-defer margin concern with real data).
- [ ] Hook self-tests updated (`scripts/run-hook-tests.sh` path): injection output byte-identical with logging on, off, and with DB down.
- [ ] Value probe: after 30 days, the report's "never delivered" list gets one triage pass — findings recorded in Updates.

## Implementation Notes

- Modifying `inject-patterns.sh` — the highest-traffic hook. Diff must be surgical: one guarded tail block, no restructuring. The payload/domain variables to log already exist in the script; do not recompute anything.
- `session_id`: Claude Code exposes it in hook input JSON (verify the field name against current hook payload docs before relying on it).
- Consider `psql ... &` with `disown` vs a tmp-file spool + separate flusher if backgrounded psql proves flaky in the hook sandbox — decide empirically in implementation.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.
- Serialization: shares `inject-patterns.sh`/hook-test files with any concurrent inject-patterns todo (e.g. `P3-2026-07-03-inject-patterns-defer-before-build.md`) — must NOT run in the same `/todo` batch as those (transitive shared-hook rule).

## Risks

- Touches `.claude/hooks/` → automerge guard HOLDs for individual review (expected and correct).
- Latency regression on the edit hot path — the time-budget + background pattern is the mitigation; measure before/after.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch C).
