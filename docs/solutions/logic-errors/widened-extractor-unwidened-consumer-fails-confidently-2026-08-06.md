---
title: Widening an extractor without widening its consumer turns an honest failure into a confident wrong answer
track: bug
category: logic-errors
module: shared
tags: [bash, claude-hooks, parser-widening, consumer-contract, gh-cli, architecture]
applies_to: [.claude/hooks/**/*.sh, server/services/**/*.ts]
symptoms: [A hook or handler reports a confident well-formed result about the WRONG entity, The same input previously produced an empty result and an honest "could not verify", The regression appears only for inputs the widening newly accepts — every pre-existing input still behaves correctly, A parser change is described as "now handles more cases" with no consumer named]
created: '2026-08-06'
last_updated: '2026-09-01'
severity: high
---

# Widening an extractor without widening its consumer turns an honest failure into a confident wrong answer

## Problem

PR #766 widened `cmd_gh_pr_ref` in `.claude/hooks/lib/cmd-detect.sh` to skip value-taking
flags and return the ref that follows — including past `--repo owner/repo`, a case its
own docstring advertised as handled.

Its consumer, `.claude/hooks/pr-verify.sh`, then ran:

```bash
PR_JSON=$(gh pr view "$PR_REF" --json number,url,state,title 2>/dev/null)
```

with no `--repo` forwarded. `PR_REF` is a bare number, so `gh` resolved it in the
**current** repository.

The extractor now understood cross-repo commands. The consumer still could not express
one. Nothing in between noticed, because the extractor's output type — a string — is
identical in both cases.

## Symptoms

- A hook or handler reports a confident, well-formed result about the **wrong entity**.
- The same input previously produced an empty/undefined result and an honest "could not verify".
- The regression appears **only** for inputs the widening newly accepts — every input that already worked still works, so a regression suite over the old cases is entirely green.
- A parser/extractor change is described as "now handles more cases" and names no consumer.

## Root Cause

The extractor improved **in isolation** while its consumer's contract stayed narrow.

The decisive detail is the *direction* of the change. On `main`, `gh pr merge --repo
other-org/other-repo 42` produced no ref at all, so `pr-verify.sh` took its explicit
fallback branch:

```
WARNING: could not verify PR state after command (gh pr view failed).
Run `gh pr view` manually before reporting PR details.
```

After the widening, the same command produced `42`, which resolves in **this** repo —
where PR #42 exists (`feat: Coach improvements — retry, notebook, notifications,
conversation management`, MERGED). So the hook would have emitted:

```
PR state verified post-command — #42, url: https://github.com/Xertox1234/OCRecipes/pull/42, …
Use these values when reporting, not values from prior context.
```

about a PR in a different repository — with an instruction to trust it over context.

**The change converted a case that failed HONESTLY into one that failed CONFIDENTLY.**
That is strictly worse than the failure it replaced, even though the parser is
unambiguously more capable. Capability and safety moved in opposite directions and only
one of them was being measured.

## Solution

The fix **disqualifies** rather than forwards: `--repo`/`-R` in any spelling `gh`'s flag
parser accepts (`--repo v`, `--repo=v`, `-R v`, `-Rv`) returns empty, restoring main's
honest-failure behaviour.

```bash
if printf '%s' "$full_match" | grep -qE '(^|[[:space:]])(--repo([=[:space:]]|$)|-R)'; then
  return 1
