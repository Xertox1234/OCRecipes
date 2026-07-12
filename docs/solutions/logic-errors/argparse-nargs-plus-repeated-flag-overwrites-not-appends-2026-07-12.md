---
title: 'Python argparse nargs="+" silently OVERWRITES on a repeated flag instead of accumulating — pass multiple values in ONE occurrence, not two'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [python, argparse, cli, shell, ask-kimi, silent-failure, pg-lab]
applies_to: [scripts/pg-lab/**/*.sh]
symptoms: ['A script repeats a CLI flag intending to accumulate multiple values ("--paths a --paths b") and the tool silently keeps only the LAST occurrence''s value(s), with no error', 'A file that should have been included in a bulk-read/summarize CLI call is silently absent from what the tool actually reads, even though a flag naming it was passed on the command line']
created: '2026-07-12'
---

# Python argparse nargs="+" silently OVERWRITES on a repeated flag instead of accumulating — pass multiple values in ONE occurrence, not two

## Problem

Implementing AC3 of `P3-2026-07-10-distill-productionization.md` (PG Lab episodic-distillation
volume control), the handed-down design called for sending a session artifact plus a second,
separate canon-context file to `ask-kimi` "as a SECOND, separate `--paths` argument... confirmed
`ask-kimi --help` accepts multiple `--paths`". The natural reading — repeat the flag,
`--paths "$artifact" --paths "$canon"` — is wrong: `ask-kimi`'s argparse defines `--paths` with
`nargs="+"` and the default `store` action, so a second occurrence of the flag REPLACES the
first's value entirely instead of appending to it. Had this shipped as designed, every
`send_session` call would have silently sent only the canon-context file and dropped the actual
health-gated session artifact — the exact thing being distilled — with no error, no warning, and
a syntactically valid command line.

## Symptoms

- A shell script repeats a CLI flag (`--paths a --paths b`, `--tags x --tags y`, etc.) intending
  to accumulate multiple values, and the tool behaves as if only the last occurrence was ever
  passed.
- Verified empirically with a standalone repro:
  ```python
  import argparse
  p = argparse.ArgumentParser()
  p.add_argument('--paths', nargs='+', required=True)
  args = p.parse_args(['--paths', 'a', 'b', '--paths', 'c', 'd'])
  print(args)  # Namespace(paths=['c', 'd']) — 'a' and 'b' are gone, no error
  ```

## Root Cause

`argparse`'s default `action` for any `add_argument` call — including one using `nargs="+"` — is
`'store'`, which unconditionally overwrites `namespace.<dest>` on every occurrence of the flag.
`nargs="+"` only changes how ONE occurrence consumes multiple positional-looking tokens after it;
it does not change the action to something that accumulates across occurrences (that would be
`action='append'`, which has different semantics again — one list *per* occurrence, not what most
callers expect either). There is no warning or error for a repeated flag under `store`; argparse
treats it as valid and silently keeps only the last value.

## Solution

Pass every value in a SINGLE occurrence of the flag, space-separated — this is exactly what
`nargs="+"` is for:

```bash
# Wrong: the second --paths silently discards the first
"$DISTILL_SEND_CMD" --paths "$artifact" --paths "$canon" --question "$DISTILL_PROMPT"

# Right: one flag, multiple arguments — matches nargs="+" semantics
"$DISTILL_SEND_CMD" --paths "$artifact" "$canon" --question "$DISTILL_PROMPT"
```

In bash, build the argument list as an array so it degrades cleanly when only one path is
present:

```bash
local send_paths=("$artifact")
[ -n "$canon" ] && [ -s "$canon" ] && send_paths+=("$canon")
"$DISTILL_SEND_CMD" --paths "${send_paths[@]}" --question "$DISTILL_PROMPT"
```

## Prevention

- Never assume a CLI flag "accepts multiple occurrences" from prose alone (a todo spec, a
  teammate's description, `--help`'s one-line summary) — `--paths PATHS [PATHS ...]` in `--help`
  output describes `nargs="+"` (one occurrence, many values), not repeatability. Read the actual
  `add_argument` call, or test empirically with a throwaway `argparse.parse_args()` repro before
  building a design around "pass the flag twice."
- When a design document instructs "pass X as a second, separate flag occurrence," treat that as
  a hypothesis to verify against the actual tool, not a given — especially for internal/local
  CLIs (like the `kimi-*` scripts here) that have no versioned, authoritative docs to check
  against.

## Related Files

- `scripts/pg-lab/distill.sh` — `send_session()`: builds `send_paths` as a bash array and passes
  it via ONE `--paths` flag (the fix)
- `~/.local/bin/ask-kimi` (outside the repo) — `p.add_argument("--paths", nargs="+",
  required=True, ...)`, the argparse definition that triggers this behavior

## See Also

- [bash unsets errexit inside $(...)](command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md) — same file and function (`send_session`), a different silent-failure trap
