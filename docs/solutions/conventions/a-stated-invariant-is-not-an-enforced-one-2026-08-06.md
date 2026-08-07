---
title: A stated invariant is not an enforced one
track: knowledge
category: conventions
module: shared
tags: [invariants, code-review, comments, typescript, architecture, client-state]
applies_to: [server/services/**/*.ts, client/lib/**/*.ts, .claude/agents/*.md, .claude/hooks/**/*.sh]
symptoms: [A docblock names several cases while the conditional beside it handles one, A comment asserts two values are "the same source/kind/shape" with no code establishing it, A cost or safety argument whose premise is a property of the current data shape rather than of the code]
created: '2026-08-06'
---

# A stated invariant is not an enforced one

## Rule

When a comment, docblock, or agent rule asserts that **N** values share a property,
either **enforce** that property structurally or expect it to be false. A rule naming
N cases needs a **table of N rows**, not a conditional for one.

The test is mechanical: could the assertion become false without anything failing? If
yes, it is a wish, not an invariant. Replace the prose with the structure that makes
the compiler (or a loop over a table) responsible for it.

## Smell patterns

- **A docblock naming several cases beside a conditional handling one.** "`saturated`/`trans ≤ fat`, `sugars ≤ carbs`" written above an `if (saturatedFat > fat)`.
- **"X and Y are the same source / shape / kind" with no code establishing it.** The sentence is doing load-bearing work — it is the reason a check was skipped — and nothing anywhere makes it true.
- **A cost or safety argument whose premise is a property of the current data shape.** "A false positive here is harmless" is a claim about what the *other* end of the pipeline currently accepts, not about this function. It expires silently when that end is widened.
- **Two counters, sets, or flags written on the same line "so they stay in sync".** Co-location is not a constraint; the next edit that has a reason to move one will move one.

## Why

A comment is checked by a human at write time and never again. A table, a type, a
`satisfies` clause, or a loop over an enumerated list is checked by the compiler or the
runtime **on every change**. The two are not different strengths of the same thing —
only one of them is a mechanism.

The important part is that this is **not merely documentation drifting over time**.
Instance 1 below had the rule and its implementation authored *in the same commit*, by
the same author, in the same sitting — and they still diverged, because **stating a
general principle and implementing one instance of it are separate cognitive acts**.
Writing "for each value now retained, is it in a containment relationship" puts you in
the frame of enumerating pairs; writing `if (merged.saturatedFat > merged.fat)` puts
you in the frame of fixing the bug in front of you. Nothing about doing the first makes
you do the second. So "the comment was accurate when written" is not a defence, and a
freshly-written assertion deserves the same scepticism as a five-year-old one.

## Examples

### 1. Same-commit divergence — the rule and its violation shipped together

One commit in PR #764 (landed as `bcd026f8`) added two things. To
`.claude/agents/ai-reviewer.md`:

> The general check for any "blank less" / "keep more" change: for each value now
> retained, is it in a CONTAINMENT relationship (`saturated`/`trans ≤ fat`,
> `sugars ≤ carbs`) with a value the label just replaced?

And, in the same commit, `retainableSiblings()` in `server/services/label-override.ts`,
which checked **only** `saturatedFat > fat`.

`sugars ≤ carbs` was reachable and reproduced: a database record carrying
`sugar: 24, carbs: 25` per 100 g, against a label read at a 30 g serving, merged to
`sugar 29` beside `carbs 25` — and `perServing` `8.7` beside `7.5`. With
`compared: true`, that opened one-tap logging on a macro block that is internally
impossible, on the screen whose entire proposition is "trust the label".

The fix — a later commit in the same PR, and what `bcd026f8` carries as the net result —
replaced the conditional with a `CONTAINMENT_PAIRS` table and an `enforceContainment()`
loop over it, so the rule's N and the code's N are now the same number by construction,
and a new pair cannot be added without answering the table's questions for both sides.

> `retainableSiblings` exists at no branch tip **and in no tree on `main`**: it was
> introduced and then replaced inside PR #764's own history, and the squash collapsed it
> away entirely — `git log -S retainableSiblings` on `main` finds nothing. What survives
> on `main` is `bcd026f8`'s commit **message**, which preserves both original messages
> (including "The rule and the implementation diverged inside a single commit") and is
> therefore the on-`main` evidence for the same-commit claim above; `git log --grep`
> finds it. The pre-squash commits themselves stay fetchable via
> `git fetch origin refs/pull/764/head`. Cite the PR and the squash SHA — never the
> symbol name, and never a branch commit a squash can strand (see
> [cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md](cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md)).

### 2. "One self-consistent source" — an assertion nothing established

