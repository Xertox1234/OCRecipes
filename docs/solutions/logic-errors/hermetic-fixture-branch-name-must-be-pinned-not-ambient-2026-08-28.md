---
title: "A hermetic git test fixture that relies on git init's ambient default branch name silently breaks against a hook that hardcodes a real branch name"
track: bug
category: logic-errors
tags: [bash, hooks, git, test-isolation, hermetic-tests, ci, harness]
module: shared
applies_to: [".claude/hooks/test-*.sh"]
symptoms: ["A hook self-test passes on every local run and every review pass, but fails in CI", "The failing assertion is specifically the one expecting a DENY/positive result — silent-allow/negative-result assertions in the same test file keep passing either way", "A hook that hardcodes a real branch name (e.g. BASE=\"main\") silently no-ops its check against a hermetic fixture repo", "`git rev-parse -q --verify origin/<branch>` fails inside the hook with no visible error (2>/dev/null swallows it)", "A helper that clones a bare fixture repo later fails with \"failed to push some refs\" for no apparent reason"]
created: 2026-08-28
severity: medium
---

# A hermetic git test fixture that relies on git init's ambient default branch name silently breaks against a hook that hardcodes a real branch name

## Problem

`pr-preflight-guard.sh`'s base-branch-drift check hardcodes `BASE="main"` — a deliberate,
documented scope decision, since every PR in this repo targets `main`. Its hermetic test
fixture (`test-pr-preflight-guard.sh`) built a throwaway repo + bare origin via plain
`git init`/`git init --bare`, captured whatever branch name that produced
(`git symbolic-ref --short HEAD`), and used that captured name consistently throughout its own
test logic. The tests passed on every local run and every review pass (three rounds of
independent `code-reviewer` verification, all running on macOS). CI failed on exactly one
assertion: the deny case, while the two allow-case assertions in the same 15a/15b/15c sequence
kept passing.

## Symptoms

- CI: `FAIL: overlapping base drift: deny — expected '"permissionDecision": "deny"' in: ` (empty).
- Locally, on every machine and every prior review pass: `ALL PASS`.
- The two OTHER drift-related tests in the same sequence (`no base drift: allow`,
  `base drift on an unrelated file: still allow`) never fail — because ALLOW is also the
  fail-open default outcome when the branch name simply doesn't resolve, so those assertions
  are silently vacuous under this bug and can't distinguish "correctly working" from "broken."
- A separate helper (`advance_origin`, cloning the bare fixture to simulate an upstream commit
  landing) later failed with `error: failed to push some refs to '...'` — a confusing secondary
  symptom of the SAME root cause, several lines removed from it.

## Root Cause

The test fixture's branch name came from `git init`'s **ambient default** — whichever branch
name a bare `git init`/`git init --bare` produces absent any explicit override, which is
governed by `init.defaultBranch` if set, else the git binary's own built-in default. That
built-in default is **not** the same everywhere: this session's local git (Apple Git 2.50.1)
defaults to `main` with no config set at all, while the CI runner's git apparently did not —
confirmed by reproducing the identical CI failure locally two ways: forcing
`git init --initial-branch=master` directly, and separately setting a **scoped**
`init.defaultBranch=master` via `GIT_CONFIG_GLOBAL` pointed at a throwaway `.gitconfig` (never
touching the real global git config).

The fixture captured whatever name resulted and used it *consistently within the test*, so
the test's own internal logic never disagreed with itself — but the **production hook**
being tested does not read that captured name at all; it hardcodes `"main"` by design. A
fixture whose branch happens to be `main` matches that hardcoded value by coincidence, not by
construction, and the coincidence held on every machine used to develop and review this
change until it met a CI runner where it didn't.

The bare origin needed the same fix independently, for a subtler reason: `git init --bare`
sets the new repo's `HEAD` symref from the ambient default **at creation time**, before
anything is ever pushed to it. Explicitly pushing `main` to it afterward does not retarget
that symref if it was created pointing at `refs/heads/master` — the bare repo's `HEAD` now
points at a branch that was never created, so `git clone` (which checks out whatever `HEAD`
points to) either fails outright or produces a broken/orphan checkout, which is what surfaced
downstream as "failed to push some refs" from an unrelated helper function.

## Solution

Pin the fixture's branch name explicitly with `--initial-branch=<name>` (git ≥2.28) on **both**
the working repo and the bare origin — matching whatever the hook-under-test actually
hardcodes, rather than letting either one fall through to the ambient default:

```bash
# Both need it independently — fixing only the working repo still leaves the bare
# origin's own HEAD symref pointing at whatever the ambient default was.
git init -q --initial-branch=main "$DREPO"
git init --bare -q --initial-branch=main "$DORIGIN"
DBASE="main"   # hardcode to match the hook's own hardcoded assumption — do not
               # `git symbolic-ref --short HEAD` and hope it matches
```

## Prevention

- **When a hermetic fixture must satisfy a hook that hardcodes a real name (a branch, a remote,
  an env var value), pin the fixture to that exact value — never capture "whatever the tool's
  ambient default happens to be" and assume it matches.** The two are only accidentally the
  same until they aren't.
- **A test assertion whose PASSING value is also the code's fail-open default cannot prove
  anything is working.** `no base drift: allow` and `base drift on an unrelated file: still
  allow` both stayed green throughout this exact bug, because "the branch didn't resolve, so
  the check silently skipped" produces the identical observable output as "the check correctly
  found no overlap." Only the DENY-expecting assertion could ever catch this — worth noting
  explicitly when writing a test suite where most cases are negative/allow: the positive/deny
  case is disproportionately the one doing real verification work.
- **Reproduce a CI-only failure by constructing the actual environment difference, not by
  re-running the same command hoping it flakes.** `GIT_CONFIG_GLOBAL=<scratch-file>` scopes a
  simulated ambient-default change to one subprocess without touching real global git config —
  safer than `git config --global` and instantly reversible (no restore step, no risk of
  forgetting to undo it).
- Don't assume "my machine's git default is main" generalizes — it depends on the git version
  and whatever `init.defaultBranch` config exists in that specific environment, which CI
  runners, other contributors' machines, and even a fresh install on the same machine can all
  set differently.

## Related Files

- `.claude/hooks/test-pr-preflight-guard.sh` — the fixed hermetic fixture (`DREPO`/`DORIGIN` init lines, `DBASE`).
- `.claude/hooks/pr-preflight-guard.sh` — the hook whose hardcoded `BASE="main"` the fixture must match.

## See Also

- [inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md](inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md) — a different way a hermetic git fixture's isolation assumption breaks silently, including a same-session extension covering a self-inflicted variant of that one too.
- [../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — the related principle that an assertion whose passing value overlaps the untested/broken state proves nothing.
