---
title: 'GNU stat -f %m prints a literal "?" and exits 0 — the portable-mtime fallback must be `stat -c %Y || stat -f %m`, GNU first'
track: bug
category: logic-errors
tags: [bash, stat, gnu, bsd, macos, linux, portability, mtime]
module: shared
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh"]
symptoms: [mtime-based logic (staleness checks, cache expiry, lock recovery) works on macOS but silently never fires on Linux, Arithmetic errors or empty values downstream of a stat call, only on Linux/CI, A `stat -f %m file` probe on Linux outputs '?' with exit code 0]
created: 2026-07-10
severity: medium
---

# GNU stat -f %m prints a literal "?" and exits 0 — the portable-mtime fallback must be `stat -c %Y || stat -f %m`, GNU first

## Problem

The "portable" mtime read `stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null`
is darwin-only in practice. On GNU coreutils, `-f` switches stat to *filesystem* mode,
`%m` is not a recognized filesystem directive, and the source's `default:` case prints a
literal `?` **and exits 0** — so the `||` never falls through to the working `-c` branch.
Downstream arithmetic (`$(( now - mt ))`) gets `?`, the age computes empty under
`2>/dev/null` guards, and every mtime-gated behavior (stale-while-revalidate refresh,
orphaned-lock recovery) silently disables on Linux while all tests pass on macOS.

## Symptoms

- Feature works on the mac dev box; on Linux (CI, Claude Web cloud sessions) it
  degrades silently — no error, the gated action just never triggers.

## Root Cause

BSD and GNU `stat` share a flag letter with opposite meanings: BSD `-f` = format
string, GNU `-f` = filesystem mode. The failure is *silent* on GNU (exit 0 with `?`
output), so error-based fallbacks (`||`) select the wrong branch permanently.

## Solution

Order the fallback GNU-first — GNU `-c` succeeds deterministically; BSD `stat` errors
on `-c` (illegal option, nonzero) and falls through:

```bash
mt=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null) || { echo 999999; return; }
```

Both platforms now take a deterministic branch; a missing file fails both and hits the
guard.

## Prevention

When a cross-platform fallback chain relies on "the wrong variant errors out," verify
the *exit code* of the wrong variant on both platforms — printing garbage with exit 0
is exactly the case `||` cannot catch. (Same family as probes that signal absence by
empty output but exit 0.)

## Related Files

- `scripts/pg-lab/session-coord.sh` — `snapshot_age_secs`, refresh-lock staleness check

## See Also

- [empty-probe-output-needs-exit-code-check](empty-probe-output-needs-exit-code-check-2026-07-02.md) — the general exit-code-vs-output trap
