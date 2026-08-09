---
title: "Piping a hook-proxied command filters the PROXY's rewritten output, not the command's — verify state against a structured API"
track: knowledge
category: conventions
tags: [rtk, tooling, verification, pipe, grep, git, gh, ci, harness, false-negative]
module: agents
applies_to: [".claude/agents/**/*.md", ".claude/skills/**/*.md"]
created: 2026-08-08
---

# Piping a hook-proxied command filters the PROXY's rewritten output, not the command's

## Rule

In this repo a PreToolUse hook transparently rewrites `git`/`gh` invocations to run through
`rtk`, a token-optimizing proxy that **truncates and summarizes** output. Whatever you pipe
into (`| grep`, `| wc -l`, `| head`) receives the proxy's rewritten text — not the command's
real output. A filter over a proxied command therefore reports on a transformed stream and can
return a confident **false negative** on content that genuinely exists.

Never establish a fact by piping a proxied command through a filter. To verify state, use
either:

1. a **structured API** scoped to the exact object (`mcp__github__pull_request_read` with
   `get_check_runs` for CI, the GitHub MCP tools for PR/commit state), or
2. `rtk proxy <cmd>` — documented to execute the raw command with no filtering — when you
   genuinely need the unmodified stream to pipe.

## Smell patterns

- A `grep` over `git log`/`git branch`/`gh` output returns nothing for a string you can plainly
  see when you print the same command's output directly.
- A count (`| wc -l`, `grep -c`) over proxied output disagrees with what a scoped query reports.
- A `--watch`-style polling command's summary counts far exceed the number of objects that
  exist (a PR with 10 checks reporting >100).
- The verification is unbounded (`git log` with no `-n`) — large output is exactly what the
  proxy compresses, so big listings are the most dangerous to pipe.

## Why

Isolated directly (2026-08-08), same command, same repo, same instant:

```bash
git log --oneline main | grep -c '(#787)'              # -> 0   (through the hooked path)
rtk proxy git log --oneline main | grep -c '(#787)'    # -> 1   (raw, unfiltered)
```

The commit `b23e63d2 docs(todos): ... (#787)` existed on `main` in both cases. The unbounded
`git log --oneline main` produces a long listing, which the proxy compresses before it reaches
the pipe — so `grep` searched a truncated remnant and correctly reported "not found" about
text that was simply not in what it was given.

Crucially, the same command with a small bound printed fine:

```bash
git log --oneline -3 main    # displays "b23e63d2 ... (#787)" intact
```

Output small enough to survive the proxy passes through unchanged, which is what makes this
trap so easy to miss: the interactive spot-check succeeds while the piped verification fails.

A second symptom the same session, attributed to this cause but **not** separately isolated:
`gh pr checks <n> --watch` returned a "CI Checks Summary: Passed: 101, Pending: 35" for a PR
whose head had exactly **10** check runs, all successful. The shape (a summary block that is
not `gh`'s native TSV table, with counts ≈ 10 checks × the number of polls) is consistent with
the proxy summarizing a polling stream cumulatively. The head-scoped API gave the correct
answer immediately:

```jsonc
// mcp__github__pull_request_read { method: "get_check_runs", pullNumber: 787 }
{ "total_count": 10, /* all "conclusion": "success" */ }
```

This compounds with a second, independent hazard: `$?` after a pipe is the **last** stage's
status, so `cmd | tail; echo $?` reports `tail`'s success regardless of `cmd`. A failed `grep`
inside a `&&` chain is likewise masked by a following `head`, which succeeds on empty input.
Together these can make an empty, wrong result look like a clean pass.

## Examples

```bash
# WRONG — greps the proxy's compressed output; silently finds nothing
git log --oneline main | grep '(#787)'

# WRONG — $? is grep's or head's, not git's; empty input still "succeeds"
git log --oneline main | grep '(#787)' | head -2
echo "exit: $?"

# RIGHT — bound the output so the spot-check is the whole answer
git log --oneline -3 main

# RIGHT — raw stream when a pipe is genuinely needed
rtk proxy git log --oneline main | grep '(#787)'

# BEST for state verification — ask a structured API about the exact object
# mcp__github__pull_request_read { method: "get_check_runs", pullNumber: 787 }
```

## Exceptions

Piping proxied output is fine when the pipe is **cosmetic** — shortening something you will
read yourself, where a truncated view costs nothing. The rule binds when the pipe's result
becomes *evidence*: a merge gate, a "the change landed" claim, a CI verdict, a count you will
report. Evidence must come from a bounded direct read, `rtk proxy`, or a structured API.

## Related Files

- `~/.claude/RTK.md` — proxy behavior and the `rtk proxy <cmd>` raw-execution escape hatch
- `.claude/skills/land/SKILL.md` — the merge ritual whose CI-truth step this protects

## See Also

- [A backgrounded command's reported exit code is unreliable when the command includes a pipe](backgrounded-piped-command-exit-code-unreliable-2026-07-15.md) — the exit-code half of this hazard; POSIX pipeline semantics rather than proxy rewriting
- [A CI job that dies in "Set up job" failed before your code was checked out — never yours](ci-set-up-job-failure-is-never-your-code-2026-08-06.md) — another CI signal that is routinely misread
- [Probes that signal absence by empty output must also check the exit code](../logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md) — empty output is ambiguous between "no match" and "never ran"
- [A verification that scans ZERO inputs is green and meaningless — assert the count, not just the exit code](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same false-green shape from a different cause
- [Reading CI status during an infrastructure incident](../best-practices/reading-ci-status-during-an-infrastructure-incident-2026-08-06.md) — when the CI signal itself is untrustworthy
