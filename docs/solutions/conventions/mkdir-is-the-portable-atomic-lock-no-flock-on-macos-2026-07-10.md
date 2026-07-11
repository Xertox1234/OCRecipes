---
title: "flock(1) does not exist on stock macOS — use atomic `mkdir` as the portable shell mutual-exclusion guard"
track: knowledge
category: conventions
tags: [bash, flock, mkdir, macos, portability, lock, mutual-exclusion]
module: shared
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh"]
created: 2026-07-10
---

# flock(1) does not exist on stock macOS — use atomic `mkdir` as the portable shell mutual-exclusion guard

## Rule

Shell scripts in this repo that need an in-flight/mutual-exclusion guard use atomic
`mkdir` on a lock *directory*, never `flock(1)`. macOS ships the flock(2) syscall but
not the flock(1) utility; a `flock -n` guard works on Linux/CI and fails
`command not found` on every dev mac.

## Why

`mkdir` is atomic on every POSIX filesystem: exactly one caller succeeds, all others
fail with EEXIST — a test-and-set with no external dependency.

```bash
lockdir="/tmp/claude-…-refresh-lock"
mkdir "$lockdir" 2>/dev/null || exit 0        # loser exits silently — one refresh per burst
trap 'rmdir "$lockdir" 2>/dev/null' EXIT       # see the EXIT-trap/local gotcha before copying this line
```

Two required companions, both learned the hard way:

1. **Trap-scope**: the cleanup variable must NOT be `local` (see See Also — the EXIT
   trap fires after the function returns and leaks the lock on success under `set -u`).
2. **Staleness recovery**: a SIGKILL between `mkdir` and trap-fire strands the lock
   forever — mkdir has no owner-death release (unlike flock's fd semantics). Break
   stale locks by mtime with one atomic retry:

```bash
if ! mkdir "$lockdir" 2>/dev/null; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$lockdir" 2>/dev/null || stat -f %m "$lockdir" 2>/dev/null || echo 0) ))
  [ "$lock_age" -gt 60 ] 2>/dev/null && rmdir "$lockdir" 2>/dev/null && mkdir "$lockdir" 2>/dev/null || exit 0
fi
```

(If the retry `mkdir` loses, another process won the re-race — exit silently; two
concurrent breakers at worst duplicate idempotent work, never deadlock.)

## Exceptions

If the guarded work is long-lived and owner-death release is the primary requirement,
a lock *file descriptor* pattern (or a Postgres advisory lock) fits better than
mkdir+mtime — mkdir suits short bursts (a snapshot refresh, a one-shot init).

## Related Files

- `scripts/pg-lab/session-coord.sh` — `do_refresh_snapshot`

## See Also

- [../logic-errors/exit-trap-referencing-local-fires-after-function-return-2026-07-10.md](../logic-errors/exit-trap-referencing-local-fires-after-function-return-2026-07-10.md) — the trap-scope leak
- [../logic-errors/gnu-stat-f-m-prints-question-mark-exit-0-2026-07-10.md](../logic-errors/gnu-stat-f-m-prints-question-mark-exit-0-2026-07-10.md) — the stat order inside the staleness check
