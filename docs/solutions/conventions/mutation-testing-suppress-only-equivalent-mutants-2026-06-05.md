---
title: Mutation testing — suppress only genuinely-equivalent mutants; remove dead code
track: knowledge
category: conventions
module: server
tags: [mutation-testing, stryker, testing, test-quality, dead-code, integrity]
created: '2026-06-05'
---

# Mutation testing — suppress only genuinely-equivalent mutants; remove dead code

## Rule

When a mutant survives, classify it before acting:

1. **Killable (a real behavior change)** → write a real-SUT assertion that fails
   against the mutant. This is the default and the whole point.
2. **Genuinely equivalent (no input distinguishes mutant from original)** → suppress
   with `// Stryker disable next-line <mutator>: <reason>` stating *why* it's
   equivalent.
3. **On a dead-code line (the original branch is unreachable)** → **remove the dead
   code**, do not suppress it.

Never suppress a killable mutant to reach 100%. A score of "100% because the code is
clean / the tests assert" is real; "100% because we disabled the reporter on a line
that has killable variants" is a tautology in disguise — exactly the failure mutation
testing exists to catch.

## Smell patterns

- A `// Stryker disable next-line` whose reason is vague ("not important", "edge
  case") rather than a concrete equivalence argument.
- Disabling a whole mutator (`ConditionalExpression`) on a line that ALSO has
  killable variants — Stryker's `disable next-line` is per-mutator-per-line, not
  per-mutant-variant, so it silently masks the killable ones. If those killable
  variants are only "killed-anyway" by a test that later gets deleted, the
  regression is hidden.
- A high covered-score but a much lower total-score (e.g. covered 84% / total 49%):
  a whole exported function is uncovered. Tight unit-test scoping surfaces this;
  whole-suite coverage hides it (other suites exercise the function incidentally).

## Why

- **Equivalent mutants are real and unavoidable** (e.g. an early-return optimization
  `if (a === b) return true` whose removal still yields the same result via the
  downstream branch for all finite inputs). Suppress these with the equivalence
  argument — that's honest.
- **Dead code is a finding, not something to suppress.** Mutation testing flags dead
  branches because their mutants are uncoverable-yet-mutable. Removing the dead line
  is behavior-preserving, eliminates the mutants without a suppression, and improves
  the code. Example from `verification-consensus.ts`: `if (a === 0 && b === 0)
  return true;` was only reached when `a !== b`, where `a===0 && b===0` is
  impossible (the prior `if (a === b)` already handles 0/0) — removed, not
  suppressed.
- **Boundary mutants need boundary inputs.** Tests that look thorough often miss the
  exact tie. `valuesMatch` had a `<= 0.05` boundary that survived because tests used
  100/105 (4.76%), never the exact 5%. `valuesMatch(100, 95)` (exactly 5%) kills it —
  and also kills `Math.max`→`Math.min` (at the boundary, dividing by min=95 gives
  0.0526 > 0.05). Pin `===`/`<`/`<=` boundaries with inputs that land *on* them.

## Exceptions

- A killable-but-practically-impossible mutant (e.g. distinguishable only by
  `Infinity` inputs that the domain never produces) may be suppressed as
  "equivalent for finite/real inputs" — but say so explicitly in the reason.

## Related Files

- `server/lib/verification-consensus.ts` (one equivalence suppression: `if (a === b)`)
- `server/lib/__tests__/verification-consensus.test.ts` (boundary + computeConsensus tests)
- `docs/mutation-testing/baselines.md` (before/after scores)

## See Also

- [Stryker + Vitest 4 harness](../best-practices/stryker-vitest4-mutation-testing-harness-2026-06-05.md) — how to run the harness and its config gotchas
