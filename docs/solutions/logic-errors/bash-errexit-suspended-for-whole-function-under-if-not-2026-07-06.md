---
title: 'Bash suspends `set -e` for a function''s ENTIRE call, not just its last command, when the function is the subject of `if !`/`&&`/`||`'
track: bug
category: logic-errors
module: shared
severity: high
tags: [bash, shell, set-e, errexit, error-handling, silent-failure, pg-lab]
symptoms: ['A function wrapped in `if ! my_func "$x"; then ...; fi` (added specifically to isolate one call''s failure from a batch/loop) still lets a failure inside that function pass through silently', 'Only the LAST command in the function seems protected the way `set -e` normally behaves -- earlier unchecked statements in the same function no longer abort anything', 'A batch loop meant to skip a failed item and continue instead commits partial/corrupted state for that item and reports overall success']
applies_to: [scripts/pg-lab/**/*.sh, .claude/hooks/**/*.sh, scripts/**/*.sh]
created: '2026-07-06'
---

# Bash suspends `set -e` for a function's ENTIRE call, not just its last command, when the function is the subject of `if !`/`&&`/`||`

## Problem

`scripts/pg-lab/transcripts.sh --import` loops over session files and, to keep one bad file
from aborting the whole batch, calls `if ! import_file "$f"; then echo "WARNING: ..."; fi`
instead of a bare `import_file "$f"`. `import_file` itself contains two separate steps: an
unchecked `parse_file ... > "$tmp_csv"` (a Python subprocess that parses one JSONL file) and,
later, a checked `psql` transaction. The intent was that `if !` only needed to gate the
*psql* step failing — a JSONL-parsing crash was assumed to already be fatal under the
script's global `set -euo pipefail`.

It was not. Once `import_file` became the subject of `if !`, a crash in `parse_file` (an
unrelated, unchecked statement earlier in the same function) was silently swallowed. The
partial CSV `parse_file` had already written before crashing was loaded as if it were the
complete file, the transaction committed on that partial data, and the per-session line
bookmark advanced to the file's full length — permanently and silently stranding every
message after the crash point, with the batch reporting overall success.

## Symptoms

- A function is wrapped in `if ! my_func "$x"; then ...; fi` specifically to isolate its
  failure from a surrounding loop/batch, but a failure *inside* that function — not just its
  final command — no longer triggers the abort you'd get from a bare, unwrapped call.
- Adding this wrapper to fix one visible problem (e.g., a batch aborting entirely on one bad
  item) silently reintroduces a *worse* version of the same class of bug via a different,
  now-unchecked statement in the same function.
- Reproducible minimal case:

  ```bash
  set -euo pipefail
  inner() {
    echo "before"
    false                # an unchecked statement -- would normally abort under set -e
    echo "after (should NOT print if errexit were still active)"
  }
  if ! inner; then echo "inner failed"; else echo "inner succeeded"; fi
  # Prints: before / after (should NOT print if errexit were still active) / inner succeeded
  ```

## Root Cause

Per POSIX and bash's documented `set -e` semantics, `errexit` does not apply to a command
whose exit status is being tested — this covers `if`, `while`, `until` conditions, and the
left/right sides of `&&`/`||`. When the tested "command" is a **function call**, bash
suspends `errexit` for that function's **entire dynamic extent**, not merely its own return
statement — every statement executed inside the function (and any function it calls) runs as
if `set -e` were off, until the function returns. This is easy to miss because the mental
model of "wrap the risky call in `if !`" implicitly assumes only the risky call's own exit
status is affected; in reality the whole call tree loses `errexit` protection for the
duration.

## Solution

Never rely on the caller's `if !`/`&&`/`||` to catch a failure buried inside a wrapped
function. Every individual step inside that function that can fail must have its own
explicit exit-status check:

```bash
import_file() {
  ...
  if ! parse_file "$file" ... > "$tmp_csv"; then
    rm -f "$tmp_csv"
    return 1
  fi

  if ! psql ... <<SQL
...
SQL
  then
    rm -f "$tmp_csv"
    return 1
  fi
  ...
}

# Caller: safe, because import_file's OWN body already checks every risky step.
if ! import_file "$f"; then
  echo "WARNING: import failed for $f — skipped" >&2
fi
```

A bare, unchecked statement (`risky_call; next_line`) inside a function is only ever safe
under `set -e` if that function is **never** itself called as the subject of `if`/`!`/`&&`/
`||` anywhere in the codebase — a fragile invariant to maintain by inspection as call sites
change. Prefer making every function self-contained: check every fallible statement inside
it explicitly, regardless of how the function happens to be invoked by its caller.

## Prevention

- Treat "wrap this function call in `if !` for per-item error isolation" as a trigger to
  **audit every statement inside that function**, not just its last one — the wrapper widens
  the blast radius of every previously "protected by ambient `set -e`" statement in the
  function body.
- When a fix introduces a new `if ! some_function; then ...; fi` around a function that has
  multiple risky steps, re-run (or write) a test that specifically crashes the function
  **partway through** (not just at the final step) and asserts no partial state was
  committed — a test that only exercises the final step's failure mode will pass even when
  this bug is present.
- Same fail-open family as the `-c` psql substitution and glob-runner-loop bugs below: a
  guard added to prevent one class of failure silently creates a wider blind spot for another
  class, because a defensive-looking construct (`|| true`, `[ -f ] || continue`, `if !`) has
  a narrower actual scope than its author assumed.

## Related Files

- `scripts/pg-lab/transcripts.sh` — `import_file` (the `parse_file` call) and `import_all`
  (the `if ! import_file "$f"` wrapper)
- `.claude/hooks/test-pg-lab-transcripts.sh` — regression test: a mid-file parser crash
  (non-dict `message` field) must commit zero partial rows and never advance the bookmark

## See Also

- [psql -c does not interpolate :'var' substitution](psql-c-flag-skips-var-substitution-2026-07-05.md) — a `|| true` guard on a `-c` call hid a silent failure the same way
- [A glob-driven runner loop passes green when the glob matches nothing](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — same fail-open family: a guard meant to prevent blocking instead hides a real defect