The same function's comment justified skipping the containment check whenever the label
supplied *both* sides of a pair: "the label read both, so it is one self-consistent
source."

False. `totalFat` and `saturatedFat` are **independent per-line captures**. An ordinary
US panel reading `Total Fat 5g 6%` / `Saturated Fat 2g 9%`, with the `g` → `9` misread
that this parser calls its single largest cause of dropped fields, yields
`saturatedFat: 29` against `totalFat: 5` — both label-sourced, both "one source", and
96.7 vs 16.7 g/100 g at a 30 g serving.

"Same source" was true of the *provenance tag* and false of the *reading*. No code
anywhere made the two lines agree, and nothing would have failed if they didn't.

### 3. A cost analysis that expired

`cmd_gh_pr_write_subcommand` in `.claude/hooks/lib/cmd-detect.sh` is deliberately
unanchored — it matches *mentions*, not invocations — justified by: "this feeds a
NON-blocking verifier, so a false positive costs a redundant `gh pr view`, never a gate
bypass."

That was true **while the ref it pairs with could only be a number or a branch name**:
the redundant lookup was local. Widening `cmd_gh_pr_ref` to accept URLs silently
invalidated the premise without touching the matcher or its comment. A URL sitting in a
**shell comment** —

```bash
npm run x  # gh pr merge https://evil.example/o/r/pull/1
```

— was enough to make the hook issue a network request to an attacker-named host. The
premise was never a property of `cmd_gh_pr_write_subcommand`; it was a property of a
function two definitions away.

The comment is now explicit that the claim is conditional and names the guard
(`pr-verify.sh`'s host restriction) that keeps it true — which is the minimum when the
enforcing structure has to live somewhere else.

### 4. "The value was read directly" — two questions, one answer

PR #764's provenance work pushed to `directReads` on **the same line** that incremented
`extracted`, with a docblock stating the two were "exactly the set that incremented
`extracted` … one notion of 'we actually read this', not two", and a call-site comment
reading "The VALUE was read directly, so it is adopted."

False for a substituted-unit match. `"Saturated Fat 29 9%"` (the `g` → `9` misread) is
adopted **and** marked direct — so a 14.5× inflated reading was published as evidence
strong enough to condemn a correct database record at a tolerance sized for a 0.5 g
printing step.

The two counters answer different questions — *"did we get a number?"* (which gates a
local preview) versus *"can we vouch for it?"* (which gates overriding stored data) —
and writing them on one line made the second inherit the first's answer. A test had
pinned them as **equal**, on the strength of that shared line; that equality *was* the
mechanism of the bug, so the fix re-specified it as containment
(`directReads.length <= extracted`) and denied provenance to substituted-unit reads.

Co-location is the weakest possible enforcement: it survives exactly until someone has a
reason to move one of the two.

## Exceptions

- **A comment explaining WHY is not the target.** "We poll here because the native
  callback fires before layout" asserts nothing the code depends on being true — it
  supplies context a reader cannot recover. Keep those; the repo's comment-hygiene bar
  asks for more of them.
- **The target is a comment asserting a FACT the code relies on** — a shared property, a
  set equality, a cost bound, a closed enumeration. Those either become structure or
  become wrong.
- **When the enforcing structure genuinely cannot live at the site** (instance 3: the
  guard is in the consumer), the comment must name the guard and say the claim is
  conditional on it. A conditional claim that says which condition is a pointer; one
  that doesn't is a trap.

## Related Files

- `server/services/label-override.ts` — `CONTAINMENT_PAIRS`, `enforceContainment()`
- `client/lib/nutrition-ocr-parser.ts` — `directReads` vs `extracted`, `substitutedUnit`
- `.claude/hooks/lib/cmd-detect.sh` — `cmd_gh_pr_write_subcommand`, `cmd_gh_pr_ref`
- `.claude/agents/ai-reviewer.md` — the containment rule from instance 1

## See Also

- [relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md](relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — the consumer-side half: prefer shapes that fail loudly (a required field, an exhaustive `switch`) over ones that fail silently
- [cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md](cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md) — how to cite code whose name did not survive the PR
- [warn-deny-helper-embedded-exit-defeats-fallthrough-reasoning-2026-07-26.md](warn-deny-helper-embedded-exit-defeats-fallthrough-reasoning-2026-07-26.md) — the same repo's precedent for "verify the control flow empirically, don't read it off the call site"
- [../logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md](../logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md) — verifying a claim means checking the predicate, not that the symbol exists
- [../logic-errors/widened-extractor-unwidened-consumer-fails-confidently-2026-08-06.md](../logic-errors/widened-extractor-unwidened-consumer-fails-confidently-2026-08-06.md) — instance 3's other half, written up as a bug
