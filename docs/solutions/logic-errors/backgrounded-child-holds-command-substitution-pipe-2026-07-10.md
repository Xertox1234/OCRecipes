---
title: "A backgrounded child inherits the $() capture pipe and the hook's stdout — `&` without redirection neither detaches nor silences it"
track: bug
category: logic-errors
tags: [bash, background, command-substitution, file-descriptor, stdout, hooks]
module: shared
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh"]
symptoms: [var=$(script) doesn't return until a 'fire-and-forget' background child inside the script finishes, Stray child output interleaves into a hook's JSON stdout or a captured variable, A hook that backgrounds its work still adds seconds of latency under a slow/unreachable dependency, "PreToolUse:Edit hook error: … hook output parsed as a document that grants, rewrites or injects, but its stdio went quiet before end-of-stream" — the edit is blocked once and the retry passes]
created: 2026-07-10
severity: medium
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

### The brace-group trap (2026-10-31, harness diagnosis item 3)

A redirect INSIDE a backgrounded group does not detach the group:

```bash
{ printf '%s' "$LOG_TSV" | bash "$LOG_SCRIPT" >/dev/null 2>&1; } &      # holds stdout
{ printf '%s' "$LOG_TSV" | bash "$LOG_SCRIPT"; } >/dev/null 2>&1 </dev/null &   # detached
```

The `{ …; } &` runs in a subshell that keeps its own copy of the hook's stdout until the
pipeline ends; the inner redirect covers only the inner command. `inject-patterns.sh` and
`session-recent-issues.sh` had the first form on their PG Lab telemetry write. Claude Code
reads a hook's stdout to EOF, and since ~2026-10-19 it refuses an injecting hook whose
stream stays open after the JSON ("stdio went quiet before end-of-stream") — 25 blocked
edits. Measured against an unreachable lab DB: hook exit 0.31 s, stdout EOF 6.45 s; with
the redirect on the group, EOF 0.19 s and telemetry rows still land. Timed to EOF with
`sleep 3` in the background: `printf x | sleep 3 >/dev/null 2>&1 &` 0.01 s, `sleep 3
>/dev/null 2>&1 &` 0.02 s, `{ printf x | sleep 3 >/dev/null 2>&1; } &` **3.01 s**,
`{ printf x | sleep 3; } >/dev/null 2>&1 </dev/null &` 0.01 s.

## Prevention

Grep review rule for hook/CLI scripts whose stdout is consumed: every `… &` line must
carry `>/dev/null 2>&1` (or an explicit log target) **on the backgrounded unit itself** —
for a `{ …; } &` group that means after the closing brace, never only inside it (the
brace-group trap above passed the old wording of this rule). The repo's
consult/attribute-drift paths were fixed at all four call sites in one pass.

Test it by timing `$(hook)` with a slow stand-in for the background work: command
substitution waits for EOF, not the hook's exit, so it measures what Claude Code sees.
`test-inject-patterns.sh` and `test-session-recent-issues.sh` do this in their "slow lab
DB" checks (a fake `psql` on PATH that leaves a marker and sleeps 5 s; the marker proves
the stand-in ran).

## Related Files

- `scripts/pg-lab/session-coord.sh` — `do_consult`, `do_attribute_drift` log_event call sites
- `.claude/hooks/inject-patterns.sh` (telemetry tail), `.claude/hooks/session-recent-issues.sh` (telemetry call) — the brace-group trap

## See Also

- [pipefail-echo-grep-condition-fails-open-via-sigpipe](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — sibling pipe-semantics gotcha
- [../conventions/subagent-verification-must-run-synchronously-2026-07-06.md](../conventions/subagent-verification-must-run-synchronously-2026-07-06.md) — backgrounding's other hidden contract
