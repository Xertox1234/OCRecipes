---
title: "Port command-matching sibling hooks onto the shared quote-aware cmd-detect.sh (and verify git-safety's hypothesized false-DENY)"
status: backlog
priority: medium
created: 2026-07-18
updated: 2026-07-18
assignee:
labels: [deferred, harness, hooks, security]
github_issue:
---

# Port command-matching sibling hooks onto the shared quote-aware cmd-detect.sh

## Summary

The 2026-07-18 harness audit fixed quote-handling in the three PR/commit hooks by
introducing a shared quote-aware scanner (`.claude/hooks/lib/cmd-detect.sh`). Several
SIBLING hooks still do their own command-matching with cruder, quote-unaware approaches.
Port them onto the shared helper — and, as step 1, verify (or refute) a hypothesized live
false-DENY in `git-safety.sh` that the PR #662 `/code-review` flagged out-of-scope.

## Background

Command detection in shell hooks kept being re-derived per hook and re-broken. The PR-hook
fix (PR after `fix/quote-aware-cmd-detect-hooks`) collapsed three of them onto one
single-pass quote-state scanner. The audit surfaced that the harness now runs **four
distinct quote-handling architectures** across its matcher hooks; the remaining three are:

1. **No stripping at all** — `core-bare-guard.sh`, `drift-detect.sh`, `branch-preflight.sh`
   match against the RAW command (`[[ "$CMD" =~ $GIT_RE ]]` + `grep -qE "$COMPOUND_RE"`).
   Consequence: a quoted MENTION (`echo "git commit"`, `git commit -m "then git push"`)
   false-POSITIVES. All three are **warn-only / advisory** (drift warns; branch-preflight
   blocks only detached-HEAD; core-bare-guard auto-heals a bare `core.bare` and is
   effectively advisory), so this is **noise, not a gate bypass** — lower severity than the
   PR-hook bypasses, but the same root-cause smell.

2. **Content-keeping strip** — `git-safety.sh` uses `tr -d '\042\047'` (deletes quote
   CHARACTERS, keeps their CONTENTS) before matching mutating-git / write-shaped commands.
   This is a blocking, worktree-contract-gated DENY, so its false-match class is the
   highest-severity of the group.

## The git-safety false-DENY — UNVERIFIED, verify FIRST

The PR #662 review asserted git-safety.sh has a "live false-DENY." That claim was
out-of-diff-scope and is **NOT reproduced**. Primary-source reading of the hook shows the
DENY paths are all **worktree-contract-gated** (they fire only while a `declare-worktree.sh`
registry entry is active) — so it is _not_ the "one hook invocation" repro the reviewer
assumed; it needs registry setup, which is why it was deferred rather than repro'd live
(a live repro risks perturbing the active session's contract state).

**Hypothesized mechanism** (to confirm or refute): because `tr -d '\042\047'` keeps quoted
CONTENT, a benign command whose quoted argument contains a main-checkout absolute path plus a
write verb — e.g. `git commit -m "removed rm /Users/…/OCRecipes/x"` under an ACTIVE contract —
could have the write-shaped matcher (`>>?|(tee|rm|cp|mv)…|sed …-i`) fire on the string INSIDE
the message and DENY a legitimate commit. Confirm with a hermetic contract-registry fixture
(mirror `test-git-safety.sh`'s setup) before writing it up as fact.

## Acceptance Criteria

- [ ] Reproduce-or-refute the git-safety false-DENY with a hermetic test (active-contract
      registry + a benign git command whose quoted arg contains a main-checkout path + write
      verb). Record the verdict in this todo's Updates before any fix.
- [ ] If confirmed: fix git-safety's quote handling by adopting `cmd-detect.sh` (extend the
      helper with the predicates it needs — e.g. a quote-aware write-redirect/target
      extractor — rather than re-deriving), with a red test for the false-DENY case.
- [ ] Port `core-bare-guard.sh`, `drift-detect.sh`, `branch-preflight.sh` to source
      `cmd-detect.sh` and use `cmd_is_git_commit` / a shared mutating-git predicate, so
      quoted mentions stop false-positiving. Each gets a "quoted mention stays silent"
      regression test.
- [ ] Any BLOCKING hook that adopts the helper encodes an explicit fail-CLOSED fallback for
      an unsourceable lib (never fail-open); advisory hooks fall back to silent. Test both.
- [ ] All existing `test-*.sh` suites for the touched hooks stay green.

## Implementation Notes

- Helper: `.claude/hooks/lib/cmd-detect.sh` — `cmd_bare` (single-pass quote-state awk scan)
  plus predicate functions. Extend it with new predicates rather than inlining regex in a hook.
- Files in scope: `.claude/hooks/git-safety.sh`, `core-bare-guard.sh`, `drift-detect.sh`,
  `branch-preflight.sh`, `.claude/hooks/lib/cmd-detect.sh`, and each hook's `test-*.sh`.
  (`guard-worktree-isolation.sh` matches on CWD/path, not the command string — out of scope
  unless a command-string matcher is found there during the work.)
- Reference the root-cause solution: `docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md`.
- Keep the guardrail-not-sandbox framing: document arg-taking-wrapper and `$'…'` residuals,
  do not pretend regex closes them.

## Scope Contract

- **Mechanisms to use:** the existing shared `cmd-detect.sh` helper (extend with predicates);
  the standard `test-*.sh` hermetic-hook test pattern. No new matching architecture.
- **Files in scope:** the four hooks + `cmd-detect.sh` + their tests, listed above.
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- git-safety.sh is a live, contract-gated blocking gate — changes must be verified
  fail-closed and must not weaken the real worktree-contract DENY it exists to provide.
- Never delegate: touches git-safety / branch guards. Keep in the primary session.

## Updates

### 2026-07-18

- Initial creation, deferred from the `fix/quote-aware-cmd-detect-hooks` PR (Option 1 of the
  2026-07-18 harness-audit `/code-review` follow-up). git-safety false-DENY recorded as
  UNVERIFIED pending a hermetic contract-registry repro.
