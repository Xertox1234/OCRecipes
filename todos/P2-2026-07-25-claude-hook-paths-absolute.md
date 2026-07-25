---
title: "Make .claude hook registrations cwd-independent ($CLAUDE_PROJECT_DIR)"
status: backlog
priority: medium
created: 2026-07-25
updated: 2026-07-25
assignee:
labels: [harness, git-safety, tooling]
github_issue:
---

# Make .claude hook registrations cwd-independent ($CLAUDE_PROJECT_DIR)

## Summary

Every hook in `.claude/settings.json` is registered with a **relative** path
(`bash .claude/hooks/<name>.sh`), so it only resolves when the shell's working
directory is the repo root. Any `cd` into a subdirectory makes all ~13 hooks
fail with `No such file or directory` — silently disarming the git guardrails.

## Background

Observed live on 2026-07-25. While reading `node_modules/react-native-vision-camera`
source, an agent ran `cd node_modules/react-native-vision-camera && grep …`. The
Bash tool's working directory **persists across calls**, so for roughly six
subsequent calls every PreToolUse and PostToolUse hook failed:

```
PreToolUse:Bash hook error
Failed with non-blocking status code: bash: .claude/hooks/drift-detect.sh: No such file or directory
```

The error noise is the cosmetic half. The real problem is the other half: these
are `non-blocking` failures, so `git-safety.sh` and `guard-worktree-isolation.sh`
**did not run** for those calls. A `cd` into any subdirectory therefore disarms
the entire guardrail chain built across PRs #663–#678 — the contract-keyed
deny, the write-shaped tokenizer, the `-C`/`--git-dir`/`--work-tree` extractors.
None of it fires if bash can't find the script.

Nothing was damaged in the observed incident (the commands were read-only
greps), which is exactly why this is worth fixing before it happens during a
session that _is_ mutating.

## Acceptance Criteria

- [ ] Every `command` entry in `.claude/settings.json` uses an absolute path via
      `$CLAUDE_PROJECT_DIR` (e.g. `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/git-safety.sh"`)
- [ ] Verified by running a Bash tool call from a subdirectory (e.g.
      `cd node_modules && git status`) and confirming **zero** hook errors
- [ ] `git-safety.sh` confirmed to still DENY a contract-violating command when
      invoked from a subdirectory — i.e. the guard actually fires, not merely
      that the script is found
- [ ] Same treatment applied to `.claude/settings.local.json` if it registers hooks
- [ ] Hooks that internally resolve their own paths relative to cwd (rather than
      to `$0`) are identified and fixed too — finding the script is necessary but
      not sufficient

## Implementation Notes

- `$CLAUDE_PROJECT_DIR` is set by the harness to the project root; it is the
  documented way to make hook commands location-independent.
- Affected files (all currently relative in `.claude/settings.json`):
  `session-start.sh`, `worktree-deps.sh`, `session-recent-issues.sh`,
  `session-coord-hook.sh`, `inject-patterns.sh`, `branch-preflight.sh`,
  `core-bare-guard.sh`, `drift-detect.sh`, `drift-detect-update.sh`,
  `pr-preflight-guard.sh`, `git-safety.sh`, `guard-worktree-isolation.sh`,
  `commit-verify.sh`, `pr-verify.sh`, `eslint-fix.sh`.
- Check whether any hook body assumes cwd — e.g. sourcing
  `.claude/hooks/lib/cmd-detect.sh` or `lib/domain-map.sh` by relative path.
  Those need `$(dirname "${BASH_SOURCE[0]}")` rather than a bare relative path.
- `.claude/settings.json` may be gitignored/untracked like `CLAUDE.md` — check
  before assuming this lands in a PR; it may need the config-edit hand-off
  (stage + provide a `cp` command).

## Scope Contract

- **Mechanisms to use:** `$CLAUDE_PROJECT_DIR` in the existing hook `command`
  strings, and `${BASH_SOURCE[0]}`-relative sourcing inside hook bodies where
  needed. No new hooks, no new wrapper scripts, no restructuring of the hook set.
- **Files in scope:** `.claude/settings.json`, `.claude/settings.local.json`,
  and only those `.claude/hooks/*.sh` files that turn out to resolve paths
  relative to cwd.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A malformed `command` string silently disables a hook rather than erroring
  loudly — the "verify a guard actually DENIES from a subdirectory" acceptance
  criterion exists specifically to catch that, and should not be dropped.
- If `.claude/settings.json` is untracked, the change is local-only and will not
  propagate to other checkouts or to cloud sessions.

## Updates

### 2026-07-25

- Initial creation. Discovered during the PR #716 tap-to-focus investigation
  when an agent `cd`-ed into `node_modules/` and every hook failed for the
  remainder of that call sequence.
