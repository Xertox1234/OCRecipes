---
title: 'A bash destructive-action safety check must not suppress its own stderr'
track: knowledge
category: conventions
module: server
tags: [bash, safety-check, fail-open, destructive-action, stderr, git, cleanup-script]
applies_to: ['.claude/skills/*.md', '.claude/agents/*.md', 'scripts/*.sh']
created: '2026-07-07'
last_updated: '2026-07-07'
---

# A bash destructive-action safety check must not suppress its own stderr

## Rule

When a bash conditional decides whether it is safe to run a destructive command (delete a
branch, remove a file, drop data), never redirect the check's own stderr to `/dev/null`
before testing its output for emptiness. A suppressed-and-empty result is indistinguishable
from a genuinely-empty-and-safe result — the check fails **open** (proceeds to destroy)
exactly when it is least able to verify that doing so is safe.

```bash
# WRONG — fails open: if `main` is unresolvable (detached HEAD, renamed default branch,
# a base other than main), git rev-list errors, stderr is thrown away, stdout is empty,
# and the guard reads that as "zero commits, safe to delete" — the opposite of the truth.
if [ -z "$(git rev-list main.."$b" 2>/dev/null)" ]; then
  git branch -D "$b"
fi
```

## Why

This surfaced while drafting a safety check meant to protect committed-but-unpushed work
from being auto-deleted by a cleanup sweep (only delete a branch if it has zero commits
beyond `main`; otherwise report it for human review instead of destroying it). The check
looked correct — `git rev-list main.."$b"` genuinely returns nothing when there are no
unique commits. But `2>/dev/null` also makes it return nothing when the command **fails**
(e.g. `main` doesn't exist in this context, the branch ref is corrupted, git can't resolve
the range) — and `[ -z "" ]` cannot tell "confirmed empty" apart from "never ran". The
safety gate's failure mode is the worst possible one: it deletes precisely when it cannot
verify deletion is safe, silently, with no error surfaced anywhere.

The broader lesson: a safety check that can be gamed into "safe" by simply failing is not a
safety check — it's a coin flip that looks deterministic in the tested case. This class of
bug is easy to miss under review pressure because the check reads as correct at a glance
("no commits beyond main → safe to delete") and the failure mode only appears for inputs
the author didn't think to test (an unresolvable ref, not just a resolvable-but-empty one).

## Examples

Fail-**closed** instead — treat "the check itself failed" as "not safe," distinct from
"the check ran and confirmed safe":

```bash
if out=$(git rev-list main.."$b" 2>&1); then
  if [ -z "$out" ]; then
    git branch -D "$b"   # check RAN and confirmed zero unique commits
  else
    echo "has commits — needs human review"
  fi
else
  echo "WARNING: could not verify commit state for $b: $out"   # check FAILED — never assume safe
fi
```

In the actual PR this pattern was found in, the simpler resolution was to **not build the
automated destructive path at all**: the feature this guard would have protected (an
orphan-branch auto-prune) was cut entirely rather than hardened, because its only real
targets — after routine/no-op cases self-resolve — were disproportionately the dangerous
ones (crashed executors with real, unrecovered commits). When an automated cleanup
mechanism's surviving edge cases are concentrated exactly where destruction is costliest,
that's a signal to remove the automation, not to add a safety check on top of it.

## Exceptions

- Suppressing stderr is fine for a check whose failure mode is unambiguous from stdout
  alone (e.g. checking whether a file exists with `[ -f "$path" ]` — there's no "the check
  itself errored" state to conflate with "false").
- Suppressing stderr on the **destructive command itself** (not the safety check that gates
  it) is a separate, narrower concern — see
  [grep-matched git error text breaks across git versions](../logic-errors/grep-matched-git-error-text-breaks-across-git-versions-2026-07-07.md)
  for that companion issue (classifying an expected-vs-real failure by grepping the
  destructive command's own error output).

## Related Files

- `.claude/skills/todo/SKILL.md` — the orphan-branch auto-prune this pattern was drafted
  for and then removed from entirely (PR #547 review-fix cycle)

## See Also

- [Grep-matched git CLI error text for expected-vs-real-failure classification breaks across git versions](../logic-errors/grep-matched-git-error-text-breaks-across-git-versions-2026-07-07.md) — the companion bug from the same review cycle, about parsing the destructive command's own error text rather than the precondition check
- [A `cmd | grep -q` shell condition under `set -o pipefail` fails open via SIGPIPE](../logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — a different bash "fails open silently" mechanism (SIGPIPE) worth cross-referencing when auditing conditionals for fail-open risk
