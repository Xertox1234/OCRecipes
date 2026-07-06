---
title: 'bash `read` collapses tab-delimited empty fields and skips a final line with no trailing newline'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [bash, shell, read, ifs, delimiter, command-substitution, silent-failure, hooks]
symptoms: ['A while-read loop with IFS set to a literal tab silently misaligns every field after two adjacent empty tab-delimited fields', 'A single-record line built via command substitution and piped into a while-read loop is silently skipped — the loop body never runs for it, with no error anywhere', 'A multi-record accumulator built by repeated command-substitution concatenation collapses record boundaries because each capture loses its own trailing newline']
applies_to: [scripts/pg-lab/**/*.sh, .claude/hooks/*.sh]
created: '2026-07-06'
---

# bash `read` collapses tab-delimited empty fields and skips a final line with no trailing newline

## Problem

A small line-oriented IPC format was built between two bash scripts: a producer accumulates
one `\t`-delimited record per line into a string, then pipes the whole batch into a consumer
that does `while IFS=$'\t' read -r f1 f2 f3 ...; do INSERT ...; done`. Three independent
bugs in this shape all produced the SAME symptom — a record silently vanished, with the
producer, the consumer, and the caller all reporting success (exit 0, no stderr) — because
the whole pipeline was deliberately fail-silent by design (a backgrounded logging call that
must never surface a failure to its caller).

## Symptoms

- `printf 'a\tb\t\t\td\te\tf\n' | { IFS=$'\t' read -r f1 f2 f3 f4 f5 f6 f7; ...; }` assigns
  `f3=d f4=e f5=f f6= f7=` — the two empty fields between `b` and `d` vanish and every
  subsequent field shifts left, instead of `f3= f4= f5=d f6=e f7=f`.
- A record built via `line=$(printf '...\n')` and piped into `printf '%s' "$line" | while read
  -r ...; do BODY; done` never runs `BODY` — the loop exits immediately, silently, exit 0.
- `acc="${acc}$(printf '...\n')"` repeated in a loop produces one giant run-on line instead
  of N separate lines, because each `$(...)` capture strips ITS OWN trailing newline before
  concatenation.

## Root Cause

Three distinct, compounding shell behaviors:

1. **`$(...)` command substitution strips ALL trailing newlines from its output**, not just
   one. Building a multi-record accumulator with `acc="${acc}$(printf 'record\n')"` therefore
   never actually gets a `\n` between records — each capture arrives newline-stripped, so
   concatenation runs every record together on one line.
2. **bash's `read` treats tab (and space, and newline) as "IFS whitespace" and collapses RUNS
   of it, even when `IFS` is set to that character ALONE** (`IFS=$'\t'`, nothing else). This is
   the standard whitespace-collapsing word-splitting behavior applying to tab/space/newline
   specifically, regardless of whether other characters are present in `IFS` — it is NOT
   specific to the default `IFS` value. A genuinely non-whitespace delimiter (a comma, or the
   ASCII Unit Separator `\x1f`) does NOT get this treatment: `IFS=',' read -r f1 f2 f3 f4` on
   `a,b,,d` correctly yields `f3=` (empty) and `f4=d`, verified side-by-side with the tab case
   above under the same bash (GNU bash 3.2, macOS's stock `/bin/bash`).
3. **`read` returns non-zero when it hits EOF without a trailing newline, even though it DID
   populate the variables with whatever was read.** A `while read -r ...; do BODY; done` loop
   uses `read`'s exit status as its condition, so when the read input's last (or only) line
   has no trailing `\n`, the loop's condition fails and `BODY` never executes for that line —
   despite the fields having been correctly parsed and assigned.

Bug 1 broke a producer accumulating N records per hook invocation (fields intact, but no line
separator between records). Bugs 2+3 broke a consumer handling a single-record caller whose
record legitimately had two adjacent empty fields (a SessionStart digest event has neither an
edited file path nor a domain, unlike a per-file PreToolUse event) AND whose line, built via
`$(...)`, had no trailing newline (per bug 1's own mechanism, applied to a single record this
time).

## Solution

1. Never rely on a bare `$(...)` capture to preserve a trailing newline in an accumulator.
   Append it back explicitly: `acc="${acc}$(printf 'record')"$'\n'` (note the format string
   itself has NO trailing `\n` — it is added back outside the capture, once, reliably).
2. For any line-oriented format where a field CAN legitimately be empty — especially two
   adjacent empty fields on the same line — do not delimit with `\t` (or any of tab/space/
   newline). Use a delimiter bash's word-splitting never collapses: the ASCII Unit Separator
   (`\x1f`, `printf '\x1f'` or `$'\x1f'`) is the standard choice for exactly this — it never
   appears in real text and is a "hard" (non-whitespace) `IFS` character.
3. Make any `while read` loop that might see a final line without a trailing newline resilient
   with the standard idiom: `while IFS=... read -r v1 v2 ...|| [ -n "$v1" ]; do BODY; done` —
   the `|| [ -n "$v1" ]` clause runs `BODY` one more time when `read` failed at EOF but DID
   assign content to the first variable.

```bash
# Producer: newline is added back OUTSIDE the $(...) capture, every time.
LOG_TSV="${LOG_TSV}$(printf '%s\x1f%s\x1f%s' "$a" "$b" "$c")"$'\n'

# Consumer: \x1f delimiter (not \t) + the EOF-without-newline guard.
while IFS=$'\x1f' read -r a b c || [ -n "$a" ]; do
  # BODY runs for every record, including a final line with no trailing \n.
  :
done
```

## Prevention

- Treat `$(...)` as newline-hostile by default: if you need the newline back, add it back
  explicitly, once, outside the substitution — never assume the format string's own `\n`
  survives the capture.
- Never delimit a shell line-format with `\t` (or any whitespace) if ANY field can be empty —
  reach for `\x1f` (or another hard, non-whitespace delimiter) instead. Verify with a quick
  side-by-side test (`printf 'a\tb\t\t\td\n' | { IFS=$'\t' read ...; }` vs. the `\x1f`
  version) rather than assuming `IFS=$'\t'` behaves like a "custom" (non-collapsing)
  delimiter — it does not, specifically because tab is a whitespace character.
- Always write `while read ... || [ -n "$firstvar" ]; do` for any consumer of a caller-built
  (not file-tail, not `find -print0`-piped) line, since a caller-built single line via
  `$(...)` is essentially guaranteed to arrive with no trailing newline.
- This class of bug is especially dangerous behind a deliberate `|| true` / fail-silent
  guard (a logging call that must never surface an error to its caller): the guard exists to
  swallow a REAL failure (DB down, network partition) without blocking the caller, but it
  also swallows THIS kind of shell-syntax bug with equal silence. Run the pipeline once
  without the guard, and inspect the actual row count landed in the target table, while
  implementing — don't just check the exit code.

## Related Files

- `.claude/hooks/inject-patterns.sh` — `LOG_TSV` accumulator (fixed: `\n` appended outside
  each `$(...)` capture; `\x1f` delimiter instead of `\t`)
- `.claude/hooks/session-recent-issues.sh` — single-record `LOG_LINE` built via `$(...)` (same
  `\x1f` delimiter fix; the two-adjacent-empty-fields case this file's own log line exhibits)
- `scripts/pg-lab/log-injection.sh` — consumer `while IFS=$'\x1f' read -r ... || [ -n
  "$session_id" ]; do` loop
- `.claude/hooks/test-pg-lab-log-injection.sh` — regression coverage for both the
  no-trailing-newline case (rounds 1-3, every record captured via `$(...)`) and the
  multi-record-in-one-call case (round 4)

## See Also

- [psql -c does not interpolate :'var' substitution — only script/stdin/-f input does](psql-c-flag-skips-var-substitution-2026-07-05.md) — same family: a shell/CLI quirk hidden behind a `|| true` fail-silent guard silently drops a row with no error anywhere
- [A glob-driven runner loop passes green when the glob matches nothing](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — same fail-open family: a guard meant to prevent blocking instead hides a real defect
