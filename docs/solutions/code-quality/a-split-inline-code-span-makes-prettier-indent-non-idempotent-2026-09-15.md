---
title: "A markdown inline code span split across a line break makes prettier's list-continuation indent non-idempotent — it walks down 2 spaces per run"
track: bug
category: code-quality
tags: [harness, code-review, verification]
module: shared
applies_to: ["todos/**/*.md", "docs/**/*.md", "*.md"]
symptoms: ["One continuation line in a list item is indented differently from its siblings", "An indent changes in commits that had no interest in that file", "Setting the indent by hand does not stick — it is different by the time you push", "The same line's indent decreases by exactly 2 across successive commits", "prettier --write on an unchanged file keeps producing a diff"]
created: 2026-09-15
severity: low
---

# A split inline code span makes prettier's list-continuation indent non-idempotent

## Problem

One continuation line in a markdown Acceptance-Criteria bullet sat at a 4-space
indent while all four of its siblings sat at 6. A commit claimed to have "restored
its six-space indent"; it had never been at six, and the repair did not stick.

Its history across the branch looked like drift:

| when | indent |
| --- | --- |
| file created | 4 |
| an unrelated frontmatter-cleanup commit | 2 |
| an unrelated de-numbering commit | 0 |
| a commit that explicitly set it to 6 | 4 |

Every transition is a decrement of exactly 2, applied by commits that never touched
the line. That is not drift, it is a rule firing.

## Symptoms

- A continuation line's indent differs from its siblings in the same list item.
- The indent moves in commits whose diffs do not mention it.
- Setting it by hand does not survive: you write 6 and the committed file has 4.
- `prettier --write` on an otherwise unchanged file keeps producing a diff.

## Root Cause

**prettier is not idempotent on that line.** Measured directly, running
`npx prettier --write` repeatedly on a copy:

```
set to 6  ->  4
4         ->  2
2         ->  0
0         ->  0     (stable)
```

It removes two spaces per run until it bottoms out at zero.

The trigger is not the indent. It is that an inline code span was **split across a
line break**:

```markdown
- [ ] `SITE_CB_VERBS` is generated from the literal
      alternation text — a TWO-GROUP alternation (`(channel|branch):(create|edit|delete|
    rename)`), so the extraction needs both groups ...
```

The continuation resumes *inside* an unterminated code span, so prettier does not
treat it as an ordinary list continuation and re-indents it under different rules
each pass.

Any repo where `todos/` or `docs/` is NOT in `.prettierignore` runs prettier on the
file through lint-staged on every commit that stages it — so each unrelated commit
applies one more decrement. A hand-set indent is undone by the commit hook before
the change is ever pushed, which makes the repair look like it worked locally right
up until you read the committed file.

## Solution

Reflow so the code span sits whole on one line:

```markdown
- [ ] `SITE_CB_VERBS` is generated from the literal
      alternation text — a TWO-GROUP alternation
      (`(channel|branch):(create|edit|delete|rename)`), so the extraction needs both
      groups ...
```

Verify STABILITY, not just the current value — this is the part that distinguishes a
fix from a coincidence:

```bash
cp file.md /tmp/t.md
for i in 1 2 3; do
  npx prettier --write /tmp/t.md >/dev/null
  awk 'NR==44 {m=match($0,/[^ ]/); print "run '"$i"': indent=" (m?m-1:0)}' /tmp/t.md
done
```

Three identical runs means idempotent. One run tells you nothing: the old form also
"looked right" immediately after any single pass that happened to land on 4.

## Prevention

- Never break an inline code span across a line. Move the whole span to the next
  line instead — it is also unreadable in raw form when split.
- When an indent or format keeps changing in commits that do not mention it,
  suspect a formatter before suspecting people. The tell is a CONSTANT delta
  applied repeatedly.
- Before claiming a formatting fix, re-read the file AFTER committing. A pre-commit
  formatter runs between your edit and the object that lands, so what you wrote and
  what you committed are different artifacts.
- Do not state a prior value you have not verified ("lost its six-space indent") —
  the history is in git and takes one command to check.

## Related Files

- `todos/archive/P3-2026-09-14-site-upd-cb-verbs-still-hand-listed-not-extracted.md` — where this was found
- `.prettierignore` — `docs/solutions/` is listed here; `todos/` deliberately is not

## See Also

- [[a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13]] — the same
  discipline for figures: the committed tree, not the tree you edited
- [[confirming-a-member-exists-is-not-confirming-the-list-is-exhaustive-2026-09-15]]
- [[git-mv-lint-staged-drops-content-edits-2026-07-05]] — the other
  lint-staged-rewrites-your-work case
- [[prettier-reformats-generated-files-2026-05-13]] — prettier rewriting a file
  that something else owns
