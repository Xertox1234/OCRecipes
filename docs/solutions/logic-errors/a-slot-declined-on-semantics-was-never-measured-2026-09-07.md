---
title: "A slot excluded from a widening on SEMANTIC grounds was never measured — the comment explaining why it was safe was the reason nobody checked"
track: bug
category: logic-errors
tags: [harness, security, false-negative, verification, code-review]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A fix is applied uniformly except at sites excluded by a written rationale, and the excluded sites are still exploitable", "A code comment explains why a case is out of scope and no test covers that case either way", "A widening closes N of M spellings of one bypass and the residual is never enumerated", "Sibling readers of the same text diverge because one is a regex and another is an awk field comparison", "A hand-spelled character class lags a widening applied to a shared constant"]
created: 2026-09-07
severity: critical
---

# A slot declined on semantics was never measured

## Problem

`.claude/hooks/guard-outward-cli.sh` was hardened so that a redirect between a gated tool
word and its verb (`eas 2>&1 update`) could no longer defeat it. One absorber, `_OUT_SEP`,
replaced the hardcoded `[[:space:]]+` at 30 separator slots.

One slot was deliberately left alone, with a comment saying why:

> The flag-VALUE sub-group keeps its plain `[[:space:]]+` deliberately: that slot separates
> a flag from its VALUE, not two required-adjacent command words, so it is not this
> absorber's job.

That sentence is *true about the slot's semantics* and says nothing about its effect. The
effect, measured with a PATH-shadowed argv-printing stub:

```
npm --loglevel silent run update:preview        -> DENY
npm --loglevel 2>&1 silent run update:preview   -> ALLOWED
```

Both build the identical real argv — an OTA publish to real users, the exact incident class
the check exists for. The same shape was live at two more readers of flag adjacency:

```
gh api repos/o/r -X DELETE        -> DENY
gh api repos/o/r -X 2>&1 DELETE   -> ALLOWED     (arbitrary destructive REST with the PAT)
gh pr merge 42 -b>x --auto        -> ALLOWED     (argv: -b eats --auto; merges immediately)
```

## Root cause

**One mechanism, three readers, none of them talking to each other.** A redirect token
adjacent to a flag defeats *every* flag-adjacency reader in the file, whatever its
implementation:

| reader | shape | why it missed |
| --- | --- | --- |
| `_OUT_FLAG_RUN` value sub-group | regex `[[:space:]]+` | excluded by the comment above |
| `gh api` method separator | hand-spelled `([[:space:]]+\|=)` | a literal class that lagged the shared constant |
| `HAS_REAL_AUTO` | `awk` field comparison | splits on whitespace; `-b>x` never equals `-b` |

The absorber was introduced *as a shared constant precisely so that widening it would reach
every site at once* — and two of the three sites were not spelled in terms of it. A shared
constant only unifies the sites that reference it; the ones carrying a hand-written
equivalent are exactly the ones a "substitute the constant everywhere" sweep cannot see.

**A narrowing existed and would have found it.** The mechanism requires a **value-taking**
flag: `npm --silent 2>&1 run update:preview` correctly denies, because a boolean flag lets
the optional value sub-group absorb the redirect. That single control both proves the
diagnosis and bounds it — and it takes one row to run.

**Deeper: the two clause cuts truncated before the check even ran.** `[^;&|]*` excludes `&`
so a clause cannot run past a command separator — but `2>&1`'s `&` is part of a *redirect*,
so the clause ended mid-token and the method or `--repo` was never reached. Widening the
separator alone closed the `>/dev/null` and glued spellings and left the `2>&1` pair open.
**Fixing the reader is not enough when an earlier stage already discarded the text.**

## Solution

Interpolate the shared absorber at the flag→value slots, and admit an fd-duplicating `&`
into the clause bodies:

```bash
_OUT_FLAG_RUN='('"$_OUT_SEP"'-{1,2}[^[:space:]]*('"$_OUT_SEP"'[^-[:space:]][^[:space:]]*)?)*'"$_OUT_SEP"
#                                                 ^^^^^^^^^^^ was [[:space:]]+

(-X|--method)(${_OUT_SEP}|=)${_GH_API_M}     # was ([[:space:]]+|=)

re="gh${_OUT_SEP}pr${_OUT_SEP}($1)([^;&|]|&[0-9-])*"   # was [^;&|]*
```

`&[0-9-]` is the precise admission: bash takes an fd only when a digit or `-` follows the
`&`, which `&&` and `& ` never do — so a flag belonging to the *next* command still cannot
be pulled into this clause. Pin that with its own control (`gh api repos/o/r && curl -X
DELETE …` must stay ALLOW).

All of these are deny-shaped — every consumer's only outcome is `deny` — so the widening
is monotone and cannot convert a DENY into an ALLOW. The `awk` reader is **grant-shaped**
and was deliberately left for its own change, with paired over-granting controls.

## Prevention

**A rationale for excluding a site is a claim about behaviour, and claims get measured.**
"Not this fix's job" is a scope statement; it is not evidence the excluded site is safe.
When a sweep skips a slot, the skip needs a row — DENY or ALLOW, whichever is correct —
or the comment becomes the reason nobody ever looks again. A written justification is more
dangerous than silence, because it answers the question a reviewer was about to ask.

**Enumerate readers by what they READ, not by how they are spelled.** Grepping for the
constant finds only sites already converted. Ask instead: *what else in this file decides
something from two adjacent tokens?* — and include the non-regex ones. Here a regex sweep
could never have reached the `awk` comparison.

**When a widening closes some spellings of a bypass, enumerate the rest before claiming it
closed.** The separator fix closed 3 of 5 `gh api` spellings. Counting which of the
constructed rows actually flipped — rather than confirming the fix "worked" — is what
surfaced the clause-cut truncation underneath.

**Reuse a row set across sibling functions instead of assuming they differ.** Running the
`gh api` rows against `gh_pr_clause_has_repo` found the identical defect there. It survived
because `gh pr merge` denies anyway when `--auto` is absent — so the obvious probe target
masks it, and only `gh pr comment` / `gh pr create` expose it.

## Related

- [A union over renderings does not cover selection within one](union-over-renderings-does-not-cover-selection-within-one-2026-09-07.md)
  — same file, same review round: there the axis nobody named was *which clause*, here it
  is *which reader*.
- [Command-position anchor missed brace/backtick/bang boundaries](cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md)
  — the interior-redirect work whose uniform sweep this residual sat just outside.
- [A property proven of ONE form is not a property of its syntax CLASS](one-form-property-asserted-of-whole-syntax-class-2026-09-06.md)
  — the same overclaim one level down.
