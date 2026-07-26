---
title: "A cwd-relative locator silently DISARMS a non-blocking security hook — and a defaulting fallback on that locator re-creates the bug"
track: bug
category: logic-errors
tags: [bash, hooks, settings-json, safety-gate, cwd, claude-project-dir, fail-open, confused-deputy, silent-skip, security]
module: shared
applies_to: [".claude/settings.json", ".claude/hooks/**/*.sh"]
symptoms: ["Hook errors reading `bash: .claude/hooks/<name>.sh: No such file or directory` after an agent `cd`s into a subdirectory", "The errors are reported as `non-blocking`, so the tool call proceeds and nothing is denied", "A guard that has unit tests proving it DENIES a given input nonetheless lets that input through in a live session", "Guard behavior appears to depend on which directory the previous, unrelated command ran in"]
created: 2026-07-25
severity: high
---

# A cwd-relative locator silently DISARMS a non-blocking security hook — and a defaulting fallback on that locator re-creates the bug

## Problem

Every hook in `.claude/settings.json` was registered with a **cwd-relative** command:

```json
{ "type": "command", "command": "bash .claude/hooks/git-safety.sh" }
```

Hook handlers run in the *current* directory, and the Bash tool's working directory
**persists across calls**. So one `cd node_modules/react-native-vision-camera` made all 29
registrations fail for every subsequent call. Because hook failures are reported
**non-blocking**, the tool calls proceeded — `git-safety.sh` and
`guard-worktree-isolation.sh` did not deny anything, because they never ran.

A guard that cannot be found does not fail. It is **skipped**, which is indistinguishable
from "the guard allowed it."

## Symptoms

- `PreToolUse:Bash hook error / Failed with non-blocking status code: bash: .claude/hooks/<name>.sh: No such file or directory`
- The whole guardrail chain (contract-keyed deny, write-shaped tokenizer, `-C` /
  `--git-dir` / `--work-tree` extractors) stops firing after an unrelated `cd`.
- The hooks' own self-tests stay green throughout — they invoke the script by an
  absolute, `${BASH_SOURCE[0]}`-derived path, so they never exercise the broken locator.

## Root Cause

Two distinct defects sit behind one symptom:

1. **Availability.** The locator is resolved against a directory the agent controls and
   changes for unrelated reasons.
2. **Selection — the more serious one.** `bash .claude/hooks/git-safety.sh` executes
   whatever `.claude/hooks/git-safety.sh` happens to exist relative to the current
   directory, and the harness trusts that script's stdout to emit
   `permissionDecision: "allow"|"deny"`. Any checkout, fixture tree, or dependency
   shipping a `.claude/hooks/` directory could therefore supply the verdict. That is a
   confused deputy, not merely a missing file.

## Solution

Register every hook by absolute path via `$CLAUDE_PROJECT_DIR`, double-quoted, with any
arguments **outside** the quotes:

```json
{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/git-safety.sh\"" }
{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-coord-hook.sh\" register" }
```

**Use the bare reference — NOT `"${CLAUDE_PROJECT_DIR:-.}/..."`.** The defaulting form is
the intuitive "defensive" choice and it is wrong here:

| Form | If the variable is unset |
| --- | --- |
| `"${CLAUDE_PROJECT_DIR:-.}/…"` | Silently restores the *exact* cwd-relative bug — permanently, invisibly, in the one direction nobody audits |
| `"$CLAUDE_PROJECT_DIR/…"` | Resolves to `/.claude/hooks/…`, fails loudly and **totally**, at session start, for everyone |

For a **gate**, the failure modes are not symmetric. A loud total break is a 30-second
fix; a quiet partial disarm went unnoticed for six consecutive tool calls in the incident
that prompted this. A fallback that silently re-enables the bug is worse than no fallback.

This is the same asymmetry as
[partial-parse-regresses-crude-total-safety-scanner](partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md):
on a security gate, crude-but-total beats clever-but-partial.

**Hook bodies are a different case.** Inside a script that has *already been located*,
`${BASH_SOURCE[0]}`-relative resolution is correct and needs no variable:

```bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
```

Use it for anything the hook **loads or executes** (`. "$ROOT/scripts/lib/…"`,
`bash "$ROOT/scripts/…"`, `npx` binary/config discovery) — a cwd inside a nested repo or a
package directory would otherwise supply that file, and config files are executable code.
`cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"` inside an already-located body (`session-start.sh`)
is fine: there the fallback is a convenience, not the gate's locator.

**Repo *state* is deliberately NOT the same call.** `git rev-parse HEAD` /
`--show-toplevel` run against process cwd is often *more* correct than a script-derived
root, because the checkout the agent is working in is the one whose HEAD or drift matters.
Do not sweep those mechanically — decide per hook which root is semantically right.

## Prevention

- Assert it in CI. `.claude/hooks/test-settings-hook-paths.sh` fails if any registration
  names its script by a path that is not absolute. Judge the **script token generically**,
  not by pre-filtering for `.claude/hooks/` — a future `bash scripts/foo.sh` has the
  identical defect and must fail too.
- Verify the guard **fires**, not merely that the file resolves — see
  [gate-test-needs-two-sided-negative-control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md).
- A live `cd`-from-a-subdirectory check cannot be done in the session making the change:
  the harness reads hook registrations from `projectRoot` at session start, so an
  uncommitted edit is not live. Do it after merge and restart.

## Related Files

- `.claude/settings.json` — all 29 `command` entries
- `.claude/hooks/test-settings-hook-paths.sh` — the CI regression test
- `.claude/hooks/pr-preflight-guard.sh`, `drift-detect.sh`, `eslint-fix.sh` — cwd-derived
  code loading, fixed to `${BASH_SOURCE[0]}`

## See Also

- [partial-parse-regresses-crude-total-safety-scanner](partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md) — crude-but-TOTAL beats smarter-PARTIAL on a gate
- [fail-open-scanner-wrapper-error-envelope-not-clean-scan](fail-open-scanner-wrapper-error-envelope-not-clean-scan-2026-07-12.md) — the adjacent failure: a gate that *runs* but renders failure as a clean result
- [gate-test-needs-two-sided-negative-control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — proving a guard actually fires
- [parallel-terminal-git-drift-detection](../best-practices/parallel-terminal-git-drift-detection-2026-06-12.md) — hook registration template, updated to the absolute form
