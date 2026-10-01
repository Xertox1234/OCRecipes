---
title: 'Sourcing a lib into a fail-closed guard with `{ . lib; }` fails OPEN when the lib is present but broken — probe it in a `$( … )` subshell first'
track: bug
category: runtime-errors
module: shared
severity: high
tags: [harness, hooks, bash, fail-open, security, sourcing]
symptoms: ['A PreToolUse guard that fails closed when its shared lib is MISSING silently allows everything when the lib is PRESENT but broken', 'The hook emits no decision at all (rc 0 with `exit 0` in the lib body, rc 1 with an unset variable under `set -u`), so the call is allowed', 'A `declare -F <fn> || deny` fail-closed check placed after the source line never runs']
applies_to: [.claude/hooks/*.sh, .claude/hooks/lib/*.sh]
created: '2026-09-28'
---

# Sourcing a lib into a fail-closed guard with `{ . lib; }` fails OPEN when the lib is present but broken

## Problem

`git-safety.sh` moved its write-target parser into `lib/write-targets.sh` (#1136) and loaded it
like this:

```bash
{ . "$_WT_HERE/lib/write-targets.sh"; } >/dev/null 2>&1
…
declare -F emit_write_targets >/dev/null || deny "…did not load… failing closed…"
```

The fail-closed check handled a **missing** lib correctly. A lib that is **present but broken**
never reached the check.

## Symptoms

Measured on #1136's PR-level review with bash 5.3.15. The setup used a real linked worktree
registered in the contract and the payload `rm $FX/main/x.ts`:

```
intact     rc=0 decision=deny  (contract violation)
absent     rc=0 decision=deny  (lib did not load — fail closed)
stub_exit  rc=0 decision=      (lib body: exit 0)
stub_unset rc=1 decision=      (lib body: BAD="${DEFINITELY_NOT_SET}")
```

Both stubs turn a DENY into an ALLOW, for a write into the main checkout.

## Root Cause

A brace group `{ …; }` is **not** a subshell. It runs in the hook's own shell, so:

- `exit` in the sourced file exits the **hook**;
- an unset-variable expansion under the hook's `set -u` aborts the **hook**;
- `>/dev/null 2>&1` on the group hides the output, but it cannot stop termination.

A hook that dies without printing a decision is an ALLOW. Every check below the source line is
skipped, including the one written to catch a failed load. The sibling `lib/cmd-detect.sh` source
in the same file already ran inside `$( … )` for exactly this reason, and
`test-git-safety.sh`'s broken-lib rows record `exit 0` and unset-var stubs as measured silent
ALLOWs. The move did not carry that idiom over.

## Solution

Probe the lib in a subshell that prints a sentinel only if the function came out defined, and
source it into the hook's shell only when the probe passed (#1137):

```bash
_WT_OK=$( { . "$_WT_HERE/lib/write-targets.sh"; } >/dev/null 2>&1; declare -F emit_write_targets >/dev/null && echo ok )
[ "$_WT_OK" = ok ] && { . "$_WT_HERE/lib/write-targets.sh"; } >/dev/null 2>&1
```

The subshell inherits `set -uo pipefail`, so it hits the same failures the real load would. The
hook survives them, and the later `declare -F … || deny` then fails closed in all three cases:
missing, `exit 0`, and unset var. Sourcing twice is safe only because the lib has **no top-level
side effects** (function definitions only). Keep it that way, or the probe runs them twice.

## Prevention

- Any `.`/`source` of a lib into a **deny-capable** hook must be preceded by a subshell probe, or
  run entirely inside `$( … )`. "The file exists" is not "the file loaded".
- Test all three load states: absent, `exit 0` stub, unset-var stub. Show RED against the
  pre-fix hook: the stubs must give no decision before the fix. That is the control proving the
  rows reach the regime.
- Mutation-check the probe. Mutating only the probe's own `declare -F` is an **equivalent**
  mutant, because the later check still catches an undefined function. Force `_WT_OK=ok`
  instead, which really does re-introduce direct sourcing.

## Related Files

- `.claude/hooks/git-safety.sh` (the probe-then-source lines above `git_c_target`)
- `.claude/hooks/lib/write-targets.sh`
- `.claude/hooks/test-write-targets.sh` (the `stubexit` / `stubunset` rows and the `_WT_OK=ok` mutant)

## See Also

- [a stated invariant is not an enforced one](../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md): instance 6, a *missing* lib falling through to `exit 0`
- [degraded fallback path needs the same hardening](../conventions/degraded-fallback-path-needs-same-hardening-as-primary-path-2026-08-17.md)
- [naive fork-free HERE fails open on bare invocation](../logic-errors/naive-fork-free-here-silently-fails-open-on-bare-invocation-2026-09-02.md): another way a lib source silently fails in a guard
