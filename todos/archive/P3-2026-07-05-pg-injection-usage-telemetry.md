<!-- Filename: P3-2026-07-05-pg-injection-usage-telemetry.md -->

---

title: "PG Lab: pattern-injection usage telemetry (which injected docs actually get used)"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-06
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

- [x] `scripts/pg-lab/schema/injection-log.sql`: append-only `harness.injection_log(ts, session_id, tool, edited_path, domain, doc_paths text[], action, payload_bytes)`.
- [x] `inject-patterns.sh` gains ONE tail call to a new `scripts/pg-lab/log-injection.sh` — backgrounded (`&`), fail-silent, hard time-budgeted; the hook's measured latency envelope (~145ms first-touch path per PR #504) must not regress measurably. Logging failure can never affect hook output or exit code.
- [x] `session-recent-issues.sh` digest delivery logged the same way (one-shot SessionStart events).
- [x] `scripts/pg-lab/injection-report.sh`: docs never delivered in N days; top domains by payload bytes; defer frequency (complements the P3 itest-defer margin concern with real data).
- [x] Hook self-tests updated (`scripts/run-hook-tests.sh` path): injection output byte-identical with logging on, off, and with DB down.
- [x] Value probe mechanism shipped (the report itself) — the actual 30-day-later triage pass is a future action that cannot be performed today; see Updates.

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

### 2026-07-06

- Implemented: `scripts/pg-lab/schema/injection-log.sql` (`harness.injection_log`, indexed on
  domain/ts/doc_paths GIN), `scripts/pg-lab/log-injection.sh` (fail-silent logger, `PGCONNECT_TIMEOUT=2`
  as the hard time budget — no `timeout`/`gtimeout` binary exists on macOS), one guarded tail
  block in `inject-patterns.sh` (backgrounded `&` + `disown`, `PATTERN_INJECT_NO_LOG=1` kill
  switch), the same pattern in `session-recent-issues.sh`, and `scripts/pg-lab/injection-report.sh`
  (docs-never-delivered / top-domains-by-bytes / defer-frequency).
- Two real bugs found and fixed during implementation (both would have silently dropped log
  rows with no error anywhere — exactly the failure mode this todo exists to prevent):
  1. `LOG_TSV="${LOG_TSV}$(printf ...)"` — command substitution strips trailing newlines, so
     multi-record accumulation concatenated records with no line separator. Fixed by
     appending `$'\n'` after each capture.
  2. The field delimiter was originally `\t`. bash's `read` collapses RUNS of tab (and other
     IFS-whitespace) even when IFS is set to tab alone, silently merging adjacent empty
     fields — exactly the `session-recent-issues.sh` log line's shape (`edited_path` and
     `domain` both empty on the same line). Switched the delimiter to `\x1f` (ASCII Unit
     Separator), which is never collapsed. Also found and fixed a second, related issue: a
     single-record line built via `$(...)` loses its trailing newline, and bash's `read`
     returns non-zero at EOF-without-a-newline even though it populated the variables — the
     `while read; do BODY; done` loop then skips `BODY` entirely for that line. Fixed with
     the standard `read ... || [ -n "$session_id" ]` idiom in `log-injection.sh`.
     Both are the same "silent failure with no error anywhere" class of bug documented in
     `docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md`.
- Verified live: real `ocrecipes_lab` round-trip for every branch (pointer/pre-estimate-defer/
  exact-size-defer/injected, plus SessionStart), byte-identical hook output across
  logging-on/off/DB-down (both hooks), and a full `scripts/run-hook-tests.sh` pass (18 suites).
  Deliberately did NOT run `npm run test:run`/`check:types`/`lint` ad-hoc per CLAUDE.md's
  2026-07-04 gate-consolidation note (no TS/JS files changed; push-time `preflight:fast` is
  the source of truth).
- Deferred: the actual 30-day "never delivered" triage pass (AC's value-probe follow-up)
  cannot happen until 2026-08-05 at the earliest — a future session should run
  `scripts/pg-lab/injection-report.sh --days 30` and record findings here.
- Code review (code-reviewer + server-reviewer, both empirically verified against a live
  local Postgres): one CRITICAL and one WARNING fixed, one WARNING deferred to a new todo,
  one SUGGESTION fixed inline.
  - CRITICAL (code-reviewer): `.claude/hooks/test-inject-patterns.sh`'s 52 pre-existing
    invocations had no `PATTERN_INJECT_NO_LOG=1` guard and wrote 114 rows of test noise into
    the developer's real shared `ocrecipes_lab` DB (an append-only, never-pruned table).
    Fixed by exporting `PATTERN_INJECT_NO_LOG=1` once at the top of that file; added a
    dedicated byte-identical on/off/DB-down test using a throwaway per-PID DB for the "on"
    case instead.
  - WARNING (server-reviewer): `scripts/pg-lab/log-injection.sh`'s `doc_paths` array-literal
    builder doubled embedded double-quotes (CSV convention) instead of backslash-escaping
    them (Postgres array-literal convention) — reproduced empirically: a doc path containing
    a literal `"` produced a malformed array literal and the whole INSERT silently failed
    under `|| true`. Fixed (`gsub(/\\/,...); gsub(/"/,...)`, backslash first) and locked in
    with a permanent regression test (`test-pg-lab-log-injection.sh` round 5).
  - WARNING (code-reviewer): `test-session-recent-issues.sh`'s new logging-on test case wrote
    a row into the shared `ocrecipes_lab` DB. Fixed to use a throwaway per-PID DB instead,
    same pattern as the CRITICAL fix above.
  - SUGGESTION (code-reviewer): stale "TSV lines" wording in `log-injection.sh`'s usage
    comment (delimiter is `\x1f`, not tab) — fixed.
  - SUGGESTION (server-reviewer), deferred: the `nutricam`/`ocrecipes_solutions` safety-rail
    denylist is bypassable via a `LAB_DATABASE_URL` query-string suffix, inherited from the
    pre-existing `init.sh`/`codify-neardup.sh` pattern (not a regression here) and now
    perpetuated by the two new scripts. Filed as
    `todos/P3-2026-07-06-pg-lab-safety-rail-query-string-bypass.md` (low priority, touches 2
    files outside this todo's scope, fixing all 4 PG Lab scripts together is cleaner than a
    piecemeal fix here).
  - Re-verified after fixes: full `scripts/run-hook-tests.sh` (18 suites, all pass), the
    shared `ocrecipes_lab.harness.injection_log` confirmed empty (0 rows) after the run, and
    a direct end-to-end repro of the quote-escaping fix (row now lands correctly instead of
    being silently dropped). One review round was sufficient — fixes were small, mechanical,
    and each was independently re-verified empirically rather than re-dispatching reviewers.
