---
title: A placeholder substituted file-wide renames whatever already spelled it — and in shell the wreckage passes `bash -n`
track: bug
category: code-quality
tags: [harness, hooks, bash, verification, code-review]
module: shared
applies_to: [".claude/hooks/**", "scripts/**/*.sh", "scripts/**/*.py", "scripts/**/*.ts"]
symptoms: ["A generated edit renames identifiers the author never mentioned", "A templating placeholder is a word that also appears in real code in the same file", "A file-wide string substitution is described as 'filling in the placeholder'", "A corrupted shell script still passes bash -n and only misbehaves at runtime", "An author uses a placeholder to route around a guard that inspects their own command text", "A probe script is run via bash script.sh so the guard sees no command text, and an unquoted heredoc then expands a command substitution inside it"]
created: 2026-09-13
severity: medium
---

# A placeholder is only safe if it does not already occur in the target

## Problem

Writing an edit script, you need a literal string that you cannot type directly — because a
guard inspects your command text, because a templating layer would interpolate it, because a
linter forbids it. The standard dodge is a placeholder plus a substitution at the end:

```python
new_text = """...gh help pr VERB lists five separate-arg flags..."""
open(path, 'w').write(s.replace('VERB', 'merge'))     # <- file-wide
```

The substitution is applied to the **whole file**, not to the text being inserted. If the
placeholder already occurs anywhere in that file, every occurrence is silently rewritten.

Measured 2026-09-13 on `.claude/hooks/lib/cmd-detect.sh`. `VERB` was chosen as a placeholder
so `gh pr merge` would not appear in the author's own Bash command — a real constraint: this
repo's outward-CLI guard denies that string, and it had already denied several earlier
commands in the same session. The target file contained **13** pre-existing occurrences of
`VERB`, nine of them inside live identifiers:

```
_CMD_GIT_VERBS_COMMIT       ->  _CMD_GIT_mergeS_COMMIT
_CMD_GIT_VERBS_HEAD_MOVER   ->  _CMD_GIT_mergeS_HEAD_MOVER
_CMD_GIT_VERBS_BRANCH       ->  _CMD_GIT_mergeS_BRANCH
```

...plus the four call sites that interpolate them into `git` needles.

## Symptoms

- A diff renames symbols the change description never mentions.
- The placeholder is an ordinary English word (`VERB`, `NAME`, `TYPE`, `CMD`, `PATH`) rather
  than something that cannot collide.
- The substitution is on the accumulated file text (`s.replace(...)` at write time) rather
  than on each replacement string.
- Nothing fails. See below — this is the part that makes it dangerous.

## Root Cause

Two independent mistakes compose, and either alone is survivable.

**The scope is wrong.** The placeholder belongs to the *inserted text*; the substitution was
applied to the *file*. Those are the same object only when the placeholder is unique, which
is an assumption nobody wrote down or checked.

**The failure is silent, specifically in shell.** A renamed shell variable is not an error —
it is an unset variable, which expands to the empty string. So:

```sh
grep -Eq "…git${_CMD_GIT_GLOBALS}[[:space:]]+${_CMD_GIT_VERBS_COMMIT}…"
```

becomes a needle with an empty alternation where the verb set used to be. `bash -n` passes:
the syntax is fine. The file sources cleanly. The function returns — it just matches
different things, and for a **detector** the new behaviour is "matches nothing", i.e. every
gated command is silently allowed. A corrupted guard that parses is worse than one that does
not, because only the latter announces itself.

The reason this particular trap opens is worth stating: the placeholder was introduced to
route around a guard that reads the author's own command text. Guard-avoidance dodges are
written under mild friction, get reused across many small edit scripts, and are never the
thing under review — so they accumulate exactly the kind of unchecked assumption that no test
covers, because no test knows they exist.

## Solution

**Substitute into the replacement, never into the file.**

