---
title: "PG Lab telemetry sub-test 'zero-sample base is flagged as zero recorded traffic' is inconsistent under concurrent load"
status: done
priority: low
created: 2026-09-05
updated: 2026-09-13
assignee:
labels: [deferred, harness]
github_issue:
---

# PG Lab telemetry sub-test flaky under concurrent load

## Summary

The `zero-sample base is flagged as zero recorded traffic` sub-test — run via
`scripts/run-hook-tests.sh`'s `.claude/hooks/test-*.sh` glob, actually defined in
`.claude/hooks/test-pg-lab-contract-diff.sh` (see the 2026-09-13 Updates entry for the
correction) — produced inconsistent results when the suite ran while other work was
executing concurrently on the same machine. The aggregate gate passed clean twice when
re-run in isolation, so this is a suspected flake rather than a confirmed defect.

## Background

Observed 2026-09-05 during Task 6 of the outward-CLI guard folded repair — PR #926, merged
2026-09-06 as `4113d3ac` (the branch `todo/P0-2026-09-05-outward-cli-guard-folded-repair` has
since been deleted; cite the SHA, not the branch). It touched
`.claude/hooks/lib/cmd-detect.sh` and is unrelated to PG Lab telemetry. The implementer
surfaced it rather than filing it, and the orchestrator filed it here so the observation is
not lost.

The flakiness was **not isolated or confirmed** — it was seen once under load and did not
reproduce in two clean isolated runs. It is recorded because an intermittently-failing
sub-test inside an aggregate gate is the shape that erodes trust in the gate: if it fails
occasionally, people start re-running rather than investigating, and a real failure then
looks like the known flake.

Note the repo already has precedent here: broader test-suite flakiness was previously traced
to CPU contention and resolved with a retry, not a logic fix. The same cause is plausible.

## Acceptance Criteria

- [x] Reproduce the inconsistency deliberately (e.g. run `scripts/run-hook-tests.sh` under
      artificial CPU/IO contention) — or establish that it does not reproduce and close.
      **Closed via the "does not reproduce" branch** — see Updates below.
- [x] N/A — conditional on reproduction, which did not occur.
- [x] Made the non-determinism explicit rather than incidental (documented, not code-fixed)
      — see Updates below for the structural explanation.
- [x] No blanket retry added. No code changed at all; the diff is todo-only.

## Implementation Notes

- Entry point: `scripts/run-hook-tests.sh`; the sub-test name to grep for is
  `zero-sample base is flagged as zero recorded traffic`.
- PG Lab telemetry is fail-silent by design and writes only to the `ocrecipes_lab`
  database — never the app DBs. Any fixture work must preserve that.
- The kill switch `PATTERN_INJECT_NO_LOG=1` disables the telemetry emission and may be
  useful for isolating whether the sub-test depends on a live write.

## Scope Contract

- **Mechanisms to use:** existing hook-test harness only — no new test framework, no new
  retry mechanism beyond what the harness already provides.
- **Files in scope:** `scripts/run-hook-tests.sh` and the PG Lab telemetry fixture/helper it
  invokes for this sub-test.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of the outward-CLI guard work that surfaced it.

## Risks

- May not reproduce at all, in which case the correct outcome is to close this with a note
  rather than to change code chasing a phantom.
- Adding a retry without first identifying the cause would hide a real failure in the same
  sub-test — explicitly out of scope above.

## Updates

### 2026-09-05

- Initial creation. Surfaced during Task 6 of the outward-CLI guard folded repair; observed
  once under concurrent load, did not reproduce in two isolated runs.

### 2026-09-13

**Disposition: documented non-reproduction. Closing per the Risks section's own bullet —
"may not reproduce at all, in which case the correct outcome is to close this with a note."
No code changed; this diff is todo-only.**

A prior attempt at this todo (separate session) completed a full investigation and
reproduction matrix before losing its worktree to an infrastructure reclaim, ahead of
committing. This run re-verified its load-bearing claims cheaply (file reads + one live
`psql` check + one test run) rather than repeating the multi-minute stress matrix, then
adopted its conclusion. Everything below is attributed to its actual source — the prior
run's numbers are never presented as this session's own measurement.

**MEASURED (this session, by reading the files and one live check):**

- The sub-test lives at `.claude/hooks/test-pg-lab-contract-diff.sh:133` (the
  `assert_contains` immediately following the `EMPTY_OUT=`/`assert_nonzero` pair at
  :131-132), invoked via `scripts/run-hook-tests.sh:24`'s `for t in .claude/hooks/test-*.sh`
  glob — not a subtest embedded directly in `run-hook-tests.sh` itself, contra this todo's
  own "Entry point" note above.
