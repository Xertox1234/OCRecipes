---
title: bash counts parentheses THROUGH a quoted heredoc body inside $( ), so pasted data with an unmatched ( kills the script at parse time
track: bug
category: runtime-errors
module: shared
severity: medium
tags: [bash, shell, heredoc, command-substitution, parser, harness, hooks, ci, fixtures]
symptoms: [A script dies with "unexpected EOF while looking for matching )" pointing at a line far from the real cause, bash -n fails on a file whose logic was never executed and whose shell syntax looks correct, A heredoc block that was fine as a standalone file breaks after being moved inside VAR=$(cat <<EOF ... ), The reported error line is the start of a command substitution while the offending character is hundreds of lines below inside quoted data, A generated fixture or pinned manifest breaks the script only after the generator's text is truncated or reworded]
applies_to: [.claude/hooks/**, scripts/**/*.sh, .husky/**]
created: '2026-09-08'
---

# bash counts parentheses THROUGH a quoted heredoc body inside `$( )`

## Problem

A quoted heredoc (`<<'EOF'`) promises its body is inert — no expansion, no
substitution, pure literal text. That promise covers *expansion*. It does not cover
*parsing*. When the heredoc sits inside a command substitution, bash's `$( )` scanner
walks the whole region looking for the matching `)` and counts parentheses as it goes,
including ones inside the heredoc body. A body containing an unmatched `(` desyncs the
scanner and the file dies at **parse time**:

```
script.sh: line 1114: unexpected EOF while looking for matching `)'
script.sh: line 1987: syntax error: unexpected end of file
```

Both line numbers are misleading. `1114` is where the command substitution *opened*;
`1987` is the end of the file. The offending character was ~300 lines below 1114, inside
data.

Found 2026-09-08 pinning 356 deny-reason fingerprints into
`.claude/hooks/repro-outward-cli-corpus.sh`. The fingerprints are produced by
`cut -c1-72`, and two of the guard's messages happen to be truncated **mid-parenthetical**:

```
command-position 'npm run update:preview/update:production' (and the yar
command-position 'gh api' with a mutating HTTP method (-X/--method POST/
```

Two stray `(` in a 356-line block. Nothing in the shell *logic* was wrong.

## Symptoms

- `bash -n` fails on a file whose executable statements are all well-formed.
- The error names a `)` that is not missing, at a line where nothing is wrong.
- The same heredoc body works standalone and breaks once wrapped in `$( )`.
- The breakage appears when *generated data* changes, not when code changes — so it
  survives every logic test and fails on the next regeneration.

## Root Cause

`$( )` is delimited by parenthesis matching, and that matching happens during the parse,
before any heredoc is read as data. Quoting the delimiter suppresses expansion of the
body; it does not remove the body from the region the `$( )` scanner traverses. So the
literal-text guarantee a quoted heredoc gives you is narrower than it reads.

This is the same class as the `cmd-detect` bare-paren scanner desync fixed in `dd45ef3e`
and the [even-apostrophe-count awk program](bash-n-misses-an-even-apostrophe-count-in-a-quoted-awk-program-2026-09-07.md):
a scanner that counts a delimiter character while stepping over text that is *supposed* to
be opaque. The distinguishing feature is that the trigger is **data**, so it appears and
disappears with content the author does not control.

## Solution

Emit the heredoc from a plain function body and call the function. A heredoc in a normal
command position is never traversed by a `$( )` scanner, so the body is genuinely inert:

```bash
# BREAKS when the body contains an unmatched ( :
EXPECTED=$(cat <<'DATA_EOF'
... 356 lines of generated text ...
DATA_EOF
)

# SAFE — the substitution now spans one function call, not the data:
_expected_data() { cat <<'DATA_EOF'
... 356 lines of generated text ...
DATA_EOF
}
EXPECTED=$(_expected_data)
```

Leave a comment saying *why*, or the next reader will "simplify" it back — the two forms
look equivalent and the failing one is the more idiomatic.

`printf '%s\n'` over an array is another way out when the data is already in a variable,
but it does not help for a large literal block, which is exactly where this bites.

## Prevention

- Any time a heredoc body is **generated** rather than hand-written — a pinned manifest,
  a fixture, a captured tool output — assume it can contain arbitrary punctuation, and
  keep it out of `$( )`.
- Truncation is a paren generator. `cut`, `head -c`, and column-limited output all cut
  through balanced pairs and leave one half behind. If the block is produced by a
  truncating pipeline, the balance property you would reason from does not hold.
- `bash -n` DOES catch this, and cheaply — but only if you run it. It is a parse error, so
  no test of the file's behaviour can reach it; a suite that only ever runs the script when
  it parses will never report the class. Run `bash -n` after any change that rewrites a
  data block, and run it under **both** the local bash and the CI bash when they differ in
  major version.

## Related Files

- `.claude/hooks/repro-outward-cli-corpus.sh` — `_pin_expected_attrib()`, the function-body
  form and the comment explaining why it is not `$(cat <<'EOF' … )`
- `.claude/hooks/guard-outward-cli.sh` — source of the two mid-parenthetical deny messages

## See Also

- [bash -n misses an even apostrophe count in a quoted awk program](bash-n-misses-an-even-apostrophe-count-in-a-quoted-awk-program-2026-09-07.md) — the mirror image: a parser that is *happy* while the embedded program is mangled
- [quoted command substitution always executes](../logic-errors/quoted-command-substitution-always-executes-2026-08-17.md) — another case of quoting being narrower than it reads
- [A glob-driven runner loop passes green when the glob matches nothing](../logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — the pin this manifest belongs to, and the progression it sits at the end of
