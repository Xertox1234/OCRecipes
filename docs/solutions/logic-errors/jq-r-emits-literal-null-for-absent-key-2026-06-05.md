---
title: jq -r emits the literal string "null" for an absent key (breaks session-keyed state)
track: bug
category: logic-errors
module: shared
severity: medium
tags: [jq, shell, hook-scripts, session-state, claude-code, fail-safe]
symptoms: [A shell hook keyed on an optional JSON field (e.g. session_id) behaves as if every caller shares one identity, Per-session state file is created with a literal `-null` suffix (e.g. /tmp/prefix-null), 'Session-less / field-less callers (CI, tests, older harness) get state-dependent behavior they should be exempt from', 'A `[ -z "$VAR" ]` emptiness guard never fires even though the JSON field was absent']
applies_to: [.claude/hooks/**/*.sh]
created: '2026-06-05'
---

# jq -r emits the literal string "null" for an absent key (breaks session-keyed state)

## Problem

When a hook reads an *optional* JSON field to key per-session state, the common idiom

```bash
VAR=$(printf '%s' "$INPUT" | jq -re '.session_id' 2>/dev/null || echo "")
```

does **not** yield `""` when `.session_id` is absent. `jq -r` prints the raw string `null`
for a missing/null key, and `-e` only changes the *exit code* (1 for null/false) — it does
**not** suppress the output. So the command prints `null`, exits 1, and the `|| echo ""`
appends nothing useful. `VAR` ends up as `"null"`, not empty.

This was introduced (and caught the same session) in `inject-patterns.sh` session-dedup:
the dedup guard `{ [ -z "$SESSION" ] ...; } && DEDUP=0` was meant to disable dedup for
session-less callers, but `SESSION="null"` made `[ -z ]` false, so DEDUP stayed on. Every
session-less caller then shared one state file (`/tmp/ocrecipes-pattern-inject-null`) and
deduped against each other — losing injected rules after the first edit.

## Symptoms

- A per-session state path is created literally as `…-null`.
- An emptiness/absence guard on the extracted value never triggers.
- Callers that omit the field (CI, unit tests) get the stateful behavior meant only for
  real sessions — here, repeated test runs polluted shared state and failed order-dependently.

## Root Cause

`jq -r '.missing'` outputs `null` (the four-character string). `-e` (`--exit-status`) sets
exit code 1 for a null result but still prints it. `$(cmd || echo "")` therefore captures
the `null` from stdout; the `|| echo ""` never runs as a *replacement*, only an append of an
empty line. Net: the variable is `"null"`.

## Solution

Use jq's alternative operator `// empty` so an absent/null key produces **no output**:

```bash
# `// empty` is load-bearing: absent/null -> "" (not "null"); present -> the value.
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
DEDUP=1
{ [ -z "$SESSION" ] || [ "${PATTERN_INJECT_NO_DEDUP:-0}" = "1" ]; } && DEDUP=0
```

`-e` is unnecessary once you use `// empty` — drop it.

## Prevention

- Whenever you extract an **optional** JSON field with jq for control flow, default it in
  jq itself: `jq -r '.field // empty'` (or `// "fallback"`), never rely on `-re ... || echo`.
- Add a test that exercises the **field-absent** path explicitly. The session-less
  back-compat assertion ("a caller with no session_id always gets full output, never the
  deduped pointer") is the test that surfaced this — the case that "obviously passes" is
  exactly where the bug hid.
- Grep sibling hooks for the same idiom — `lsp-nudge.sh` uses `jq -re '.session_id' || echo nosess`, which has the same latent behavior (benign there only because its fallback key is cosmetic).

## Related Files

- `.claude/hooks/inject-patterns.sh` — session-dedup SESSION extraction (fixed).
- `.claude/hooks/test-inject-patterns.sh` — the session-less back-compat assertion.
- `.claude/hooks/lsp-nudge.sh` — same idiom, latent.

## See Also

- [Priority-order and never half-emit when injecting shared context under a size cap](../design-patterns/priority-order-context-injection-under-size-cap-2026-06-05.md) — the dedup feature this bug lived in.
- [docs/rules/*.md must stay terse for the inline injection budget](../conventions/rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md) — the same hook's other constraint.
