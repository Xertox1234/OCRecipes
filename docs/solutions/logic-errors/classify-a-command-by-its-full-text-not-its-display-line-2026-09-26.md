---
title: "Classifying transcript commands — match and join on the FULL command, never the clamped display line, and end a verb at whitespace (`\\b` matched `git merge-tree` as `git merge`)"
track: bug
category: logic-errors
module: shared
tags: [harness, hooks, bash, jq, awk, regex, testing]
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ['A read-only `git merge-tree` / `git merge-base` probe lands in a STATE CHANGES list meant for commits and merges', 'A failed `python3 - <<EOF` heredoc reads as resolved because a DIFFERENT heredoc succeeded later', 'A `git push` on line 2 of a multi-line command is not recognised as a state change']
created: '2026-09-26'
severity: medium
---

# Classifying transcript commands — match and join on the FULL command, never the clamped display line, and end a verb at whitespace

## Problem

`precompact-ledger.sh` sorts a session's Bash calls into BLOCKED / UNRESOLVED FAILURES /
STATE CHANGES / RECENT. Its extraction already builds a **display** field: the command's
first line, clamped. Classifying and joining on that display field (the obvious move, since
it is already there) produced three wrong verdicts, and a `\b` regex boundary added a fourth.

## Symptoms

- A failed heredoc was listed as resolved. Every `python3 - <<'EOF'` call has the same first
  line, so a later *different* heredoc that succeeded looked like "the same command, now passing".
- `cd repo\ngit push …` was not a state change: the pattern only saw `cd repo`.
- A real digest (session 33998fd7) listed "Check 1100's review record, tree, merge result"
  under STATE CHANGES. It was a read-only `git merge-tree` probe. With `\b`, 27 of that
  session's 233 "state change" matches were `merge-tree`/`merge-base`.

## Root Cause

1. The display field is lossy **by design**: it holds the first line, clamped to 2000 then to
   100 characters. Any equality or pattern test run on it inherits that loss. First-line
   equality says nothing about whether two commands are the same.
2. `\b` is a word/non-word transition, and `-` is a non-word character. So
   `git\s+merge\b` matches the `merge` in `merge-tree`. Git subcommands are hyphenated
   (`merge-base`, `merge-tree`, `commit-tree`, `update-ref`), so `\b` is the wrong terminator
   for a verb.

## Solution

Compute every *decision* from the untouched value in the same jq pass that builds the display
field, and carry it as a separate column:

```jq
(.input.command // "") as $c
| "U\t…\t\(if ($c | state_change) then "1" else "0" end)\t\($c | tojson)\t…\t\($c | split("\n")[0] …)"
#        ^ state flag from the FULL command     ^ join key: full command, tojson puts tabs/newlines on one field
```

The awk join keys "a later success of the same command" on that `tojson` column, then drops
it before redaction, just as the tool_use id was already dropped. End each verb at
`(\s|$)`, not `\b`:

```
git(\s+-C\s+\S+)?\s+(commit|push|merge|…)(\s|$)
```

## Prevention

- **The field a human reads is not the field a decision reads.** When a pipeline has clamped a
  value for display, check every `==`, `test()` or join key downstream of the clamp.
- **A mutation that turns a test red may be the wrong mutation.** In this change, a mutation
  that swapped only one side of the join (`ok_later[cmd]` against a `key[id]` lookup) turned the
  suite red by breaking *every* join, not the one under test. Re-run it with both sides swapped
  and check which test fired: `test-context-ledger.sh`'s heredoc case must be the one that goes red.
- **A regex that classifies commands gets checked against a real transcript's counts**, not
  just fixtures. The `merge-tree` false positive only showed up as "233 of 995 is suspiciously
  high"; a hand-written fixture had no reason to contain it.

## Related Files

- `.claude/hooks/precompact-ledger.sh`: `state_change`, `classify_ur`, `section`
- `.claude/hooks/test-context-ledger.sh`: sectioned-floor cases (heredoc join key, line-2 push, merge-tree)

## See Also

- [command-gate-option-cardinality-and-verb-boundary-2026-07-20.md](./command-gate-option-cardinality-and-verb-boundary-2026-07-20.md): same family on a DENY gate (repeated `-C`, subcommand boundary)
- [pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md](./pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md): why the new tests use here-strings, not `printf | grep -q`
