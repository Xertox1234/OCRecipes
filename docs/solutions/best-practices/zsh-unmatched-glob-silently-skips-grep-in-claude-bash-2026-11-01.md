---
title: 'zsh aborts a command whose unquoted glob matches no file — an unquoted `grep --include=*.ts` never runs, and the rest of the line reports "nothing found"; set nonomatch for Claude Code shells'
track: knowledge
category: best-practices
module: agents
tags: [agents, tooling, harness]
applies_to: [.claude/agents/*.md, .claude/skills/*/SKILL.md]
created: '2026-11-01'
---

# An unmatched glob silently skips the command in Claude Code's zsh

Claude Code's Bash tool runs each command as `/bin/zsh -c 'source <snapshot> && … <command>'`.
In zsh, a word containing `*`, `?` or `[…]` is a filename pattern even inside an option, so
`grep -rn --include=*.ts foo server` asks zsh for files named `--include=<something>.ts`. None
exist, and with zsh's default `nomatch` option zsh prints
`(eval):1: no matches found: --include=*.ts` and **does not run that grep**. Commands after it
on the same line still run. Bash passes an unmatched pattern through as literal text, so the
same line works there.

## Measured (harness diagnosis item 9, 10-10 → 11-01)

- 1,111 "no matches found" in 33,318 Bash results (3.3%, about 50 a day); 1,108 were `*`
  patterns, 720 of them an unquoted `--include=*.<ext>`.
- **939 of the 1,111 were not reported as errors.** The grep never ran, a later command in the
  same line exited 0, and the output read as "no matches". That is a clean zero over a
  population of zero, produced by the shell rather than by the harness.
- Memory rules ("quote globs", "a clean zero needs its denominator") existed through the whole
  window and the rate did not fall.

## The fix: `nonomatch` for Claude Code shells only

`~/.zshenv` (read by every zsh, including non-interactive `zsh -c`; `~/.zshrc` is not read by
the Bash tool):

```
[[ -n $CLAUDECODE ]] && setopt nonomatch  # Claude Code Bash: an unmatched glob passes through as text, like bash
```

- `nonomatch` hands the literal word to the command, as bash does: grep receives
  `--include=*.ts` and filters correctly; `ls app.config.*` with no match gives an honest
  `No such file or directory` and exit 1.
- **Not `null_glob`.** It deletes the unmatched word, so `--include=*.ts` vanishes and grep
  searches every file: a wrong answer that looks right.
- The `CLAUDECODE` guard keeps the owner's own terminal unchanged. Hooks run under bash and
  are unaffected.

Check a shell has it: `[[ -o nonomatch ]] && echo on`. Positive control:
`grep -rln --include=*.md "Item 9" docs/harness` must print a file.

Quoting the glob (`--include='*.ts'`) is still correct and works in both shells; snippets in
agents and skills should keep quoting, since cloud sessions and other machines may not have the
line.

## Re-measure

`python3 scripts/harness/zshscan.py <since> <out.jsonl>` prints the Bash-result denominator,
the count by kind and per day. After the change, only non-glob zsh errors should remain.

## Related Files

- `scripts/harness/zshscan.py`, `scripts/harness/isoscan.py`
- `docs/harness/2026-10-30-diagnosis.md` §2.4 ("Memory rules don't stop repeats")
