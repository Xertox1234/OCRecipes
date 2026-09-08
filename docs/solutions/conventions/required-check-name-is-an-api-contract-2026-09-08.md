---
title: A required status check's NAME is an API contract — a renamed job never satisfies it, so nothing can merge
track: knowledge
category: conventions
tags: [ci, github-actions, branch-protection, harness, hooks, tooling, merge]
module: shared
applies_to: [.github/workflows/*.yml, .claude/hooks/**, scripts/**/*.sh]
created: '2026-09-08'
---

# A required status check's NAME is an API contract

## Rule

**Never put a value that can change into the `name:` of a job that is a required status
check.** Branch protection stores the requirement as an exact string and matches on it.
A renamed job does not *fail* the requirement — it never *satisfies* it, so the check sits
permanently `expected` and **every PR in the repository is unmergeable** until an admin
edits branch protection.

Put counts, versions, durations and row totals in a comment, where they can be corrected
by anyone with push access.

## Smell patterns

- `name: Test suite (1,240 tests)` — the count changes every time someone adds a test.
- `name: Build (node 22)` — changes at the next toolchain bump.
- `name: Guard corpus (427 rows x 4 paths)` — the real one; see below.
- Any job name a reviewer would reasonably "keep accurate" during an unrelated change.

## Why

The failure is asymmetric and does not look like a failure. A red check tells you what
broke, in a log. A *missing* check tells you nothing — the PR simply says a check is
expected, and the natural reading is "CI is still running."

2026-09-08, PR #935: the corpus job was named
`Outward-CLI guard corpus (427 rows x 4 paths)` and was added to `main`'s required checks
under exactly that string. The PR grew the corpus to 448 rows and updated the name to
match — the accurate, obviously-correct edit. Every one of the eleven check runs passed,
and the merge was refused:

```
405 Required status check "Outward-CLI guard corpus (427 rows x 4 paths)" is expected.
```

Nothing was wrong with the code, the tests, or the guard. The contract had been renamed.

Note also what `mergeable_state` said: `blocked`, computed ten minutes before the last
check finished. It is lazily recomputed and routinely stale, so it is not the instrument
for "is this ready" — read the check runs, and read the merge API's own refusal.

## Examples

```yaml
# WRONG — the count is part of the contract
outward-cli-corpus:
  name: Outward-CLI guard corpus (448 rows x 4 paths)

# RIGHT — stable name; the count lives where it can be corrected freely
#
# The outward-CLI guard's executable ground truth: 448 constructions x 4 execution paths.
# THE `name:` BELOW IS AN API CONTRACT. Branch protection matches it as an exact string.
outward-cli-corpus:
  name: Outward-CLI guard corpus
```

## Exceptions

None for a required check. For an advisory job the name is free — but "advisory" is a
state that changes, and it changed for this job within a week of being written down. If a
job is a plausible future requirement, name it as though it already is.

## If you must rename one anyway

Order matters, and every open PR is blocked in between — do it when the queue is empty:

1. Push the rename, so the new name actually appears on a run.
2. `PATCH /repos/{o}/{r}/branches/{b}/protection/required_status_checks` — the **narrow
   sub-resource**. Never the top-level `/protection` endpoint: it REPLACES the entire
   configuration and silently drops `enforce_admins`, the PR-review requirement, and
   everything else you did not restate.
3. Merge.

Build the payload from a fetched backup of the current config, and diff everything outside
`required_status_checks` byte-for-byte afterwards. Check names containing typographic
characters (`Lint · Types · Patterns` has a middle dot) are easy to mistype into
un-requiring a check, and that failure is silent in the safe-looking direction.

## Related Files

- `.github/workflows/ci.yml` — the `outward-cli-corpus` job and the contract comment above it
- `.claude/hooks/repro-outward-cli-corpus.sh` — points at the job by its stable name

## See Also

- [A CI job that is neither required nor watched is invisible](../best-practices/a-ci-job-neither-required-nor-watched-is-invisible-2026-08-15.md) — the other half: a job nobody requires can fail from its first run forever
- [A glob-driven runner loop passes green when the glob matches nothing](../logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — same family: a name that stops matching, and nothing says so
- [Reading CI status during an infrastructure incident](../best-practices/reading-ci-status-during-an-infrastructure-incident-2026-08-06.md) — why a derived status field is not the instrument to read
