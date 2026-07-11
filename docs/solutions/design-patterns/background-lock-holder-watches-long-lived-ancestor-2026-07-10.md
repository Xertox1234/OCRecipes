---
title: "A background lock/resource holder must watch a LONG-LIVED ancestor pid, never its spawning shell — hook and tool shells die the moment the call returns"
track: knowledge
category: design-patterns
tags: [bash, background-process, watch-pid, ppid, ps-walk, claude-hooks, lock-holder]
module: shared
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh"]
created: 2026-07-10
---

# A background lock/resource holder must watch a LONG-LIVED ancestor pid, never its spawning shell — hook and tool shells die the moment the call returns

## Rule

A backgrounded process whose job outlives its spawn point (a lock holder, a watcher, a
long poll) must tie its lifetime to a deliberately chosen long-lived ancestor — in this
environment, the `claude` session process — resolved by an explicit ps-walk, never to
`$PPID` or `$$` of the shell that spawned it.

## Why

Claude Code Bash-tool shells and hook shells are transient: they die when the tool call
or hook returns. A holder watching its spawner via `kill -0 $PPID` releases the lock
milliseconds after acquiring it (worthless); worse, after the spawner dies the holder
reparents and a naive "watch my parent" check pins to init/launchd — a lock held until
reboot. Session-lifetime is the correct fail-safe: the resource frees when the human's
session ends, not sooner, not never.

## Examples

Shared resolver (walk `ppid` upward until a `claude` process — match basename AND argv
shapes, including no-args `node /path/to/claude`):

```bash
resolve_claude_pid() {
  local pid="${1:-$$}" comm args
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null) || return 1
    case "${comm##*/}" in claude) printf '%s\n' "$pid"; return 0 ;; esac
    args=$(ps -o command= -p "$pid" 2>/dev/null) || return 1
    case " $args" in
      *" claude"|*"/claude") printf '%s\n' "$pid"; return 0 ;;
      *"/claude "*|*" claude "*) printf '%s\n' "$pid"; return 0 ;;
    esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]') || return 1
  done
  return 1
}
```

Contract rules that make it safe:

- **Orchestrated calls pass `--watch-pid` explicitly** (resolved once, stated in the
  dispatch prompt); auto-walk is the interactive fallback only.
- **Unresolvable watch target → refuse the resource** (WARN + distinct exit code),
  never "watch nothing" or guess an ancestor.
- The holder's watch loop `kill -0 <watch-pid>` on an interval; watch-pid death →
  kill own children (the psql/worker), release, exit.
- Kill-tests must kill the WATCHED pid (a throwaway `sleep`) and the holder's worker
  CHILD (`pgrep -P`), never the wrapper (orphans the worker) and never a server
  backend.

## Exceptions

Work that genuinely should die with the tool call (a snapshot refresh, a fire-and-forget
log write) needs no watcher at all — background it with detached stdio and let it finish.

## Related Files

- `scripts/pg-lab/lib/ps-walk.sh` — the shared resolver + pid→session_id bridge
- `scripts/pg-lab/db-serial-lock.sh` — `--watch-pid` contract, exit 3 refuse path

## See Also

- [../logic-errors/postgres-pg-sleep-backend-ignores-dead-client-2026-07-10.md](../logic-errors/postgres-pg-sleep-backend-ignores-dead-client-2026-07-10.md) — the server-side half of the same holder's liveness story
