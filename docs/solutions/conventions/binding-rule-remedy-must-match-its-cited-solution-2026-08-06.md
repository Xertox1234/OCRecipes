---
title: A binding rule must prescribe its source solution's ACTUAL remedy — a compressed one is often the bug
track: knowledge
category: conventions
module: shared
tags: [docs-rules, codify, harness, tooling, agents, knowledge-base, silent-failure]
applies_to: [docs/rules/**/*.md, docs/rules/*.md, docs/solutions/**/*.md, .claude/agents/**, .claude/skills/**]
symptoms: [A rules bullet compresses a multi-step remedy into one imperative clause, A rule names a real defect but the prescribed fix does not actually detect or prevent it, Following the rule literally reproduces the bug the cited solution exists to prevent]
created: '2026-08-06'
---

# A binding rule must prescribe its source solution's ACTUAL remedy — a compressed one is often the bug

## Rule

`docs/rules/*.md` is injected whole before every edit in its domain, so a wrong bullet there is
worse than no bullet: it is authoritative, it arrives unprompted, and it displaces the reader's
own judgement. When compressing a `docs/solutions/` finding into a rules bullet, **carry the
solution's actual remedy across, not a plausible-sounding shorthand** — then re-read the source and
confirm that following your bullet literally would have prevented the original defect.

If the real remedy will not survive compression, keep the bullet short and cite the file, rather
than inventing a shorter fix that does not work.

## Smell patterns

- A bullet that names a subtle failure mode and ends in a terse imperative like "check `$?`",
  "just use X", "guard it" — verbs that sound like diligence without specifying a mechanism.
- A rules bullet whose remedy is shorter than the "## Solution" section it derives from, with no
  pointer back to it.
- Any rule written from memory of a solution rather than from the solution's text.

## Why

Found in review of `docs/rules/harness.md` before it merged. The bullet read:

> `$(...)` unsets `errexit` — `var=$(fn)` swallows failures inside `fn`. **Check `$?` explicitly.**

Its cited source
(`logic-errors/command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md`) explains
why that remedy cannot work: errexit is unset inside the substitution subshell, so `fn` runs to
completion and returns its **last** command's status. `$?` therefore reports that final status and
says nothing about an earlier statement inside `fn` that failed — and in
`read ... <<<"$(fn)"` no status is checked at all. The solution's real remedy is structural: call
the function **bare** so errexit stays live, return results via a file, and guard only the failures
you intend to tolerate.

An author following the compressed bullet would have added a `$?` check, seen it pass, and shipped
exactly the silent-failure bug the solution was written to prevent — with more confidence than if
the rule had said nothing. The compression inverted the rule's value.

## Examples

```markdown
<!-- WRONG — names the defect, prescribes a remedy that cannot detect it -->
- `$(...)` unsets `errexit` — `var=$(fn)` swallows failures inside `fn`. Check `$?` explicitly.

<!-- RIGHT — the solution's actual remedy, with the reason the obvious one fails -->
- `$(...)` unsets `errexit`, so only `fn`'s FINAL status can propagate — checking `$?` does not
  recover an earlier statement's failure inside `fn`. For must-not-fail side effects call the
  function BARE and return results via a file; guard only intentionally-tolerated failures.
```

## Exceptions

A rules bullet may legitimately be narrower than its source (covering the common case and citing
the file for the rest). What it may not be is **wrong** — narrower is fine, differently-shaped is
not. The test is behavioural: would someone who follows only this bullet avoid the defect?

## Related Files

- `docs/rules/harness.md` — where this was caught pre-merge
- `docs/solutions/logic-errors/command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md`

## See Also

- [tags and applies_to are a two-part routing precondition](tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — the other way rules and solutions drift apart
