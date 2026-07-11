---
title: "A bash EXIT trap referencing a `local` variable fires after the function returns — under set -u the trap aborts and the cleanup silently never runs"
track: bug
category: logic-errors
tags: [bash, trap, exit, local, set-u, cleanup, lockdir]
module: shared
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh"]
symptoms: [A lock directory / temp file cleaned by an EXIT trap leaks on the SUCCESS path but is cleaned on error paths, The guarded operation works exactly once, then every later run silently no-ops (guard sees the leaked lock), Stray 'unbound variable' from a trap at script exit (visible only without 2>/dev/null)]
created: 2026-07-10
severity: medium
---

# A bash EXIT trap referencing a `local` variable fires after the function returns — under set -u the trap aborts and the cleanup silently never runs

## Problem

A function declared `local lockdir`, created the lock with `mkdir "$lockdir"`, and
registered `trap 'rmdir "$lockdir" 2>/dev/null' EXIT`. On error paths the function
called `exit` directly — trap fired while `lockdir` was bound, cleanup worked. On the
SUCCESS path the function returned normally and the script's terminal `exit 0` fired
the trap — after the `local` binding was gone. With `set -u`, the single-quoted
(lazily-expanded) trap string hit "unbound variable" and aborted before `rmdir`
executed. Net effect: the lock leaked on every *success*, so the operation ran once per
session and then never again — masked in tests because the leaked lock coincidentally
satisfied a "guard blocks second run" assertion.

## Symptoms

- Asymmetric cleanup: error paths clean, success path leaks.
- `mkdir: File exists` noise from an unrelated later `mkdir` of the same path.

## Root Cause

`trap '…' EXIT` with single quotes defers expansion to fire time. Bash fires the EXIT
trap at *script* exit, not function return, and `local` bindings die with the function.
`set -u` turns the now-unset reference into an abort inside the trap itself.

## Solution

Don't let a lazily-expanded trap depend on function-scoped state. Simplest fix:
script-scope the variable (drop it from the `local` list, keep the assignment) with a
comment stating why:

```bash
lockdir="/tmp/…refresh-lock"   # script-scope, not local: the EXIT trap fires after this function returns
trap 'rmdir "$lockdir" 2>/dev/null' EXIT
```

Alternative: expand eagerly at registration (`trap "rmdir '$lockdir' 2>/dev/null" EXIT`)
— but then the path must be quote-safe.

## Prevention

Test the cleanup on the SUCCESS path explicitly: assert the lock/temp artifact is
ABSENT immediately after a successful run (the assertion that caught this failed RED
against the leak). A guard test that only checks "held lock blocks a second run" can be
satisfied by the bug itself.

## Related Files

- `scripts/pg-lab/session-coord.sh` — `do_refresh_snapshot`'s mkdir guard

## See Also

- [command-substitution-unsets-errexit-swallowing-failures](command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md) — sibling bash scope/mode gotcha
- [../conventions/mkdir-is-the-portable-atomic-lock-no-flock-on-macos.md](../conventions/mkdir-is-the-portable-atomic-lock-no-flock-on-macos-2026-07-10.md) — the lock this trap was cleaning
