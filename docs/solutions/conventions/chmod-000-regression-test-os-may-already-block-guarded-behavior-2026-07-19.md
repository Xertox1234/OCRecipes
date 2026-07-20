---
title: A chmod-000 regression test may not discriminate a guard — the OS can already block the guarded behavior on its own
track: knowledge
category: conventions
module: shared
tags: [testing, regression-tests, permissions, bash, hooks, worktrees]
applies_to: [.claude/hooks/*.sh, .claude/hooks/test-*.sh]
created: '2026-07-19'
---

# A chmod-000 regression test may not discriminate a guard — the OS can already block the guarded behavior on its own

## Rule

When writing a regression test for a permission-triggered code path (a guard that
special-cases "this file/dir is unreadable") using a `chmod 000` fixture, **verify
the test actually goes RED against the pre-fix code** before trusting it as a real
regression catcher — do not assume a passing test proves the guard is load-bearing.
Temporarily strip the guard (or diff/checkout the pre-fix version), rerun the suite,
and confirm the new assertion fails. If it doesn't fail, the fixture is a
postcondition pin (asserts the desired end state) rather than a proof the guard is
necessary — that's still worth keeping, but say so in a comment rather than implying
it caught the bug.

## Smell patterns

- A new test case added alongside an `[ -r ]`/`[ -x ]`-style readability guard,
  built on `chmod 000` + an `rm -rf`/similar destructive operation, without ever
  having reverted the guard to confirm the test fails without it.
- The test explicitly skips the case when running as root ("permission bits don't
  bind for root") — that is frequently the ONLY case where the guard's absence
  would actually change the destructive operation's outcome, since root bypasses
  file-mode permission checks entirely. If root is skipped and the non-root case
  can't be made to fail either, the fixture may never be able to go red on any
  reachable platform.

## Why

Recursive delete tools (`rm -rf` and equivalents) generally refuse to traverse or
remove a directory they cannot open for reading (needs read + search/execute
permission) — a `chmod 000` directory triggers this refusal in the tool itself,
independent of any application-level guard checking `[ -r ]`/`[ -x ]` first. So a
test built by (1) `chmod 000` a directory, (2) running the hook, (3) asserting the
directory survives, can pass identically whether or not the application-level guard
exists — both the buggy code (which still attempts `rm -rf` and has that attempt
silently refused by the OS) and the fixed code (which skips the attempt entirely via
the guard) produce the same observable outcome: the directory survives. The two
codepaths are only distinguishable in an environment where the destructive
operation is NOT blocked purely by file-mode permissions — most concretely, running
as root, which is usually (and correctly) the case a test author skips as "not
meaningful" for chmod-based fixtures.

Confirmed empirically on macOS/BSD `rm`: reverting the `[ -r ] && [ -x ]` guard in
`.claude/hooks/worktree-deps.sh` and rerunning `.claude/hooks/test-worktree-deps.sh`
still passed all 22 cases, including the new "unreadable node_modules is NOT
removed" assertion — the guard's absence made zero observable difference in that
environment, because `rm -rf` on the mode-000 directory already no-oped.

## Examples

```bash
# Before trusting a new chmod-000 test case, prove it can fail:
cp .claude/hooks/worktree-deps.sh /tmp/pre-fix.sh
# ...revert the uninspectable-dir guard (probe-status gate) in /tmp/pre-fix.sh...
HOOK=/tmp/pre-fix.sh bash .claude/hooks/test-worktree-deps.sh   # does the new case go RED?
```

If it stays green, comment the test to say so explicitly rather than implying it
proves the guard fires — e.g. "may not go RED against the pre-guard hook on every
`rm` implementation; still pins the desired end state and is cheap insurance for
any environment where that isn't true (e.g. running as root)."

## Exceptions

- The caveat applies exactly when the OS itself already blocks the guarded
  operation on the fixture. If the destructive step would otherwise SUCCEED on a
  mode-000 fixture (an immutable-flag check, a network-mediated permission check,
  an operation that never opens the directory), a `chmod 000` fixture can
  discriminate. An application-level `[ -r ]`-style gate in front of `rm -rf` is
  NOT such a case — that is this file's own empirical result: stripping the gate
  re-exposes `rm`'s own open() refusal, so the fixture stays green either way.
  Verify per case rather than assuming either direction.
- Don't over-invest in fixing this for a low-severity/harness-tooling test — a
  same-platform empirical check (revert the guard, rerun) is enough; standing up
  cross-platform CI just to validate one self-test fixture is disproportionate.

## Related Files

- `.claude/hooks/worktree-deps.sh` — the uninspectable-node_modules guard this
  pattern was found while testing (originally `[ -r ] && [ -x ]` bit checks, since
  replaced by gating on the probe's own exit status — the empirical history above
  describes the original form)
- `.claude/hooks/test-worktree-deps.sh` — the "unreadable node_modules" test case
  that could not be made to fail against the reverted guard on macOS/BSD `rm`

## See Also

- [Regression-test fixtures must reproduce the real dependency's output verbatim](../best-practices/test-fixture-must-match-real-dependency-output-2026-05-15.md) — a sibling "verify what your test actually proves" caution, about fixture fidelity rather than OS-level masking
