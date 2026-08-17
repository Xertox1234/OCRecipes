---
title: "cmd-detect.sh's _CMD_POS_PREFIX/_CMD_POS_SUFFIX miss brace/backtick/bang/separator boundaries"
status: backlog
priority: high
created: 2026-08-17
updated: 2026-08-17
assignee:
labels: [security, harness]
github_issue:
---

# cmd-detect.sh's \_CMD_POS_PREFIX/\_CMD_POS_SUFFIX miss brace/backtick/bang/separator boundaries

## Summary

The shared command-position anchor (`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` in
`.claude/hooks/lib/cmd-detect.sh`, used by every `cmd_is_git*`/`cmd_is_gh_pr_create`
matcher) doesn't recognize `{ }`, backtick, or `!` as valid command-position openers,
and doesn't recognize `;`, `&`, `|`, backtick, `{`, `}` as valid boundary closers after
the matched verb — so a brace-grouped, backtick-substituted, `!`-prefixed, or
no-space-before-separator real invocation is invisible to every matcher that relies on
this anchor, even after the `cmd_bare`→`cmd_words` migration (PR #850) closed the
quoting-based bypass class.

## Background

Surfaced during the `/code-review` follow-up pass on PR #850 (`fix/cmd-words-quoting-bypass`),
2026-08-17, and empirically reproduced by sourcing the lib and running the matchers
directly (not just reading code):

- `cmd_is_git_commit '{ git commit -m x; }'` → MISSED (control `git commit -m x` → DETECTED)
- ``cmd_is_git_commit '`git commit -m x`'`` → MISSED
- `cmd_is_git_commit '! git commit -m x'` → MISSED
- `cmd_is_gh_pr_create '{ gh pr create --fill; }'` → MISSED
- ``cmd_is_gh_pr_create '`gh pr create --fill`'`` → MISSED
- `cmd_is_git_commit 'git commit;date'` (no space before `;`) → MISSED (control with a space → DETECTED)

**Real bash semantics matter here**: `{ ...; }` executes its body in the CURRENT shell
(no subshell), and a backtick span runs its contents as a command substitution — both
genuinely invoke `git`/`gh`, so these are real ALLOW-when-should-DENY gaps, not
theoretical corner cases.

**Impact**: `pr-preflight-guard.sh` (blocking DENY gate — no fresh preflight stamp
demanded) and `branch-preflight.sh` (blocking DENY gate) both consult these matchers
directly. `commit-verify.sh`, `drift-detect.sh`, `drift-detect-update.sh` (advisory)
are affected the same way for their respective verbs.

**Note**: `guard-outward-cli.sh` is UNAFFECTED — it uses its own wider
`_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX` (already includes these characters). Only the
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` pair shared by the git/gh-pr-create family has this
gap. This regex text was NOT touched by PR #850 — it's a pre-existing gap, confirmed
present on `main` before that branch, not a regression introduced by it.

## Acceptance Criteria

- [ ] `_CMD_POS_PREFIX` in `lib/cmd-detect.sh` recognizes `{`, backtick, and `!` as
      valid command-position openers (matching `guard-outward-cli.sh`'s
      `_OUT_POS_PREFIX` treatment).
- [ ] `_CMD_POS_SUFFIX` recognizes `;`, `&`, `|`, backtick, `{`, `}` as valid boundary
      closers (in addition to whitespace, `)`, and end-of-string).
- [ ] All six reproduction cases above now DETECT correctly.
- [ ] `test-cmd-detect.sh` gains regression pins for all six cases (brace-grouped,
      backtick-substituted, `!`-prefixed openers; no-space-before-separator closer) for
      at least `cmd_is_git_commit` and `cmd_is_gh_pr_create`.
- [ ] `test-pr-preflight-guard.sh` and `test-branch-preflight.sh` (if it exists) gain
      an end-to-end reproduction of at least the brace-grouped case, piped into the
      live hook.
- [ ] Full `scripts/run-hook-tests.sh` suite (34+ suites) still passes.

## Implementation Notes

Compare against `guard-outward-cli.sh`'s `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX` (already
correct) as the reference implementation — this todo is essentially "bring
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` up to the same character-class coverage."

## Scope Contract

- **Mechanisms to use:** widen the two shared regex character classes in
  `lib/cmd-detect.sh`; no new functions or files.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/test-cmd-detect.sh`,
  `.claude/hooks/pr-preflight-guard.sh`, `.claude/hooks/branch-preflight.sh` (tests only,
  unless the widened regex needs escaping fixes at the call sites).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of `todos/P1-2026-08-17-quoted-command-substitution-inert.md`
  (same review round, different root cause — that one is about `$(...)`/backtick
  CONTENT being inert inside quotes; this one is about the anchor regex's own
  character classes).

## Risks

- Widening `_CMD_POS_SUFFIX` to accept `;`/`&`/`|`/backtick/`{`/`}` as closers could, in
  principle, make an existing "should NOT match" negative-control test start matching —
  re-run the full `test-cmd-detect.sh` negative-control section (mentions inside
  quotes, flag values, etc.) after the change, not just the new positive cases.

## Updates

### 2026-08-17

- Filed from the PR #850 `/code-review` follow-up pass, per user decision to file
  pre-existing repo-wide gaps for a dedicated session rather than expand this PR's scope.
