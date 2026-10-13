---
title: 'A cloud SessionStart hook must be quiet, re-runnable and fail-open, and must default its env instead of assuming the cloud environment sets it'
track: knowledge
category: conventions
module: shared
tags: [hooks, tooling, harness, cloud-session, database]
applies_to: [.claude/hooks/session-start.sh, .claude/settings.json]
created: '2026-10-13'
---

# A cloud SessionStart hook must be quiet, re-runnable and fail-open, and must default its env instead of assuming the cloud environment sets it

## Rule

A SessionStart hook that provisions a Claude Code cloud session (claude.ai/code, gated on `CLAUDE_CODE_REMOTE=true`) must:

1. **Send all command output to a log and print one summary line.** SessionStart stdout is injected into the session's context, so `npm install` noise there costs tokens every session.
2. **Be cheap to re-run.** SessionStart also fires on resume and after a compaction. Skip expensive steps when nothing changed: `npm ci` only when `package-lock.json` differs from a stamp written after the last install.
3. **Fail open.** A failed step prints one line naming the log and exits 0 (`docs/rules/harness.md`: hooks fail open).
4. **Close stdin for every step** (`</dev/null`), so a command that wants to prompt (`drizzle-kit push`) errors instead of hanging until the hook timeout.
5. **Default its own environment.** Export each needed variable only when unset, and persist it via `$CLAUDE_ENV_FILE`. Never assume the cloud environment config provides it.
6. **Mirror CI, not a hand-rolled setup.** CI's test job is the only setup proven to run the suite: same DB identity, extensions and commands.

## Why

The #205 version of `session-start.sh` broke rules 1, 3, 5 and 6 and went unnoticed for ~1,200 PRs, because nobody ran a cloud session. It relied on the cloud environment setting `DATABASE_URL` and would stop at `db:push` (`drizzle.config.ts` throws without it). It created a DB identity CI doesn't use, and dumped `npm install` output into context.

Platform facts behind the rules (code.claude.com/docs/en/cloud-environments, 2026-10-12):

- Only the setup script's **filesystem snapshot** persists between sessions. Running processes such as Postgres don't, so starting services belongs in the hook. `npm ci` belongs in the environment's setup script, so the hook's stamp check skips it.
- PostgreSQL 16 is preinstalled but not running.
- Env vars set in the environment dialog are readable by anyone using the environment. Real keys go in network secrets, so the hook's defaults must be CI's stubs, never real values.

## Examples

`.claude/hooks/session-start.sh` after #1431: `step <label> <cmd…>` wraps each command as `"$@" >>"$LOG" 2>&1 </dev/null || fail "$label"`, and `default_env NAME VALUE` exports and appends to `$CLAUDE_ENV_FILE` only when unset and not already written.

## Exceptions

- A hook that only reads state (no provisioning) can skip the stamp logic, but rules 1 and 3 still apply.
- Shimmed self-tests (`test-session-start.sh`) can't prove the cloud image's `service`/`su`/Postgres paths. Treat the first real cloud session as the acceptance test and read `$TMPDIR/ocrecipes-session-start.log`.

## Related Files

- `.claude/hooks/session-start.sh`
- `.claude/hooks/test-session-start.sh`
- `.github/workflows/ci.yml` (test job `env:` and DB steps: the values the hook mirrors)

## See Also

- [hook self-test tty check and inherited env](../logic-errors/hook-self-test-tty-check-and-inherited-env-pass-or-fail-for-the-wrong-reason-2026-10-13.md) — the two test defects found while building this hook's test
- [ad-hoc worktree missing node_modules symlink](adhoc-worktree-missing-node-modules-symlink-2026-07-06.md) — the local-worktree counterpart: a SessionStart hook that provisions dependencies