- `scripts/pg-lab/contract-diff.sh:17` runs under `set -euo pipefail` and chains 4
  sequential subprocess spawns with no explicit timeout or retry: `psql` (`fetch_rows` for
  the feature branch, :74), `psql` (`fetch_rows` for the base branch, :75), `node -e` (:77),
  `npx tsx contract-diff-cli.ts` (:82).
- The test's throwaway DB name is unique per PID
  (`TEST_DB="pg_lab_contract_diff_test_$$"`, `test-pg-lab-contract-diff.sh:76`), so
  concurrent invocations cannot collide on DB name. Live check this session: Postgres
  `max_connections=100` (a stable setting, directly comparable) with a `pg_stat_activity`
  active count of `9` at the moment sampled. The active count itself is a volatile,
  point-in-time value — not independently comparable across two different sessions on
  different days — so it is reported here only to show headroom under the 100-connection
  ceiling, not as corroborating the prior run's separately-reported number.
- `assert_contains` (`test-pg-lab-contract-diff.sh:22`) reads
  `grep -qF -- "$3" <<<"$2"` — a herestring, not a `cmd | grep -q` pipe. This confirms it is
  **not** an instance of the SIGPIPE fail-open class in
  `docs/solutions/logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md`.
- Ran `.claude/hooks/test-pg-lab-contract-diff.sh` once, full file, no synthetic load: all 23
  `ok:` assertions passed, including both zero-sample assertions at :132-133 ("ALL PASS").
- **The structural reason this specific sub-test — and not its immediate neighbor — can
  present the reported failure signature.** Line 126 (`assert_exit0`, the case immediately
  above) requires exactly `exit 0` and would fail loudly on any subprocess crash. Line 132
  (`assert_nonzero`) only requires a _non-zero_ exit — which is satisfied both by
  `contract-diff.sh` correctly detecting the zero-sample condition (its own header,
  `contract-diff.sh:11-12`, documents "exits 1 on any difference... exits non-zero on any
  tooling failure") and by an unrelated crash in one of the 4 chained subprocesses. Line 133
  then asserts on the specific message, so a crash that isn't the zero-sample path produces
  exactly the reported symptom: `assert_nonzero` (:132) passes, `assert_contains` (:133)
  fails. This is not a defect in the test's design — a genuine crash _should_ fail the
  sub-test — but it does explain, structurally, why this exact assertion pair is the one
  capable of showing the reported inconsistency while its sibling at :126 is not.

**HYPOTHESIS (not measured, by either run):** that a transient failure in one of the 4
chained subprocesses under real contention (as opposed to the synthetic contention actually
tested) is the mechanism behind the single 2026-09-05 observation. Neither this run nor the
prior one induced this — the prior run's heaviest test used synthetic load average ~23.5 and
6 concurrent invocations, not near-exhaustion of Postgres's 100-connection limit or genuine
disk/IO contention.

**Reproduction record — three separate denominators, not one merged count:**

- Prior run (attributed, not re-run here): 12/12 clean across a synthetic-load stress
  matrix (3/3 baseline, 3/3 under load average ~23.5, 6/6 under that load plus 6 concurrent
  invocations) — reported by that session, not independently re-verified by this one.
- This todo's own 2 prior isolated runs (recorded at creation, 2026-09-05): 2/2 clean.
- This session: 1/1 clean (full file, no synthetic load).

Total across all three: 15/15 clean against the single uncontrolled 2026-09-05 observation.
This did **not** reproduce across these attempts — that is not the same claim as "the
sub-test is deterministic" or "the flake does not exist." Absence was not measured; only
non-reproduction under the attempts made was.

**Why this closes without a code change:** the todo's own Scope Contract permits no new
retry mechanism, and Acceptance Criteria #4 forbids a blanket retry outright. Introducing
any other code change (e.g. a synthetic timeout on the subprocess chain) would not be
justified by measured evidence — the actual failing mechanism was never confirmed, only
hypothesized. Per the Risks section, non-reproduction is itself the correct closing
condition.

**Not codified.** This is a disposition (non-reproduction), not a discovered reusable rule.
The corpus already carries direct precedent against speculatively codifying "it's transient
contention": `docs/solutions/runtime-errors/vitest-collection-crash-transient-contention-2026-07-16.md`
is marked **SUPERSEDED** — its "transient contention" theory turned out to be a different,
confirmed root cause once someone looked closer. This archived todo is the durable record
for OCRecipes' own instance of an unconfirmed same-shape hypothesis.
