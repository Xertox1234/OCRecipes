---
title: Maestro flow execution order is non-deterministic by design — never let an E2E comment or flow assume a position
track: knowledge
category: conventions
tags: [testing, maestro, e2e, ci]
module: shared
applies_to: ["e2e/**"]
created: 2026-09-13
---

# Maestro flow execution order is non-deterministic by design — never let an E2E comment or flow assume a position

## Rule

Never write (or leave standing) a comment, flow, or design note that assumes
a specific flow's position relative to another — "first", "runs before X",
"leaks into every later flow" — unless `e2e/config.yaml` declares an
`executionOrder`/`flowsOrder` block that actually pins it. Absent that
config, Maestro's own documented default governs: **flow execution order is
non-deterministic**, by design ("intentional because testing Flows in
isolation ensures they are robust and not dependent on side effects from
previous tests" — docs.maestro.dev/maestro-flows/workspace-management/sequential-execution).
`e2e/config.yaml` in this repo sets no `executionOrder`/`flowsOrder`, so
nothing here overrides that default — order is not alphabetical by directory,
not alphabetical by filename, and not stable across CI runs.

If a flow's correctness genuinely depends on running before or after
another, that dependency must be declared explicitly via `executionOrder`/
`flowsOrder` in `e2e/config.yaml` — never assumed from directory layout,
tag order, or a `runFlow` call graph.

## Why

The same false premise ("auth/login is always the first flow in path
order") was written into `e2e/helpers/launch-app.yaml`, half-corrected by a
later, unrelated PR without ever citing the real mechanism, and independently
re-appeared as "leaks into every later flow in path order (plan/, scan/)" in
`e2e/flows/onboarding/complete-onboarding.yaml` — three separate false or
under-cited claims from one misconception. A single measured CI run
(`33826146222`) falsifies both concrete claims at once: `auth/login` ran 4th
of 9 (not 1st), and `onboarding` ran 9th — LAST — after both `plan/` and
`scan/` had already run (the opposite of "into every later flow").

Any code (or comment) that assumes a specific successor/predecessor is
inherently flaky under Maestro's model, even when it happens to pass on a
given CI run — the next run can reorder everything. Design for that
directly: make cleanup/state-reset unconditional (not "because a specific
flow runs after this one"), and make recovery gates (like a wizard-strand
escape) reachable from every entry point regardless of what ran immediately
before.

## Smell patterns

- A comment naming a flow as "first", "last", or "before/after \<other
  flow\>" without a matching `executionOrder`/`flowsOrder` block in
  `e2e/config.yaml`.
- A cleanup step justified by "so the *next* flow doesn't inherit this
  state" when the actual concern is "so *whichever* flow runs next doesn't
  inherit this state" — the former reads as an ordering guarantee that does
  not exist.
- Citing a single CI run's flow order as if it were a property of the suite,
  rather than one non-deterministic sample.

## Related Files

- `e2e/config.yaml` — the workspace config; absence of `executionOrder`/
  `flowsOrder` here is what makes the default non-deterministic ordering
  apply.
- `e2e/helpers/launch-app.yaml` — the corrected readiness-gate comment,
  citing the mechanism and framing the single-run "measured 4th" as a
  sample, not a property.
- `e2e/flows/onboarding/complete-onboarding.yaml` — the corrected
  end-of-flow cleanup comment ("leaks into whatever flow runs next").

## See Also

- [a-retracted-claim-survives-in-every-artifact-you-did-not-grep](../code-quality/a-retracted-claim-survives-in-every-artifact-you-did-not-grep-2026-09-03.md) — the sibling failure mode: a half-correction that leaves a stale reference (here, a comment pointing at a todo's pre-archive path) for the next mover to trip on.
