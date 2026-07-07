<!-- Filename: P3-2026-06-27-broader-test-quality-non-mutation.md -->

---

title: "Broader test-quality: property-based, contract/integration, and E2E coverage"
status: blocked
priority: low
created: 2026-06-27
updated: 2026-07-07
assignee:
labels: [deferred, testing]
github_issue:

---

# Broader test-quality: property-based, contract/integration, and E2E coverage

## Summary

The non-mutation test-quality gaps surfaced while expanding mutation scope (#468/#471).
Split out of the mutation backlog (`P3-2026-06-27-mutation-and-test-quality-backlog.md`) so
these distinct workstreams are tracked on their own rather than buried under mutation work.

## Background

The suite is strong on unit coverage (~5,500+ Vitest tests) and now has mutation-score
enforcement on a handful of pure modules. But three test _kinds_ are thin or missing — each
a separate initiative, none a quick auto-mergeable todo:

1. **Property-based testing** — no `fast-check` (or similar) anywhere. The pure numeric logic
   is the ideal candidate: nutrition macro/calorie math, the chat-history token estimator,
   the notebook budget truncation. Example-based tests pin specific inputs; property tests
   would catch boundary classes example tests miss (and complement the mutation gates).
2. **API contract / integration tests** — route tests `vi.mock("../../storage")` and
   `vi.mock("../../middleware/auth")`, so they prove handler logic but NOT the real
   request → middleware → storage → DB path. There is no real-DB integration coverage of the
   HTTP layer (the [[project-auth-recurring-breakage]] wiring-seam gap is the symptom).
3. **Expanded E2E** — `e2e-smoke.yml` (Maestro) is `workflow_dispatch`-only smoke, not a
   regression suite. Critical flows (login → onboarding → scan → log; coach chat; meal plan)
   have no automated end-to-end coverage gating merges.

## Acceptance Criteria

(Each item is a candidate to break into its own focused todo when actually scheduled — this
is a tracking umbrella, not a single unit of work.)

- [ ] **Property-based:** add `fast-check`; write property tests for ≥1 pure numeric module
      (start with nutrition math or the token estimator); decide whether to gate in CI.
- [ ] **Contract/integration:** stand up a real-DB HTTP integration harness (supertest +
      test DB, reusing `test/db-test-utils.ts`) for ≥1 critical route group; assert the real
      auth + storage path, not mocks.
- [ ] **E2E:** promote Maestro from `workflow_dispatch` smoke to a scheduled or PR-gated
      regression run covering the top critical flows.

## Implementation Notes

- These are **large, deliberate initiatives**, not `/todo`-automatable units — expect each to
  need its own design + PR (and human review). Treat this file as the backlog index.
- Property-based fits the same pure modules already under mutation testing — coordinate so
  the two signals reinforce (mutation finds untested branches; properties find untested input
  classes). See `docs/solutions/conventions/mutation-target-and-break-threshold-selection-2026-06-27.md`.
- Integration tests reintroduce a real DB dependency (the mutation/unit suites are DB-free by
  design) — keep them in a separate, clearly-labelled suite so they don't slow the fast gate.
- Cross-platform: E2E must consider iOS and Android (Maestro supports both).

## Dependencies

- None hard. Integration tests depend on the existing `test/db-test-utils.ts` test-DB setup.

## Risks

- Scope creep — each of the three is a multi-PR effort; don't treat this as one todo.
- Integration/E2E are slower + flakier than unit tests; gate them separately from the fast
  `preflight` path so they don't erode trust in the required checks.

## See Also

- `todos/P3-2026-06-27-mutation-and-test-quality-backlog.md` — the mutation-side backlog
  (onboarding candidates + Hard-Exclusion coverage + mutation features).

## Updates

### 2026-06-27

- Initial creation. Split out of the mutation backlog todo so the non-mutation test-quality
  workstreams are tracked independently.

### 2026-07-07

- Marked `blocked` by the `/todo` orchestrator (P3-only run). This file is explicitly a
  tracking umbrella, not a single automatable unit — self-declared above: "expect each to
  need its own design + PR (and human review)." Dispatching a `todo-executor` against it as-is
  risks it either failing or attempting all three initiatives in one oversized PR. Unblock by
  splitting each Acceptance Criteria bullet into its own focused todo with concrete file paths
  when actually scheduled, then set this umbrella to `done` (or archive it) once split.
