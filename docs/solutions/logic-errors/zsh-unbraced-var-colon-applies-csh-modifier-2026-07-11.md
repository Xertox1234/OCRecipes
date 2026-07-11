---
title: "zsh applies csh-style modifiers to an unbraced $VAR before a colon — \":r\" is silently consumed from refspecs and host:path strings"
track: bug
category: logic-errors
tags: [zsh, shell, parameter-expansion, git, refspec, quoting, harness]
module: shared
symptoms: ["git push fails with \"src refspec <sha>efs/heads/... does not match any\" — the \":r\" between the variable and \"refs/heads\" vanished", "a double-quoted \"$VAR:rest\" string loses \":r\" / \":h\" / \":t\" / \":e\" at expansion time with no warning", "an scp/rsync/curl target built as \"$HOST:$PATH_PART\" silently resolves to a mangled string"]
created: 2026-07-11
severity: medium
---

# zsh applies csh-style modifiers to an unbraced $VAR before a colon — ":r" is silently consumed from refspecs and host:path strings

## Problem

`git push origin "$FULL_SHA:refs/heads/my-branch"` failed with:

```
error: src refspec 55ea2a7e…a1befs/heads/my-branch does not match any
```

The `:r` between the SHA and `efs/heads` disappeared. The same command with a
literal SHA worked. Nothing in git, the rtk wrapper, or the harness rewrote the
string — the shell did.

## Symptoms

- `git push` errors with a refspec that is your variable's value **fused
  directly onto text that should have followed a colon**, minus one or two
  characters (`:r` → gone, leaving `efs/heads/…`).
- Any double-quoted `"$VAR:something"` loses leading characters of
  `something` when they happen to spell a modifier (`r`, `h`, `t`, `e`, …).
- Commands that don't validate their strings (scp, rsync, URL builders)
  misbehave **silently** — the loud git error is the lucky case.

## Root Cause

zsh extends csh **history modifiers** to plain parameter expansions: in
`$VAR:r`, the `:r` is parsed as the "strip extension" modifier, applied to the
value, and consumed. Unlike bash — where `:` simply ends the variable name and
everything after is literal — zsh does this **even inside double quotes**.

Empirical proof (zsh):

```zsh
V=file.txt
echo "$V:r"          # → file            (:r stripped the extension)
S=$(git rev-parse HEAD)
echo "$S:refs/x"     # → <sha>efs/x      (:r consumed — SHA has no extension, so it's a no-op that still eats ':r')
echo "${S}:refs/x"   # → <sha>:refs/x    (braces end the expansion; colon is literal)
```

This bites in this project because the Claude Code Bash tool executes through
the user's shell — **zsh on macOS** — while the repo's own scripts declare
`#!/usr/bin/env bash` and are immune. A snippet that is correct inside a
committed script can be wrong when pasted into a harness/interactive command.

## Solution

Always brace a variable that is directly followed by a colon:

```zsh
git push origin "${FULL_SHA}:refs/heads/my-branch"   # correct everywhere
scp "backup.tar" "${HOST}:${DEST_DIR}/"              # correct everywhere
```

Braces (`${VAR}`) terminate the expansion, so the following `:` is literal in
both zsh and bash.

## Prevention

- In harness/interactive commands (zsh), treat `"$VAR:` as a defect on sight —
  write `"${VAR}:` unconditionally. It is never wrong in bash either, so
  bracing costs nothing.
- If a colon-joined string reaches a command mangled, test the expansion
  alone first (`echo "$VAR:rest"` vs `echo "${VAR}:rest"`) before suspecting
  the command, a wrapper, or the harness.

## Related Files

- `.claude/hooks/*.sh`, `scripts/**/*.sh` — bash (`#!/usr/bin/env bash`), NOT
  affected; the gotcha applies to commands run through the interactive shell
  (zsh) such as Claude Code Bash tool calls.

## See Also

- [command-substitution-unsets-errexit-swallowing-failures](command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md) — sibling shell-semantics trap: correct-looking syntax, silently different behavior.
- [../best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md](../best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md) — the SHA-to-refspec push where this was discovered.
