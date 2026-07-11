---
title: "A backgrounded child inherits the $() capture pipe and the hook's stdout — `&` without redirection neither detaches nor silences it"
track: bug
category: logic-errors
tags: [bash, background, command-substitution, file-descriptor, stdout, hooks]
module: shared
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh"]
symptoms: [var=$(script) doesn't return until a 'fire-and-forget' background child inside the script finishes, Stray child output interleaves into a hook's JSON stdout or a captured variable, A hook that backgrounds its work still adds seconds of latency under a slow/unreachable dependency]
created: 2026-07-10
severity: low
---

# A backgrounded child inherits the $() capture pipe and the hook's stdout — `&` without redirection neither detaches nor silences it

## Problem

Hook scripts backgrounded best-effort ledger writes as `log_event … &` on paths whose
stdout is a contract: one path's stdout IS the PreToolUse hook's JSON
(`additionalContext`); another is captured by a caller's `ATTRIB=$(bash script …)`.
`&` alone leaves the child holding the inherited stdout fd, so (a) any stray byte the
child ever prints interleaves into the JSON/captured text, and (b) `$(…)` blocks until
EVERY holder of the pipe's write end exits — the "fire-and-forget" insert added its full
duration (bounded only by `PGCONNECT_TIMEOUT`) to the capture.

## Symptoms

- See frontmatter. The latency half is invisible until the dependency is slow — a
  local-Postgres-down test exposed it.

## Root Cause

`&` affects scheduling, not file descriptors. Command substitution reads until EOF on
the pipe, which arrives only when all processes holding the write end close it —
backgrounded children included.

## Solution

Detach the fds on the same command that backgrounds:

```bash
log_event "warn-collision" "$sid" "$osid" "$detail" >/dev/null 2>&1 &
```

Do this at the CALL SITE even when the callee currently redirects internally — the call
boundary is the contract; internal redirects are an implementation detail a future edit
can lose.

## Prevention

Grep review rule for hook/CLI scripts whose stdout is consumed: every `… &` line must
carry `>/dev/null 2>&1` (or an explicit log target). The repo's consult/attribute-drift
paths were fixed at all four call sites in one pass.

## Related Files

- `scripts/pg-lab/session-coord.sh` — `do_consult`, `do_attribute_drift` log_event call sites

## See Also

- [pipefail-echo-grep-condition-fails-open-via-sigpipe](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — sibling pipe-semantics gotcha
- [../conventions/subagent-verification-must-run-synchronously-2026-07-06.md](../conventions/subagent-verification-must-run-synchronously-2026-07-06.md) — backgrounding's other hidden contract
