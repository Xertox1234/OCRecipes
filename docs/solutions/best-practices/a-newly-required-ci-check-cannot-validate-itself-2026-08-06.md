---
title: A newly-required CI check cannot validate itself — verify it against main's tip separately
track: knowledge
category: best-practices
module: shared
tags: [ci, github-actions, required-checks, merge-safety, testing, architecture]
applies_to: [.github/workflows/**, package.json, scripts/preflight.sh]
symptoms: [A PR that ADDS a CI gate is green and that green is being read as evidence the gate passes on main, A newly-landed repo-wide gate turns main red on the very next push, Someone proposes rebasing every open PR because a new gate landed]
created: '2026-08-06'
---

# A newly-required CI check cannot validate itself — verify it against main's tip separately

## Rule

Adding a **newly-required** CI check is the one change whose own green tick cannot
validate it. The tick proves the check passes on **this PR's merge ref**; it says
nothing about main's **current tip**, because the check did not exist when that tip was
last verified. Every commit main gained since this branch's merge-base went in under the
old, weaker gate.

Verify against current main **separately, before merging**.

The reassuring half is worth stating too, because the instinct on landing a repo-wide
gate is to assume every open PR is about to go red: **it won't**. GitHub CI evaluates
the **merge ref** (branch ⊕ current main), not the bare branch tip — so once the gate
lands, open PRs pick up both the gate and any fixes that landed with it automatically.
A repo-wide gate does not force a rebase round.

## Smell patterns

- A PR description arguing "CI is green, so the repo is clean" about a PR that *adds* the check.
- A new required check whose merge-base is more than a few commits behind main.
- A gate whose glob is broader than the diff that introduced it (the whole point — and exactly why its own PR can't cover it).

## Why

The merge ref proves one thing: *branch ⊕ current-main passes*. That is genuinely
useful — it means the gate is satisfiable — but it is computed once, at the moment CI
last ran, against whatever main was **then**. A gate PR that sat for a day while main
advanced has a green tick describing a repository state that no longer exists.

The failure mode is not subtle but it is silent: merge the gate, main's next push runs
it for the first time against files nobody checked, and **main goes red**. Now the
branch that broke it is `main` itself, so there is no PR to fix — every subsequent PR
inherits a red required check it did not cause.

## Examples

PR #765 added `npm run check:format` to `.github/workflows/ci.yml`. Its 10/10 green was
computed against merge-base `d51578df`, while main had already advanced to `099b7e4c`.
The tick covered the branch and `d51578df`; it covered none of the commits in between.

Before merging, the gap was enumerated explicitly: main had gained **seven** files
inside the check's glob (`**/*.{js,ts,tsx,css,json}`) — the `ProductChip`/`ScanReticle`/
`StepPill` util extractions, `ScanScreen.tsx`, `scan-screen-utils.ts` and two test files,
all from PR #763. Running `prettier --check` against those seven at `099b7e4c` returned
clean, so the gate was safe to land.

Note what the enumeration is *for*. Seven files is a small enough set to check by hand,
and they came from a single PR — but none of that was knowable before running step 2,
and the answer would have been the same shape (a list, then a check) had main advanced
by fifty commits. The procedure is cheap enough that "main has barely moved" is never a
reason to skip it, only a prediction about what it will return.

### Procedure

```bash
# 1. Where did this branch fork from?
git merge-base origin/main <branch>

# 2. What did main gain since then, inside the new check's glob?
#    (check:format's glob is **/*.{js,ts,tsx,css,json})
git diff --name-only <merge-base> origin/main

# 3. Run the check against those files at MAIN'S TIP — not at the branch,
#    and not against the whole repo (that hides which files are new risk).
git switch --detach origin/main
npx prettier --check <the filtered file list>

# 4. Merge only if clean. If not clean, the fix belongs in the gate PR:
#    it must land in the SAME merge as the gate, or main is red between them.
```

Step 3's detach matters. Running the check from the branch checks the branch's copies of
those files, which may include fixes the branch made — precisely the files whose main
state you are trying to judge.

If step 3 is not clean, do **not** land the gate and file a follow-up. The window
between "gate merged" and "fix merged" is a red main.

## Exceptions

- **Advisory (non-required) checks don't need this.** A check that reports but does not
  block can land red and be fixed forward; the whole cost is a noisy tick. This
  procedure is specifically about the transition to *required*.
- **A gate whose glob is fully contained in the PR's own diff** is self-validating by
  construction — but confirm that, don't assume it. The usual reason to add a gate is
  that it covers files the PR doesn't touch.
- **A gate added at the same time as the branch is cut from main's tip** has an empty
  step 2. Re-run step 1 rather than trusting the branch's age; a `git pull` in the
  middle of the work moves the merge-base without announcing it.

## Related Files

- `.github/workflows/ci.yml` — the "Format check" step added by PR #765
- `package.json` — `check:format`, `lint-staged`
- `scripts/preflight.sh` — full-mode `check:format` line

## See Also

- [promote-ci-check-to-required-status-check-2026-06-22.md](promote-ci-check-to-required-status-check-2026-06-22.md) — the branch-protection mechanics of making a check required (PATCH the sub-resource; only require a check that runs on every PR). This file is the content half: *is the thing you are about to require actually satisfiable on main?*
- [../conventions/prettier-glob-mismatch-commit-hook-vs-ci-2026-08-05.md](../conventions/prettier-glob-mismatch-commit-hook-vs-ci-2026-08-05.md) — the sibling finding from the same PR: diff the write-time glob against the read-time glob before calling a newly-wired check "enforced everywhere"
- [batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md](batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md) — the same shape one level up: a green/clean signal computed against a main that has since moved
