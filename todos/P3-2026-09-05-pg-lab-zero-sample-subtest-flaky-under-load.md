---
title: "PG Lab telemetry sub-test 'zero-sample base is flagged as zero recorded traffic' is inconsistent under concurrent load"
status: backlog
priority: low
created: 2026-09-05
updated: 2026-09-05
assignee:
labels: [deferred, harness]
github_issue:
---

# PG Lab telemetry sub-test flaky under concurrent load

## Summary

The `zero-sample base is flagged as zero recorded traffic` sub-test inside
`scripts/run-hook-tests.sh` produced inconsistent results when the suite ran while other
work was executing concurrently on the same machine. The aggregate gate passed clean twice
when re-run in isolation, so this is a suspected flake rather than a confirmed defect.

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

- [ ] Reproduce the inconsistency deliberately (e.g. run `scripts/run-hook-tests.sh` under
      artificial CPU/IO contention) — or establish that it does not reproduce and close.
- [ ] If it reproduces: identify whether the cause is timing/contention or a genuine
      ordering dependency in the telemetry fixture.
- [ ] Apply the narrowest fix that makes the sub-test deterministic, or make the
      non-determinism explicit rather than incidental.
- [ ] Do not simply add a blanket retry to the aggregate gate — that would mask any real
      failure in the same sub-test.

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