fi
```

Verified against the shipped function — all four spellings return empty, while
`gh pr merge 42` → `42` and `gh pr merge feature-branch` → `feature-branch` are
untouched.

Forwarding was rejected for two reasons:

1. **It needs a second output channel** in a library that seven hooks source. `cmd_gh_pr_ref` returns one string on stdout; conveying a repo alongside the ref means a second channel and a migration of every caller — a large change to make one non-blocking verifier marginally more capable.

2. **It would have fixed three spellings out of four and left the fourth silently wrong.** Adding `--repo` to the value-flag skip list handles `--repo v`, `--repo=v`, and `-Rv` — all three yield `42`. But `-R other/repo 42` yields **`other/repo`**: `-R` is matched by the generic short-flag alternative, `other/repo` is not a flag, so it lands in the trailing ref position and the number is never reached. Measured on a variant of the shipped file with the disqualify block removed:

   ```
   gh pr merge --repo other/repo 42    => [42]
   gh pr merge --repo=other/repo 42    => [42]
   gh pr merge -Rother/repo 42         => [42]
   gh pr merge -R other/repo 42        => [other/repo]     <-- a DIFFERENT wrong answer
   ```

   A forwarding fix therefore makes the long and short forms disagree about what the ref
   even *is*. Disqualifying makes all four agree on empty. (`-R` is deliberately absent
   from the function's `prev` short-value-flag list so that list stays exactly the set
   derivable from `gh --help`; the disqualify regex is what covers it.)

The related URL-egress hole from the same widening was closed at the consumer boundary
instead — `pr-verify.sh` restricts a URL-shaped ref to `$GH_HOST` before forwarding it —
which is the other legitimate answer: **reject the newly-accepted input at the boundary**
when the consumer cannot honour it.

## Prevention

- **When widening what a parser or extractor ACCEPTS, enumerate its consumers and widen each — or reject the newly-accepted input at the boundary.** Those are the only two correct endings. Widening the extractor alone is not a third option; it is the bug.
- **State explicitly which direction the change moves the failure mode.** "Was it silent-and-wrong before, and is it silent-and-wrong now?" A change that converts *honest failure* into *confident wrongness* is a regression regardless of how much more the parser understands. Put that sentence in the PR description; it is the review question a diff of the parser alone cannot raise.
- **A regression suite over the old inputs cannot see this.** By construction the broken cases are the ones the widening newly admits, so every pre-existing test passes. New acceptance requires new tests naming the newly-accepted inputs *and asserting what the consumer does with them* — not just what the extractor returns.
- **Grep for the consumer's call, not the extractor's name.** `gh pr view "$PR_REF"` is where the contract is actually narrow; `cmd_gh_pr_ref`'s definition looks fine in isolation.
- **A docstring advertising a case is not evidence the case works end to end** — the same session produced three more instances of that, written up in [../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md](../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md).

## Second instance, 2026-09-01: the consumer read the wrong REPOSITORY

Same file, same class, and worth recording because the correct ending here was neither of
the two above on its own. `_CMD_GIT_GLOBALS` widened the `cmd_is_git_*` predicates to see
`git -C <path> commit`, `git --no-pager commit` and a redirect before the subcommand — all
previously invisible, so all previously ALLOWED by `branch-preflight.sh`'s detached-HEAD
data-loss gate.

Widening the predicate alone would have been strictly worse than the blindness it fixed.
All four consumers (`branch-preflight.sh`, `commit-verify.sh`, `drift-detect.sh`,
`drift-detect-update.sh`) read HEAD, the upstream, or the staged set **from their own cwd**
— correct only for as long as the matcher could not see a repo redirect. Newly matching
`git -C /elsewhere commit` would have made each of them judge this repository for a command
that never touches it: a false DENY on a correct command, and a silent pass on a broken one.

What made it tractable was noticing the consumers do not all want the same ending:

- `drift-detect.sh` / `drift-detect-update.sh` keep a **session-keyed** baseline holding
  *this* cwd's HEAD. Stamping it after an op that moved another repo's HEAD would ABSORB a
  real external drift here. Rejecting at the boundary — skip when the op is not about this
  repo — is not a fallback for them, it is the correct semantics.
- `commit-verify.sh` reports "these files are still staged"; against a redirected commit
  those are a different repo's files. It follows the resolved repo.
- `branch-preflight.sh` is the only one that genuinely needed resolution, and it needs it
  **twice** — once per check, with each check's own verb set, because
  `git -C /wt checkout -b foo && git commit` is about /wt for check 2 and about cwd for
  check 1.

The generalisation: *"widen the consumers too"* is under-specified when the consumers read
**state** rather than transform the value. Ask which state each one owns first; for some the
right answer is to decline the newly-accepted input, and shipping that as if it were a
shortfall would be the actual bug.

The resolution primitive (`cmd_git_repo_dir`) carries one rule that exists purely to
preserve the old behaviour: if *any* matched invocation in the command is unredirected, the
answer is cwd. Without it `git -C /wt commit && git commit` resolves to /wt, and the second
invocation's real, currently-denied cwd commit becomes an ALLOW. A hook-level differential
over a generated 660-command corpus (1320 paired runs) is what proves that: zero
DENY→ALLOW, 408 ALLOW→DENY. A lib-level differential would have been green either way,
because the *predicate* did not change its answer — the consumer did.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_gh_pr_ref` (value-flag skip, `--repo`/`-R` disqualify), `cmd_gh_pr_write_subcommand`
- `.claude/hooks/pr-verify.sh` — the consumer: host restriction, `gh pr view "$PR_REF"`, the honest-failure fallback branch
- `.claude/hooks/test-pr-verify.sh` — the covering test suite for both

## See Also

- [protocol-handler-bug-fix-all-consumers-2026-05-13.md](protocol-handler-bug-fix-all-consumers-2026-05-13.md) — the mirror case: a FIX applied to one consumer of a shared protocol and not the others. Same "enumerate the consumers" discipline, opposite direction.
- [widened-status-trigger-stale-hardcoded-copy-2026-07-16.md](widened-status-trigger-stale-hardcoded-copy-2026-07-16.md) — widening a condition without updating what it feeds; there the stale consumer was display copy, here it is a subprocess argument list
- [../best-practices/widening-helper-dependency-surface-test-blast-radius-2026-05-25.md](../best-practices/widening-helper-dependency-surface-test-blast-radius-2026-05-25.md) — the test-side companion: what a widened helper does to the blast radius
- [../best-practices/widening-allowlist-root-creates-hand-maintained-denylist-2026-07-08.md](../best-practices/widening-allowlist-root-creates-hand-maintained-denylist-2026-07-08.md) — the cost of widening an accept-set when the reject-set then has to be maintained by hand
- [../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md](../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — the general rule this is an instance of
