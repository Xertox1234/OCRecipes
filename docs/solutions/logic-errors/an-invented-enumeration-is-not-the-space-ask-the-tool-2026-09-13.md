---
title: "A guard that enumerates a tool's flags from the spellings you thought of is complete against your imagination, not against the tool — the authority is `<tool> help <verb>`"
track: bug
category: logic-errors
tags: [harness, hooks, safety-gate, bash, security, testing]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh"]
symptoms: ["A guard closes every spelling in its corpus and a reviewer finds another in one command", "A comment names a flag set as complete without citing where the set came from", "A generated corpus is a product of dimensions the author chose rather than dimensions the tool defines", "A residual is classed as a false negative on a gate where a false negative is the bypass"]
created: 2026-09-13
severity: critical
---

# An invented enumeration is not the space — ask the tool

## Problem

A guard must recognise a command shape, so its author enumerates the spellings: four of them,
each measured, mutation-tested, pinned in a generated corpus, with two-sided controls. Every
verification technique is applied correctly. The guard still misses the shape it exists to
catch, because **all of that work ran downstream of an enumeration that was invented rather
than obtained.**

Measured on `lib/cmd-detect.sh`, 2026-09-13. `_CMD_GH_GLOBALS` models the flag slot between
`gh` and its namespace. It names `-R`/`--repo` as the separate-arg flags and carries a generic
single-token `-…` catch-all for the rest, with this comment:

> the arg-taking flags named explicitly (`-R`/`--repo`, the only two `gh` root flags that
> take a separate argument)

That parenthetical is the defect. Cobra accepts **any flag valid for the target subcommand**
in root position, and `gh help pr merge` lists five more that take a separate argument:
`-A/--author-email`, `-b/--body`, `-F/--body-file`, `--match-head-commit`, `-t/--subject`.
An unnamed one leaves its VALUE as a non-dash token, the globals run stops there, and the
needle never reaches the namespace:

```
gh -b x pr merge 42                 -> ALLOW on both guard layers
gh -t x pr merge 42 -R other/org    -> ALLOW on both guard layers
```

The second is the *headline shape the whole change existed to close*, in a spelling the
four enumerated ones do not cover. Controls in the same run: `gh pr merge 42` and
`gh -R other/org pr merge 42` both DENY.

## Symptoms

- The corpus is genuinely generated — a product of {spelling} × {position} × {verb} — and
  still misses, because the author chose the dimension *members*.
- A comment asserts a set is complete without citing a source for the set.
- Review finds the gap by running one command against the tool that nobody on the
  implementing side ran.
- The residual is written down as "a false NEGATIVE, never a false positive", which on a
  **deny gate** is a description of the bypass.

## Root Cause

Generating a corpus combinatorially protects against forgetting a *combination*. It does
nothing about a missing *member*, and every downstream technique inherits that blind spot:
mutation testing proves the clauses discriminate the rows you have; differential testing
compares two versions on the rows you have; two-sided controls prove the harness fired on the
rows you have. **None of them can see a row you never wrote.**

The specific trap is that flag sets feel enumerable from memory. `-R` and `--repo` are the
retarget flags, so they look like the relevant set — and they are, for *retargeting*. The
grammar does not care what a flag MEANS; it cares whether the flag consumes a following
token. That property belongs to the tool's flag table, not to the author's model of intent.

## Solution

**Get the enumeration from the thing being modelled, and cite where it came from.**

- For a CLI flag slot: `<tool> help <verb>`, or the installed man page. Paste the derivation
  into the comment so the next reader can re-run it rather than re-trust it.
- When the set cannot be enumerated (it varies per subcommand, as here), do not name members
  at all — model the **property**. Here that means a generic arm that optionally consumes a
  following non-dash token, which covers every separate-arg flag without naming one.
- Classify the residual by its **direction on this consumer**. "A false negative, never a
  false positive" is a safety claim on an allow-shaped check and a bypass on a deny-shaped
  one. Write which.
- If the fix cannot land in the change that found the gap, **do not let the change claim the
  closure.** Re-scope the todo to partial, record the live shape with its measurement, and
  pin it as a tripwire asserting the CURRENT behaviour so the eventual fix must convert it.

## Prevention

- Before writing a corpus, write down **where each dimension's members came from**. A member
  list with no source is the thing to re-derive.
- Treat "the only N" in a comment as a claim requiring a citation, exactly like a count.
  This repo already requires counts to be computed rather than retyped; a set is a count with
  names attached.
- A reviewer running one command against the real tool is worth more than another pass over
  the corpus. Budget for it.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `_CMD_GH_GLOBALS` and its OPEN RESIDUAL note
- `.claude/hooks/test-cmd-detect.sh` — the five tripwire rows pinning the live shape
- `todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md` — re-scoped to partial for this reason, then CLOSED 2026-09-13 by modelling the property instead of lengthening the list

## See Also

- [a shared command-position anchor must cover every REAL boundary, not just the operators the author enumerated](cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md) — the same lesson where the authority is the shell grammar rather than a CLI's flag table
- [widening is safe on every deny read and a false grant at the one allow read](widening-is-safe-on-every-deny-read-and-a-false-grant-at-the-one-allow-read-2026-09-13.md) — the sibling defect in the same change
- [a guard and its mutation test can both be inert while green](../code-quality/a-guard-and-its-mutation-test-can-both-be-inert-while-green-2026-09-13.md)
