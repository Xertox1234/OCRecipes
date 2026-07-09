<!-- Filename: P3-2026-07-09-property-based-testing-pure-numeric-modules.md -->

---

title: "Add property-based testing (fast-check) for one pure numeric module"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
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

- [ ] Add `fast-check` as a dev dependency.
- [ ] Choose ONE pure numeric module from the candidates above (or another pure numeric module
      found to be a better fit) and write property tests for it.
- [ ] Decide whether property tests run in the fast `preflight` gate or a separate slower suite,
      and document the decision in this file's Implementation Notes or the PR description.
- [ ] Existing test suite continues to pass unchanged.

## Implementation Notes

- Coordinate with the existing mutation-testing setup so the two signals reinforce each other —
  see `docs/solutions/conventions/mutation-target-and-break-threshold-selection-2026-06-27.md`.
- This is a design + implementation task, not a mechanical split — expect to spend time picking
  the right module and the right properties (e.g. idempotence, boundary invariants,
  round-tripping) before writing tests.

## Dependencies

- None hard.

## Risks

- Scope creep — stick to one module. The other candidate modules become their own follow-up
  todos if this one goes well.

## See Also

- `todos/archive/P3-2026-06-27-broader-test-quality-non-mutation.md` — the umbrella this was
  split from.

## Updates

### 2026-07-09

- Split from the `P3-2026-06-27-broader-test-quality-non-mutation.md` umbrella at user request,
  scoped to the property-based-testing acceptance criterion only.
