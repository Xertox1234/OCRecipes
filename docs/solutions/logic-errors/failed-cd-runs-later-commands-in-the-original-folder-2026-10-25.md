---
title: "A failed leading cd lets any command after ;, ||, a lone &, or a newline run in the ORIGINAL folder — a guard may judge against the cd folder only for a pure && chain or a folder it has checked it can enter"
track: bug
category: logic-errors
tags: [harness, security, worktree, shell-semantics, false-negative]
module: shared
applies_to: [".claude/hooks/git-safety.sh", ".claude/hooks/lib/write-targets.sh"]
symptoms: ["`cd <missing> && : || git commit` passes the worktree guard but commits in the main checkout", "A guard that honors `cd X &&` judges a later command against X although the shell never got there"]
created: 2026-10-25
severity: high
---

# A failed leading cd lets later commands run in the original folder

## Problem

#1552 taught the worktree-contract guard to honor one leading `cd <abs> &&`: the rest of the command
is judged against that folder. The security review measured two DENY→ALLOW regressions; the cd one was:

```bash
cd /no/such/folder && : || git commit -m x
```

The `cd` fails, `&& :` is skipped, `||` sees a failure and runs `git commit` in the **original**
folder, which here was the main checkout. The guard had judged it against `/no/such/folder`.

## Root Cause

`&&` only protects the command right after it. Any `;`, `||`, lone `&` or newline later in the line
starts a command that runs whatever the `cd` did. A `|` does not: in a pure `&&`/`|` chain, a failed
`cd` stops everything after it (checked in a real shell: `&& : | cmd` does not run `cmd`).

#1554 found the next case: a folder that **exists** but cannot be entered (`chmod 000`) also makes `cd`
fail. So "exists" was not enough.

## Solution

`git-safety.sh` honors a leading cd only when one of these holds:

- what follows is a pure `&&` chain (`_rest_sep = 0`), so a failed cd stops everything, or
- the folder exists **and** can be entered (`[ -d "$_lc" ] && [ -x "$_lc" ]`), so the cd succeeds.

Otherwise it judges the command against the session's real folder, as before #1552.

## Prevention

- Before a guard trusts that an earlier command changed state (folder, env, umask), ask what runs when
  that command **fails**. List every separator and check which ones stop on failure.
- Test both directions: a deny row for each separator after a missing folder and after an unenterable
  one, plus an enterable control that is allowed (`test-git-safety.sh`, the `$RWT2/locked` rows).
- Check the claim in a real shell before it goes in. See
  [grade against real bash](../conventions/grade-shell-reinterpreting-guard-pass-against-real-bash-2026-10-25.md).

## Related Files

- `.claude/hooks/git-safety.sh` — `LEAD_CD`/`EFF_CWD` handling
- `.claude/hooks/test-git-safety.sh` — the separator and unenterable-folder rows

## See Also

- [orchestrator phase variables don't persist](../conventions/orchestrator-phase-variables-dont-persist-across-bash-calls-2026-07-15.md) — a related "the shell state you assumed isn't there" trap
