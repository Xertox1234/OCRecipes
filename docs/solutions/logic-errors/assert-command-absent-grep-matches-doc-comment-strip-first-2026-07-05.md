---
title: An assert-absence grep on a script matches the command named in a doc comment — strip comments first
track: bug
category: logic-errors
module: shared
severity: low
tags: [shell, grep, hook-self-tests, assertions, comments, husky, false-positive, tdd]
symptoms: [A "hook must NOT run X" self-test fails RED even though the hook never executes X, The offending match is a doc comment that names the command (e.g. a pointer to where moved logic lives), The naive fix is to delete a useful comment just to satisfy grep]
applies_to: [.claude/hooks/**, .husky/**, scripts/*.sh]
created: '2026-07-05'
---

# An assert-absence grep on a script matches the command named in a doc comment — strip comments first

## Problem

A hook self-test verified that `.husky/pre-commit` no longer invokes the semantic gate:

```bash
check "pre-commit does NOT invoke any preflight"  "! grep -q 'preflight.sh' '$HOOK'"
```

But the rewritten hook keeps a **deliberately helpful doc comment** pointing to where the
gate moved:

```bash
# tsc + related tests) runs once at pre-push (scripts/preflight.sh --fast), not per commit.
```

`grep -q 'preflight.sh'` matches that comment line, so the absence assertion fails RED even
though the hook never *executes* preflight. The test and the hook were internally
contradictory: the hook's own documentation defeats the test that guards the hook.

## Symptoms

- A "script must NOT run X" test fails despite the script genuinely not running X.
- The only match is a comment that names X (often an intentional "moved to …" pointer).
- The tempting "fix" is to strip the comment — trading real documentation for a green bar.

## Root Cause

`grep 'X' file` matches **every** line — code and comment alike. An absence assertion means
"X is not *invoked*", but a raw grep tests "X is not *mentioned*". Those two diverge exactly
when a comment legitimately mentions X. Letting the test dictate deletion of the comment is
the tail wagging the dog: the assertion should bend to express its real intent, not the
documentation bend to satisfy a naive matcher.

## Solution

Strip shell comment lines before grepping, so the check tests invocation, not mention:

```bash
# "invoke" = a NON-comment line runs it. A doc comment pointing to where the gate moved
# (pre-push) is desirable, so strip comment lines before checking for an invocation.
check "pre-commit does NOT invoke any preflight"  "! grep -vE '^[[:space:]]*#' '$HOOK' | grep -q 'preflight.sh'"
```

`grep -vE '^[[:space:]]*#'` drops full-line comments; the survivors are executable lines, so a
remaining match is a real invocation. `!` negates the whole pipeline (bash applies `!` to the
pipeline, not just the first command), and under `set -uo pipefail` the pipeline's exit is the
last stage's — `grep -q` returns 1 when the command is absent, so the assertion passes.

## Prevention

- Any test that asserts a token is **absent** from a script must scope to the lines where the
  token would take effect (strip comments; strip quoted strings if the token could appear in a
  string literal), not the raw file text.
- The inverse holds for **presence** assertions on behavior: `grep -q 'X'` can false-PASS on a
  comment that merely names X. Positive behavioral checks should likewise exclude comments.
- When a plan hands you an absence check that would forbid a string appearing anywhere, prefer
  keeping a genuinely useful comment and tightening the check over deleting the comment.

## Related Files

- `.claude/hooks/test-precommit-gate.sh` — the comment-stripped absence assertion (post-fix)
- `.husky/pre-commit` — carries the intentional `scripts/preflight.sh --fast` doc pointer that the raw grep matched

## See Also

- [probes that signal absence by empty output must also check the exit code](empty-probe-output-needs-exit-code-check-2026-07-02.md) — sibling shell absence-detection gotcha
- [prettier wraps fixture tags and breaks a hook-equivalence grep](prettier-wraps-fixture-tags-breaks-hook-equiv-grep-2026-06-21.md) — another grep-based hook check defeated by incidental text
- [inherited GIT_DIR overrides git -C in hook self-tests](inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md) — sibling hook self-test hermeticity gotcha
