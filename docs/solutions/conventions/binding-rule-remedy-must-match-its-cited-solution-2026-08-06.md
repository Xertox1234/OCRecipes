---
title: A binding rule must prescribe its source solution's ACTUAL remedy — a compressed one is often the bug
track: knowledge
category: conventions
module: shared
tags: [docs-rules, codify, harness, tooling, agents, knowledge-base, silent-failure, code-review]
applies_to: [docs/rules/**/*.md, docs/rules/*.md, docs/solutions/**/*.md, .claude/agents/**, .claude/skills/**]
symptoms: [A rules bullet compresses a multi-step remedy into one imperative clause, A rule names a real defect but the prescribed fix does not actually detect or prevent it, Following the rule literally reproduces the bug the cited solution exists to prevent, A code-review finding correctly identifies a defect but its suggested one-line fix regresses a case that works today]
created: '2026-08-06'
last_updated: '2026-08-10'
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

### Same failure, second surface: a code-review suggestion (2026-08-10)

The rule is not specific to `docs/rules/` authoring — it applies wherever a remedy travels
separately from the evidence that produced it. A `/code-review` pass on PR #794 correctly found
that `parseServingGrams`' `(?:g|ml)` alternation has no word boundary, so it is a unit **prefix**
test: `"1 gallon"` → 1, `"2 glasses"` → 2, `"3 gummies"` → 3 all parse as grams. Real defect,
correctly diagnosed, with measurements.

Its suggested remedy was a one-character patch, `(?:g|ml)\b`. Running the proposed regex against
the same input set the diagnosis used shows why it cannot ship:

| input          | current | with `\b` |
| -------------- | ------- | --------- |
| `"1 gallon"`   | 1       | null ✓    |
| `"3 gummies"`  | 3       | null ✓    |
| `"100 grams"`  | 100     | **null** ✗ |

`g` followed by `r` is not a word boundary either, so the fix trades three false accepts for a
false reject on a legitimate mass string. The correct repair is an explicit unit alternation
pinned by characterisation tests — not a one-character patch.

The generalisation: **a correct diagnosis does not certify its own remedy.** Run the proposed fix
against the same evidence table you used to establish the defect. If the finding measured five
inputs, the fix must be measured against those same five.

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

The same test, applied to a review suggestion: would applying only this fix eliminate the reported
defect **without** regressing an input that works today? A remedy that is merely *directionally*
right still fails it.

## Related Files

- `docs/rules/harness.md` — where this was caught pre-merge
- `docs/solutions/logic-errors/command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md`
- `server/services/barcode-lookup.ts` — `parseServingGrams`, the 2026-08-10 review-remedy case

## See Also

- [tags and applies_to are a two-part routing precondition](tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — the other way rules and solutions drift apart
- [sentinel-with-readers-is-a-contract-not-a-fabricated-default](sentinel-with-readers-is-a-contract-not-a-fabricated-default-2026-08-10.md) — the sibling failure: getting the remedy right but the defect wrong
- [../logic-errors/lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10.md](../logic-errors/lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10.md) — the defect whose remedy is measured above