```python
def sub(old, new, why):
    assert s.count(old) == 1, why
    return s.replace(old, new.replace('VERB', 'merge'))   # <- scoped to the insert
```

The placeholder then cannot reach text it did not come from, and the fix needs no knowledge
of what the target file happens to contain.

**If a file-wide substitution really is intended, assert the placeholder's absence first** —
before the edit, not after:

```python
assert 'VERB' not in original, "placeholder already occurs %d times" % original.count('VERB')
```

**Prefer a placeholder that cannot collide.** `@@VERB@@`, `\x00VERB\x00`, a UUID. An
all-caps English word is exactly the shape that shows up in real identifiers.

**Better still, avoid the placeholder — but read the next paragraph before you do.** The
constraint here was a guard reading Bash command text, and the guard reads *commands*, not
*files*. Writing the script with the Write tool and running `bash script.sh` puts the string
in a file, where no substitution is needed.

**THAT IS ALSO A GUARD BYPASS, AND IT HAS ALREADY FIRED FOR REAL.** The string is unguarded
in the file *and* unguarded when the file runs: the Bash command text is `bash script.sh`,
which contains nothing for the guard to match, so whatever the script does is unreviewed.
Measured 2026-09-13, in the review of the very change this document was written for: a
read-only reviewer agent wrote a probe script with an **unquoted** heredoc delimiter, bash
expanded `$(gh pr merge 42)` inside it, and the agent really invoked `gh pr merge` against
this repository. It was inert only by luck — PR #42 had been merged months earlier
(`mergedAt 2026-04-29`, verified independently), so gh replied "already merged" instead of
merging something. Nothing in the guard chain saw it, because nothing in the guard chain was
looking at the file.

So the rule is narrower than "use a file":

- **Legitimate** when the forbidden string is INERT DATA — a test row, a corpus member, a
  documentation example — that the script passes to something as an argument or writes to
  disk. That is what the guard's own test suites do.
- **Never** when the string sits anywhere it can be EXECUTED: a command substitution, an
  `eval`, a here-doc with an UNQUOTED delimiter (`<<EOF` expands `$(...)`; `<<'EOF'` does
  not), a variable later used as a command.

Quote every heredoc delimiter you do not specifically need expanded, and prefer building the
forbidden string from parts (`V='m'$'\x65''rge'`) over writing it whole, so that even an
accidental expansion has nothing to run. Reaching for a tool that removes a constraint is
right; reaching for one that removes the *check* is how the check stops existing.

## Prevention

- **Any transformation that claims to be total — a substitution, a count, a sweep — needs its
  scope stated and checked.** This is the same defect as `grep -c` counting *lines* when the
  author wanted occurrences: an operation that looks exhaustive, silently is not, and reports
  a plausible number either way.
- **After a generated edit to a shell file, diff for identifiers you did not intend to touch**
  (`git diff -U0 | grep -E '^[-+].*[A-Z_]{4,}='`). `bash -n` does not cover this class, and in
  a hook a renamed variable degrades a detector to "matches nothing" — fail-OPEN.
- **Treat guard-avoidance helpers as code under review.** A dodge invented to get one command
  past a gate will be pasted into the next ten edit scripts, carrying its assumption with it.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — the near-miss target; `_CMD_GIT_VERBS_*` are the
  identifiers a file-wide substitution would have renamed
- `.claude/hooks/guard-outward-cli.sh` — the guard whose (correct) denial of `gh pr merge` in
  command text prompted the placeholder in the first place

## See Also

- [A positional reference decays — anchor instead](a-positional-reference-decays-anchor-instead-2026-09-13.md) — the sibling shape: a reference to a *coordinate or spelling* rather than to the thing itself
- [A guard and its mutation test can both be inert while green](a-guard-and-its-mutation-test-can-both-be-inert-while-green-2026-09-13.md) — what a silently-degraded detector looks like from the outside
- [An invented enumeration is not the space — ask the tool](../logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md) — the change this near-miss occurred during
