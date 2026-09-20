---
title: Adding a member to a mirrored allow/deny set invalidates every sibling "the one" / "every OTHER" exclusivity claim in the same file
track: knowledge
category: conventions
module: shared
tags: [harness, prose-drift, allowlist, denylist, code-review, comments]
applies_to: ["scripts/*.sh", "scripts/__tests__/*.test.ts"]
created: '2026-09-20'
---

# Adding a member to a mirrored allow/deny set invalidates every sibling "the one" / "every OTHER" exclusivity claim in the same file

## Rule

When adding a new alternative to a regex constant (or any hand-maintained set) that already
has a companion prose comment describing its members by CARDINALITY or EXCLUSIVITY — "the
one whole-directory entry that is X", "every OTHER path keeps Y", "the two exact-path
entries" — grep that file for the same cardinality words (`the one`, `every other`, a
specific count) before writing the new member, not just for the constant's own name. The
new member makes those sentences false the instant it lands, even though the constant they
describe is now correct.

## Why

`scripts/todo-automerge-guard.sh` had three prose sites making an exclusivity claim about
`docs/rules/` being held structurally: a header enumeration, a SAFE_ALLOWLIST comment
("except docs/rules/, which..."), and a SENSITIVE_OVERRIDE comment ("docs/rules/ is **the
one** whole-directory entry that is NOT code... Every **OTHER** docs path... keeps the
exemption"). Adding `docs/legacy-patterns/` as a second such entry (todos/archive/
P3-2026-09-16-legacy-patterns-still-takes-the-automerge-markdown-exemption.md) required
widening only the two REGEX CONSTANTS to make the guard behave correctly — the change
compiled, the tests passed, and a self-review of "did I update the constants" would have
looked complete. A dispatched `code-reviewer` caught one of the three (the SENSITIVE_OVERRIDE
comment's "the one... Every OTHER" sentence) as a WARNING: `grep -rn 'legacy-patterns'
docs/rules/*.md` returns zero hits, so the claim that `docs/legacy-patterns/` is covered
"for the same reason" `docs/rules/` cites — i.e. that `docs/rules/` files reference it — was
never true and the sentence asserted a citation relationship the tree does not have.

The pattern generalizes beyond this file: any hand-written comment that describes a set by
its cardinality ("the one", "the two", "every other", "all N") is a claim that must be
re-verified — not just re-read — every time a sibling addition changes the set's actual
size. A grep for the CONSTANT's name finds every place that constant is used; it does not
find prose that describes the constant's cardinality without repeating its name in the
same sentence.

## Examples

- Bad: widen `STRUCTURAL_SENSITIVE`/`SENSITIVE_OVERRIDE` by adding
  `(^|/)docs/legacy-patterns/`, leave the SENSITIVE_OVERRIDE comment's "docs/rules/ is the
  one whole-directory entry that is NOT code" and "Every OTHER docs path... keeps the
  exemption" sentences untouched. Both are now false: there are two non-code
  whole-directory entries, and "every other" no longer includes `docs/legacy-patterns/`.
- Good: before writing the new alternative, `grep -n "the one\|every other\|docs/rules"
  <file>` (or the equivalent cardinality words for the set being widened) and update every
  hit whose truth depends on the set's size — not just the constant assignment itself.
- Good: when a companion test file also carries a "these N are new to CONSTANT in this
  diff" comment (as `scripts/__tests__/todo-automerge-guard.test.ts` did, for a PRIOR
  widening), add the new member's test as its OWN block/comment referencing the new diff,
  rather than silently extending the old array and leaving the old comment's count stale.

## Exceptions

- A prose site that describes a MEMBER's rationale ("X is covered because it holds Y") does
  not need updating when a sibling is added — only sentences whose truth depends on the
  set's cardinality or completeness.
- If the constant has no companion cardinality prose at all, there is nothing to sweep.

## Related Files

- `scripts/todo-automerge-guard.sh` — the three prose sites (header enumeration,
  SAFE_ALLOWLIST comment, SENSITIVE_OVERRIDE comment) swept when `docs/legacy-patterns/`
  was added as the second non-code whole-directory entry
- `scripts/__tests__/todo-automerge-guard.test.ts` — the skip-gate consumer test's own
  "these four are new to SENSITIVE_OVERRIDE in this diff" comment, which was NOT rewritten
  when a fifth row was added — a new, separate `it` with its own comment was used instead to
  avoid making that count stale too

## See Also

- [Before widening what auto-files by severity, trace every gate that already reads that
  same field](trace-downstream-gates-before-widening-a-shared-priority-field-2026-08-28.md)
  — sibling discipline for the same class of change (widening a shared field/set): trace
  every CONSUMER before touching it; this file's rule is the trace over every PROSE
  DESCRIPTION of the set instead.
- [A correction inherits the whole cited region](../code-quality/a-correction-inherits-the-whole-cited-region-2026-09-13.md)
  — related stale-prose family: a fix to one claim doesn't imply the region around it is
  still accurate either.
