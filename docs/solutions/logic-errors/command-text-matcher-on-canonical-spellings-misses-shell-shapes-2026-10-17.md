---
title: "A command-text matcher keyed on canonical spellings misses the shapes a shell accepts — collapse blanks, absorb wrappers, and keep pre-verb options in the flag scan"
track: bug
category: logic-errors
module: shared
severity: medium
tags: [harness, hooks, bash, shell, matcher, cmd-detect, advisory]
symptoms: ['A PreToolUse Bash hook matching `npm install <pkg>` stays silent on `npm  install  lodash` (two spaces), `npm install<TAB>lodash`, `{ npm install x; }`, `sudo npm install x`, `time npm install x`, `npx --yes expo install x` and `npm --prefix client install x`', 'After adding a pre-verb option skip, `npm -g install x` fires although `-g` is a global install — the flag was consumed before the global scan saw it']
applies_to: [.claude/hooks/*.sh]
created: '2026-10-17'
---

# A command-text matcher keyed on canonical spellings misses the shapes a shell accepts — collapse blanks, absorb wrappers, and keep pre-verb options in the flag scan

## Problem

`nudge-dependency-add.sh` (PR #1476) detected a dependency add with an exact-string `case`
on `"npm install "*`, `"npx expo install "*`, `"yarn add "*`, `"pnpm add "*` over the
quote-aware word rendering from `lib/cmd-detect.sh`. The rendering keeps the command's
bytes (it only neutralises quoted spans), so every shape a shell accepts but a human does not
type canonically slipped past: runs of blanks, a tab, a brace group, `sudo`/`time` in front,
flags between `npx` and `expo`, and npm's own options before the verb. The #1476 review
measured eight silent real adds under bash.

The repair (#1478) added a pre-verb option loop — and introduced the mirror defect: the loop
consumed `-g`/`--global` before the global scan, so `npm -g install lodash` started to fire.

## Symptoms

- A hook that matches on `"verb sub "*` fires on the test file's spellings and nowhere else.
- A whitespace-only variation of a positive test (two spaces, a tab) turns it silent.
- A wrapper the shell absorbs (`sudo`, `time`, `env`, `{ … ; }`) turns it silent.
- A flag that changes meaning (`-g`) placed before the verb is read as "no flag".

## Root Cause

The matcher modelled the command as a string, not as argv. `cmd_words` preserves word
BOUNDARIES (that is its contract) but not single-spacing, and a `case` glob compares bytes.
Wrappers and pre-verb options are argv words the shell or the tool skips before reaching
the verb; a string match cannot skip them. The regression came from treating pre-verb
words as "noise to strip" instead of as part of the argument list to scan.

## Solution

In the per-segment loop of `nudge-dependency-add.sh`:

1. Collapse runs of blanks and tabs first: `seg=$(printf '%s' "$seg" | tr -s '[:blank:]' ' ')`.
2. Absorb wrappers alongside env assignments: `env|command|builtin|exec|nohup|setsid|sudo|time`,
   and split segments on `{`/`}` as well as `;&|()` and the backtick.
3. Allow flags between `npx` and its subcommand, and npm options before the verb; options that
   take a value (`--prefix`, `--registry`, `--loglevel`, `--cache`, `--userconfig`,
   `--workspace`/`-w`, `-C`/`--cwd`) consume it.
4. Initialise the flag scan's state BEFORE the pre-verb loop and set `global=1` there too, so a
   global flag counts wherever it sits.

Tests pin each shape two-sided (`test-nudge-dependency-add.sh`, 32 cases): the eight silent
shapes now fire; `npx --yes expo install --fix`, a bare `npm --prefix client install`,
`sudo npm ci`, `npm -g install x` and `npm --global install x` stay silent.

## Prevention

- When a hook's precise matcher reads `cmd_words`/`cmd_words_deep`, normalise blanks before
  any string comparison, and enumerate wrappers from what the shell absorbs, not from what the
  tests happen to use.
- A reviewer probing a command matcher generates the corpus from its dimensions
  (wrapper × spacing × verb × option-with-value × separator × substitution); the #1478 review
  ran 1,872 rows that way and found the `-g` regression a hand-listed corpus had missed.
- Any "skip these words before the verb" loop must also feed the words it skips into every
  check that keys on them.

## Related Files

- `.claude/hooks/nudge-dependency-add.sh` — the matcher (segment loop, pre-verb option loop)
- `.claude/hooks/test-nudge-dependency-add.sh` — the two-sided shape corpus
- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words` / `cmd_words_deep` contracts (word boundaries kept, spacing not normalised)

## See Also

- [classify a command by its full text, not its display line](classify-a-command-by-its-full-text-not-its-display-line-2026-09-26.md) — the earlier matcher-vs-rendering lesson
- [the whitespace class in an extraction regex silently sets its boundary](whitespace-class-silently-sets-extraction-regex-boundary-2026-08-05.md) — whitespace as an unintended dimension
- [bash `read` skips a final line with no trailing newline](bash-read-tab-ifs-collapse-and-trailing-newline-strip-2026-07-06.md) — the first bug this hook hit, same session
