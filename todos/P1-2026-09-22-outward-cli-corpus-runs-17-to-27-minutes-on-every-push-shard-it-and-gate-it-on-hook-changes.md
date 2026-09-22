---
title: "The Outward-CLI guard corpus is a required check that runs 17–27 minutes on EVERY pull-request push, including docs-only ones — shard it across runners and gate it on .claude/hooks/** changes behind an always-reporting status job"
status: backlog
priority: high
created: 2026-09-22
updated: 2026-09-22
assignee:
labels: [harness, ci, testing]
github_issue:
---

# Every PR waits 17–27 minutes for a corpus that most PRs cannot affect

## Summary

`.github/workflows/ci.yml` job `outward-cli-corpus` ("Outward-CLI guard corpus") is one of
`main`'s required checks and has **no job-level path filter, deliberately** (its own comment: a
path-filtered job reports `skipped`, which sits permanently pending when the job is required).
The workflow-level `paths-ignore` only affects `push`; the `pull_request` trigger carries no
filter. So every PR push runs the full 2160-row corpus: measured 17m25s, 22m40s, 26m32s this
month, against a 30-minute cap — including PR #1013, a docs-only change that could not have
altered a verdict. The user's ruling on 2026-09-22: "whatever is fastest — 26 minutes is too
long; I may even drop it if a commit is going to take that long. We make a lot of commits in a
day."

## Background

The corpus is the only thing that pins the guard's per-row verdicts and deny-site attribution;
dropping it outright re-opens the class of silent regressions it was built to catch (PR #957 and
after). But its cost lands on every merge, and the todos that want new axes
(`todos/P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-git-safety-layers.md`,
shape 2) are blocked on budget. Two independent levers exist and both are standard GitHub
Actions patterns.

## Acceptance Criteria

- [ ] **Gate on relevance without breaking the required check.** The corpus job itself gets a
      `paths` condition (or a `dorny/paths-filter`-style step) so it runs only when the PR
      touches `.claude/hooks/**` or the corpus script; a SEPARATE always-running job with
      `if: always()` becomes the required check, succeeds when the corpus job was `skipped` or
      `success`, and fails when it `failure`/`cancelled`/`timed_out`. The required-check NAME
      moves to that status job (a renamed required check leaves the old one pending forever —
      update branch protection in the same change, and say so in the PR).
- [ ] **Shard the corpus** so that when it does run it finishes in a fraction of the time: a
      matrix of N runners each taking a deterministic slice of the row ids (the script already
      keys rows by id), with the pins checked ONCE over the union (the per-id manifests and
      the row/gap totals must be aggregated, not checked per shard — a per-shard total pin is
      meaningless). Measure the completed wall time of the sharded run in CI and record it.
- [ ] Both levers land together or the shim lands first; never the path filter alone on the
      required job.
- [ ] The corpus still runs unsharded on a schedule (nightly) as the drift backstop, since a
      sharding bug that drops a slice would otherwise read as green.
- [ ] `.github/workflows/ci.yml`'s ALWAYS-ON comment block is rewritten to describe the new
      shape; `docs/rules/harness.md` and the guard-PR mechanics memory are updated: "every
      `.claude/hooks/**` edit triggers the corpus" stays true, "every push does" stops being.
- [ ] If neither lever brings a hook-touching PR under ~8 minutes, propose the fallback the user
      named — demote the full corpus to nightly and keep a fast required subset — as its own
      decision rather than shipping it silently.

## Implementation Notes

- `repro-outward-cli-corpus.sh` pins `EXPECTED_ROWS`, `EXPECTED_DENY_ATTRIB_ROWS`,
  `EXPECTED_PRECISE_GAPS`, `EXPECTED_ALLPATH_GAPS`, per-id manifests and `EXPECTED_EMIT_SITES`.
  Sharding needs a `--shard i/N` mode that emits its rows' verdicts to an artifact and a
  `--aggregate` mode that re-derives every pin from the union; the deny-site pin (`_pin_sites`)
  parses the guard SOURCE and is shard-independent.
- The status-job pattern: `needs: [outward-cli-corpus]`, `if: always()`, then
  `if [ "${{ needs.outward-cli-corpus.result }}" = success ] || [ … = skipped ]; then exit 0;
else exit 1; fi`. Name it what branch protection requires.
- Runner variance dominates the row-count effect (17m25s vs 22m40s on the same rows), so quote
  the RANGE of the sharded run, never one run.
- `scripts/run-hook-tests.sh` is separate and stays in the lint/types/patterns job.

## Scope Contract

- **Mechanisms to use:** GitHub Actions `paths`/`if: always()` job gating, a matrix shard of the
  existing corpus script, and the existing pin machinery. No new guard, no change to any
  verdict.
- **Files in scope:** `.github/workflows/ci.yml`, `.claude/hooks/repro-outward-cli-corpus.sh`,
  `docs/rules/harness.md`, branch-protection settings (out-of-tree; record the change in the PR).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Blocks the redirect-in-arg shape-2 axis and any other corpus growth.

## Risks

- A renamed required check that is not updated in branch protection blocks every PR until
  someone notices — do it in the same change and verify with `gh api` before merging.
- A shard that silently returns zero rows makes its slice's regressions invisible; the aggregate
  must assert the union row count equals `EXPECTED_ROWS`, not just that no shard failed.
- The corpus's own fail-closed pins wedge every open PR when they drift; a sharded re-pin must
  be re-derived from a COMPLETED aggregated run, exactly as before.

## Updates

### 2026-09-22

- Filed on the user's in-session ruling (decision 10 of the harness survey). Priority `high` on
  the user's own words about commit throughput, not on defect severity.
