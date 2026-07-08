---
title: 'Grep-matched git CLI error text for expected-vs-real-failure classification breaks across git versions'
track: bug
category: logic-errors
module: server
severity: medium
tags: [bash, git, cli, version-dependent, error-message, grep, worktree, branch-delete]
applies_to: ['.claude/skills/*.md', '.claude/agents/*.md', 'scripts/*.sh']
symptoms: ['A git branch -D failure is silently swallowed even though it is not the expected/benign refusal case', 'A WARNING or diagnostic line meant to fire only on unexpected git failures fires on every attempt instead', 'Code that classifies a git command failure as expected vs real by grepping its stderr text works in dev but misclassifies on a different git version']
created: '2026-07-07'
last_updated: '2026-07-07'
---

# Grep-matched git CLI error text for expected-vs-real-failure classification breaks across git versions

## Problem

A cleanup script needs to distinguish "this `git branch -D` failed for the expected,
benign reason (branch checked out elsewhere)" from "this failed for a real, actionable
reason (stale lock file, permissions, corrupted ref)" so it can stay silent on the former
and surface a `WARNING:` on the latter:

```bash
out=$(git branch -D "$b" 2>&1) && echo "deleted local branch: $b" \
  || { echo "$out" | grep -q "checked out at" || echo "WARNING: could not delete local branch $b: $out"; }
```

This was written from memory of git's error wording and never executed against the real
CLI before being drafted into a PR. Live-testing it against the actual target scenario
(deleting a branch checked out in a different linked worktree) revealed the grep pattern
never matches on git 2.50.1 — every single expected-refusal case would have incorrectly
printed a `WARNING:` line, defeating the entire point of the fix.

## Symptoms

- A `WARNING:`/diagnostic line fires on the routine, expected case instead of staying silent.
- Code review or static reasoning about the fix looks correct — the bug only surfaces when
  the exact command is actually run against the real tool version in use.
- The mismatch is invisible unless you deliberately construct BOTH the "real failure" and
  "expected refusal" scenarios and run the classification logic against real output, not
  assumed output.

## Root Cause

Git's error message wording for "cannot delete a branch checked out in a worktree" changed
between versions:

- Older git: `error: '<branch>' is checked out at '<path>'` (or similar "checked out at" phrasing)
- git 2.50.1 (and other recent versions): `error: cannot delete branch '<branch>' used by
  worktree at '<path>'`

A `grep -q "checked out at"` pattern written from memory/training data (or copied from an
older git's documented wording) silently stops matching once the installed git version has
moved to the newer phrasing. Because the mismatch produces no error of its own — the `grep`
just returns non-zero and the `||` branch runs — this fails **silently wrong**, not loudly
broken; nothing signals that the classification is off.

## Solution

Match every known wording variant, not just one:

```bash
out=$(git branch -D "$b" 2>&1) && echo "deleted local branch: $b" \
  || { echo "$out" | grep -qE "checked out at|used by worktree at" || echo "WARNING: could not delete local branch $b: $out"; }
```

Verified live against `git --version` 2.50.1 (Apple Git-155) for both branches: deleting a
branch checked out in a different linked worktree (the expected-refusal case) now stays
silent; deleting a non-existent branch (`error: branch '...' not found`, a real failure)
correctly prints the `WARNING:` line.

## Prevention

- Never grep-match a CLI tool's error text based on memory, training data, or documentation
  from a possibly-older version — run the actual command against the actual installed
  version and capture the real string before writing the match pattern.
- When the match pattern gates a diagnostic/warning path (not a hard failure), the bug is
  doubly dangerous: it doesn't crash, it just silently misclassifies forever. Add a live
  test for BOTH branches of the classification (the expected case AND a real-failure case)
  before trusting the pattern, not just the happy path.
- Prefer matching on the command's **exit code plus a broad set of known phrasings**
  (`grep -qE "pattern1|pattern2"`) over a single exact string, since CLI tools evolve their
  wording across versions more often than their exit-code contracts.

## Related Files

- `.claude/skills/todo/SKILL.md` — Phase 0 local `todo/*` branch sweep, the `git branch -D`
  classification loop this was found in (PR #547 review-fix cycle)

## See Also

- [A `cmd | grep -q` shell condition under `set -o pipefail` fails open via SIGPIPE](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — a different bash "fails open silently" mechanism (SIGPIPE vs version-drifted string match), same family of risk: a conditional that looks correct until run against the real environment
- [A bash destructive-action safety check must not suppress its own stderr](../conventions/bash-destructive-gate-must-not-suppress-check-stderr-2026-07-07.md) — the companion lesson from the same review cycle, about the check itself rather than its error-message parsing
