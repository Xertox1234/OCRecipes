---
title: Probes that signal absence by empty output must also check the exit code
track: bug
category: logic-errors
module: shared
severity: medium
tags: [git, ls-remote, shell, probes, fail-open, exit-codes, gh, renames]
symptoms: [A collision/existence pre-check "passes" during a network or auth outage and duplicate work is only caught later (or never), An instruction reads "no output → does not exist" and a transport failure takes the same branch as genuine absence, git ls-remote prints nothing on rc=0 (absent) AND rc=128 (failure) — only stdout was inspected]
applies_to: [.claude/agents/**/*.md, scripts/*.sh, .husky/**]
created: '2026-07-02'
---

# Probes that signal absence by empty output must also check the exit code

## Problem

An executor instruction read `git ls-remote --heads origin <branch>` as "no output →
branch doesn't exist → proceed." But `ls-remote` prints nothing **both** when the branch
is genuinely absent (exit 0) and when the transport/auth fails (exit 128) — so a network
outage reads as a green light and the collision pre-check silently fails open.

## Symptoms

- The pre-work probe "confirms" a branch is absent during a gh/network outage; the
  duplicate implementation is only caught at push time by the backstop triage.
- A literal reader of the instruction treats rc=128 identically to rc=0 because the
  decision rule only mentions stdout.

## Root Cause

Absence and failure share the same stdout channel (empty); only the exit code separates
them. A prose decision rule that describes just the happy-path output gets literally
obeyed — the same "literally obeyed prose" failure family as reason-prefix routing.

## Solution

State both channels in the decision rule: "No output AND exit code 0 → absent →
proceed. Non-zero exit → the probe is INCONCLUSIVE — do not assert absence; proceed
with a note and rely on the authoritative downstream check as the backstop."
(`.claude/agents/todo-executor.md` Step 2 remote-branch probe.)

## Prevention

- Any probe whose negative result is "no output" needs an explicit exit-code clause.
  Fail toward "inconclusive", never toward "safe to proceed".
- Sibling under-specified-output gotcha from the same review: `gh pr diff --name-only`
  lists a **renamed** file only by its new path, and a rename's content is absent from
  the patch (only a similarity index appears). Todo archive files are renames — so
  per-file contents fetches against the PR head are *correct*, and "optimizing" them
  into patch parsing is a regression. Check what the output format omits before trusting
  it as complete.

## Related Files

- `.claude/agents/todo-executor.md` — Step 2 remote-branch probe (output + exit-code rule)
- `scripts/todo-automerge-guard.sh` — per-file contents fetch kept because archives are renames

## See Also

- [machine-routed values need an enum](../conventions/machine-routed-values-need-enum-not-prose-2026-07-02.md) — the broader "prose literally obeyed" failure family
- [pipefail grep condition fails open via SIGPIPE](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — another silent shell fail-open in the same toolchain
