---
title: "A guard pass that reinterprets shell text must be graded against real bash — a hand-listed corpus of contexts misses whole families, a self-grading corpus does not"
track: knowledge
category: conventions
tags: [harness, security, shell-quoting, testing, corpus, false-negative]
module: shared
applies_to: [".claude/hooks/guard-outward-cli.sh", ".claude/hooks/git-safety.sh", ".claude/hooks/lib/cmd-detect.sh", ".claude/hooks/lib/write-targets.sh"]
created: 2026-10-25
---

# A guard pass that reinterprets shell text must be graded against real bash

## Rule

When a guard change rewrites or re-reads shell text (closes a quote, honors a leading `cd`, skips a
`<<` it thinks is not a heredoc), run an old-vs-new differential over a **generated** corpus and grade
every flipped verdict by running the command in **real bash**, with the outward command swapped for
`echo RAN`. A row is BAD only when the old guard denied, the new guard allows, and bash prints `RAN`.
The bar is zero BAD rows, shown with a positive control that does print `RAN`.

Do not grade flips against a list of "contexts where X is not really X" that you wrote yourself. That
list is a second copy of the grammar you are trying to model, and it has the same holes.

## Why

The heredoc quote-close pass (#1555) took three rounds. Each round passed a hand-listed corpus of
"`<<` that is not a heredoc", and each round a context was missing from that list:

1. `$((1<<3))` and `(( a<<b ))`: arithmetic shift, read as a heredoc. Fixed by declining on `((`.
2. The decline itself: any command containing `$((1))` turned the whole pass off, which re-opened the
   original bypass. Found by review, not by the corpus.
3. `${x:-<<X}`, `${x/<<X/y}`, `a[1<<X]=1`: parameter expansion and array subscripts. Found by the
   security review as a CRITICAL (DENY on main → ALLOW on the branch, and bash runs the command).

The self-grading corpus (`gen4.sh`, 1,984 rows: 31 `<<` contexts × 2 delimiters × 2 quote kinds × 8
terminator shapes × 2 outward commands) stopped the cycle, because it does not need anyone to know in
advance which contexts are safe. Bash says. It found 0 BAD rows and explained the 96 remaining
DENY→ALLOW flips: in every one, bash and zsh 5.9 both treat the outward text as one quoted word.

The same move settled the #1553 cd question: the guard's model said a failed `cd` stops `&& : | cmd`,
and a real shell confirmed it before the rule went in. See
[failed cd](../logic-errors/failed-cd-runs-later-commands-in-the-original-folder-2026-10-25.md).

## Examples

The harness shape (bash only — the Bash tool's own shell is zsh, so run the script as a file):

```bash
v()    { jq -cn --arg cmd "$1" '{tool_name:"Bash",session_id:"x",cwd:"/tmp",tool_input:{command:$cmd}}' \
           | bash "$2" 2>/dev/null | grep -q '"permissionDecision": *"deny"' && echo deny || echo allow; }
runs() { ( cd "$EMPTY_TMP" && env -i PATH=/usr/bin:/bin /bin/bash --norc --noprofile -c "$1" </dev/null 2>/dev/null ) \
           | grep -q '^RAN' && echo 1 || echo 0; }

for ctx in "${CONTEXTS[@]}"; do for term in "${TERMINATORS[@]}"; do
  c="$ctx"$'\n'"echo 'abc"$'\n'"$term"$'\n'"' ; $OUTWARD #'"      # what the guard sees
  r="${c/$OUTWARD/echo RAN}"                                    # what bash runs
  ov=$(v "$c" "$OLD_GUARD"); nv=$(v "$c" "$NEW_GUARD")
  [ "$ov" = deny ] && [ "$nv" = allow ] && [ "$(runs "$r")" = 1 ] && echo "BAD $c"
done; done
```

- Keep a frozen copy of main's hooks (`old/.claude/hooks/`) so the differential has a fixed baseline.
- Run `r` in an empty temp folder with no rc files and no environment, so `echo RAN` is the only
  thing it can do.
- Split outward words in the script (`"eas up""date"`). The live guard reads the probe's own text.
- Report the denominator: total rows, flips, BAD, and the shell version.

## Exceptions

- Flips in the safe direction (ALLOW→DENY) need no shell run, but count them and sample their shape.
  #1555 had 1,028, all the leak shape it was meant to close.
- A shell disagreement (bash runs it, zsh does not, or the reverse) counts as BAD. The hooks run
  under bash, but the command runs in zsh.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — HEREDOC QUOTE CLOSE pass (#1555)
- `.claude/hooks/git-safety.sh` — leading-cd and stash rules (#1552–#1554)
- `docs/harness-residuals.md` — the measured corpus numbers per PR

## See Also

- [cmd-position anchor missed boundaries](../logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md) — the same kind of hand-listed gap, in another guard
- [new helper re-derived the grammar](../logic-errors/new-helper-re-derived-the-grammar-the-same-change-was-fixing-2026-09-06.md) — PATH-stubbed ground truth for a composition bug
