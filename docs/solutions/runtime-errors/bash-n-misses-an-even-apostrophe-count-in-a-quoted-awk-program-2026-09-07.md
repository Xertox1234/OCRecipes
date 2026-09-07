---
title: "bash -n passes an EVEN number of apostrophes inside a single-quoted awk program — the parser is happy and awk is mangled"
track: bug
category: runtime-errors
tags: [harness, shell-quoting, testing]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["awk reports a syntax error or 'N missing }s' at a line that looks fine", "bash -n reports no error on the same file", "Every function in a sourced lib suddenly returns empty", "A guard that reads that lib starts failing closed with 'unsourceable (broken install)'", "The awk error context points at prose inside a comment"]
created: 2026-09-07
severity: medium
---

# `bash -n` misses an even apostrophe count in a quoted awk program

## Problem

`.claude/hooks/lib/cmd-detect.sh` embeds its awk programs as bash **single-quoted** strings:

```bash
cmd_bare() {
  awk '
    ...program, including comments...
  '
}
```

A literal apostrophe anywhere inside — including in a comment — closes that string. The file
documents this and `bash -n` is the prescribed gate.

**`bash -n` only catches an ODD count.** An even number closes the string and reopens it, so
bash still parses the file as valid, while the text bash hands to awk has silently changed.
Writing this in an awk comment:

```
# run `bash -c 'echo "e$((:)|(:))as"'` and it really invokes eas
```

left `bash -n` clean and produced:

```
awk: syntax error at source line 60
 context is
	          # `bash -c >>>  ech <<<
awk: illegal statement at source line 60
	3 missing }'s
```

## Symptoms

- `bash -n <file>` exits 0; sourcing the file works; **every function returns empty**.
- awk's error context quotes *prose from a comment*, not code.
- A guard consuming the lib fails closed with "lib/cmd-detect.sh is unsourceable (broken
  install)" — which reads like a guard bug, not a syntax error.
- A test suite that pipes through those functions reports mass failures with `got:` empty and
  `want:` populated on rows unrelated to the edit.

## Root Cause

Quote state is a property of the *whole file*, and an even number of apostrophes restores it.
So the two checks disagree about what they are checking:

- `bash -n` validates **bash** syntax, and `'…'` `'…'` is two valid adjacent strings.
- awk receives the **concatenation** of those strings minus the shell text between them, which
  is a different program.

The single-quote is not escapable inside a single-quoted string, so there is no "write it
carefully" fix — the character simply cannot appear.

## Solution

Do not put an apostrophe in the awk program at any count. Where prose needs one:

- rewrite to avoid it (`the header of that function` rather than `that function's header`);
- use a backtick for a possessive in a comment (`this file\`s own rule`) — the surrounding
  string is single-quoted, so a backtick is inert;
- spell a needed quote character via its code: `SQ = sprintf("%c", 39)`, which is what these
  programs already do for the runtime case.

**Gate on running the function, not on parsing the file:**

```bash
bash -n .claude/hooks/lib/cmd-detect.sh || exit 1        # necessary, NOT sufficient
printf '%s' 'gh pr me${UNSET}rge 42' | _cmd_vanish_pass 1   # this is the real check
```

A one-line smoke call after every edit catches both parities; `bash -n` catches one.

## Prevention

- Treat `bash -n` on a file containing embedded interpreter programs as a **lint**, not a
  verification. It cannot see inside the quoted payload.
- Any file whose test suite can report "all functions returned empty" wants a smoke assertion
  that runs one function early, so the failure names the cause instead of scattering.
- When an error's context quotes a comment, suspect the quoting of the enclosing string before
  suspecting the logic near that line.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — every `awk '...'` block; `cmd_extract_substitutions`'
  own state-2 comment records the odd-count version of this hazard.
- `.claude/hooks/test-cmd-detect.sh` — the suite whose mass-empty failures are the usual first
  symptom.

## See Also

- [A special case that only prevents a false positive](../code-quality/a-special-case-that-only-prevents-a-false-positive-2026-09-07.md) — the edit during which this was hit.
