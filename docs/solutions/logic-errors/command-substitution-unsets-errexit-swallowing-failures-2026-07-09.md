---
title: bash unsets errexit inside $(...) — a function run as var=$(fn) silently swallows failures
track: bug
category: logic-errors
module: shared
severity: high
tags: [bash, shell, errexit, set-e, command-substitution, inherit-errexit, silent-failure, fail-loud, pg-lab]
applies_to: ["scripts/**/*.sh", ".claude/hooks/**/*.sh", ".husky/**"]
symptoms: ['A function containing unguarded psql/curl/write calls "cannot fail" under set -e, yet a forced failure inside it neither aborts the script nor changes the reported result', A counter increments and a success line prints even though a statement inside the function errored to stderr, 'A paid external call''s result is recorded as fully processed while some of its inserts silently failed']
created: '2026-07-09'
---

# bash unsets errexit inside $(...) — a function run as var=$(fn) silently swallows failures

## Problem

`scripts/pg-lab/distill.sh` ran under `set -euo pipefail` and invoked its send path as:

```bash
read -r s_tin s_tout s_cands s_pfail <<<"$(send_session "$sid" "$run_id" "$artifact")"
```

Inside `send_session`, each candidate row from a **paid** LLM response was inserted with a
bare `insert_candidate` call. Code review forced one INSERT to fail: the loop kept going,
the per-candidate counter still incremented, the function still printed its success tuple,
and the session was bookmarked `sent` — so the failed candidate was lost **permanently**
(the bookmark prevents the session from ever being re-selected), with the only trace an
easy-to-miss stderr line. `set -e` protected none of it.

## Symptoms

- A statement inside a function errors loudly on stderr, but the script neither aborts nor
  reports a failure — counters and success output behave as if everything worked.
- The same function aborts correctly on failure when called as a bare statement, and only
  misbehaves when called inside `$(...)`.

## Root Cause

Bash **unsets errexit in the subshell that runs a command substitution** unless
`shopt -s inherit_errexit` (bash 4.4+) is on — it is off by default, and doesn't exist at
all in macOS's /bin/bash 3.2. So every command inside `var=$(fn)` runs as if `set +e`,
and only fn's *final* exit status can propagate — which the caller here also discarded,
because a substitution used inside a `read ... <<<"$(...)"` redirection word contributes
nothing to any checked status. Two independent layers of swallowing, both invisible at the
call site.

## Solution

Return results via a file and call the function **bare**, so errexit stays live inside it;
keep the failures you *intend* to tolerate individually guarded:

```bash
# Contract: writes "tokens_in tokens_out n_candidates parse_failed" to $WORK/send.result.
send_session() {
  ...
  nd=$(sql ... ) || nd=""        # advisory lookup: explicit degrade, loud on stderr
  insert_candidate ...           # unguarded on purpose: a failed INSERT must abort LOUDLY
  echo "$tin $tout $n 0" > "$WORK/send.result"
}

send_session "$sid" "$run_id" "$artifact"      # bare call — set -e applies inside
read -r s_tin s_tout s_cands s_pfail < "$WORK/send.result"
```

`shopt -s inherit_errexit` is a partial alternative (bash ≥ 4.4 only), but it does not fix
the redirection-word status discard — the bare-call restructure closes both layers.

## Prevention

- In any `set -e` script, treat `var=$(fn)` / `<<<"$(fn)"` where `fn` performs writes or
  other must-not-fail work as a red flag: errexit is OFF inside the substitution. Restrict
  `$(...)` to pure queries; route critical side effects through bare calls.
- When a function mixes tolerable and critical failures, guard the tolerable ones
  explicitly (`|| var=""`, `if ! ...`) and leave the critical ones unguarded under a bare
  call — the guards then document intent instead of relying on errexit accidents.

## Related Files

- `scripts/pg-lab/distill.sh` — `send_session` result-file contract + bare call (the fix)

## See Also

- [Bash suspends set -e for a function's ENTIRE call under if !/&&/||](bash-errexit-suspended-for-whole-function-under-if-not-2026-07-06.md) — the sibling errexit trap: condition context suspends -e for the whole call; this doc's trap is the subshell unset in `$(...)`. Between them: a function only enjoys set -e when called bare, as a plain statement.
