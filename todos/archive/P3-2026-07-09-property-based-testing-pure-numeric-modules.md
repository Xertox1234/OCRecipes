<!-- Filename: P3-2026-07-09-property-based-testing-pure-numeric-modules.md -->

---

title: "Add property-based testing (fast-check) for one pure numeric module"
status: done
priority: low
created: 2026-07-09
updated: 2026-07-12
assignee:
labels: [deferred, testing, property-based]
github_issue:

---

# Add property-based testing (fast-check) for one pure numeric module

## Summary

No `fast-check` (or similar) property-based testing exists anywhere in the suite. Add it and
write property tests for exactly one pure numeric module to catch boundary classes that
example-based tests miss.

## Background

Split out of `P3-2026-06-27-broader-test-quality-non-mutation.md` (archived) so this initiative
can be scheduled independently. The suite is strong on example-based unit coverage (~5,500+
Vitest tests) and has mutation-score enforcement on a handful of pure modules, but pins specific
inputs rather than input _classes_. Property tests complement the mutation gates: mutation finds
untested branches, properties find untested input classes.

Candidate modules (pick one — do not attempt all in the same PR):

- `server/lib/chat-history-truncate.ts` — token estimator + truncation logic.
- `server/services/notebook-budget.ts` — notebook budget truncation.
- `client/screens/meal-plan/meal-plan-utils.ts` and/or `server/services/cooking-session.ts` —
  contain calorie/macro calculation functions (verify which one is the better candidate before
  committing — this file only lists them as leads, not a final choice).

## Acceptance Criteria

- [x] Add `fast-check` as a dev dependency.
- [x] Choose ONE pure numeric module from the candidates above (or another pure numeric module
      found to be a better fit) and write property tests for it.
- [x] Decide whether property tests run in the fast `preflight` gate or a separate slower suite,
      and document the decision in this file's Implementation Notes or the PR description.
- [x] Existing test suite continues to pass unchanged.

## Implementation Notes

- Coordinate with the existing mutation-testing setup so the two signals reinforce each other —
  see `docs/solutions/conventions/mutation-target-and-break-threshold-selection-2026-06-27.md`.
- This is a design + implementation task, not a mechanical split — expect to spend time picking
  the right module and the right properties (e.g. idempotence, boundary invariants,
  round-tripping) before writing tests.

### Decisions (2026-07-12 implementation)

- **Module chosen: `server/lib/chat-history-truncate.ts`** — fully pure and dependency-free,
  richest numeric invariants of the candidates (Unicode-class token estimator + 4-phase budget
  truncation), and already a Stryker mutation target, so both quality signals now cover the
  same module. `cooking-session.ts` was eliminated (async, calls OpenAI + nutrition lookup);
  `meal-plan-utils.ts` is pure but thin (properties would be near-tautological).
- **Run location: the normal Vitest suite** (co-located
  `server/lib/__tests__/chat-history-truncate.property.test.ts`, discovered by the standard
  `**/*.test.ts` glob) — runs in the push-time fast gate via `vitest related` when the module
  changes, and in full CI always. At a pinned 100 runs per property over pure functions the
  file costs tens of milliseconds, so a separate slower suite is unjustified complexity.
- **Mutation coordination: property file deliberately NOT added to the target's `testInclude`
  in `stryker.targets.mjs`.** The registry intentionally scopes each mutation run to the
  dedicated example unit test to measure that test's trustworthiness in isolation; folding
  100-run properties into the mutant loop would multiply per-mutant runtime on a module whose
  timeout classification is already nondeterministic (see the target's `breakThreshold`
  comment). The signals stay complementary: mutation finds untested branches, properties find
  untested input classes.
- **fast-check seed is pinned** (`seed: 20260712`): `vitest.config.ts` sets `retry: 2`; an
  unseeded property that found a real counterexample would re-run with a fresh seed on retry
  and could pass, masking a genuine bug as a flake. Verified during implementation: a
  deliberately-wrong invariant failed identically on all 3 attempts with the pinned seed.

## Dependencies

- None hard.

## Risks

- Scope creep — stick to one module. The other candidate modules become their own follow-up
  todos if this one goes well.

## See Also

- `todos/archive/P3-2026-06-27-broader-test-quality-non-mutation.md` — the umbrella this was
  split from.

## Updates

### 2026-07-12

- Implemented: `fast-check@4.9.0` added as dev dependency; 12 property tests written for
  `server/lib/chat-history-truncate.ts` in
  `server/lib/__tests__/chat-history-truncate.property.test.ts` (5 estimator properties:
  totality, ASCII/CJK/supplementary-plane exactness, concatenation bounds; 7 truncation
  properties: subsequence, under-budget identity, protected-message preservation,
  budget-or-protected-only, idempotence, no input mutation, tier-order pruning).
- Decisions documented in Implementation Notes → "Decisions (2026-07-12 implementation)".

### 2026-07-09

- Split from the `P3-2026-06-27-broader-test-quality-non-mutation.md` umbrella at user request,
  scoped to the property-based-testing acceptance criterion only.
