<!-- Filename: P3-2026-07-04-widen-itest-defer-api-margin.md -->

---

title: "Widen the fragile ~174B itest-defer api-test budget margin in test-inject-patterns.sh"
status: backlog
priority: low
created: 2026-07-04
updated: 2026-07-04
assignee:
labels: [deferred, harness, test-fragility]
github_issue:

---

# Widen the fragile ~174B itest-defer api-test budget margin

## Summary

The `itest-defer` api test in `.claude/hooks/test-inject-patterns.sh` asserts that the `api`
domain defers, but it only clears the deferral threshold by ~174 bytes (api pre-estimate
`tmp=7724 + block=1050 = 8774` vs `DOMAIN_BUDGET 8600`). Any future edit near `api.md`,
`security.md`, or the injection preamble could silently flip that test's defer/inline branch
without an obvious cause. Widen the margin so the assertion is robust.

## Background

Surfaced twice, independently, during the 2026-07-03 `/todo` run:

- The PR #504 executor (inject-patterns pre-estimate defer-before-build) noted it as an
  informational, pre-existing fragility it deliberately did not touch (scope discipline — its
  own new test uses a wide-margin `database`/server-storage case at ~5498B of headroom).
- The independent pre-merge reviewer of PR #504 confirmed the margin is genuinely pre-existing
  (not introduced by #504 — no `docs/rules/*.md` content or `DOMAIN_BUDGET` constant changed in
  that diff) and recommended a low-priority follow-up to widen it.

The failure mode is a **silent** branch flip: if a rules-file trim drops the api payload below
`DOMAIN_BUDGET`, `itest-defer` would exercise the inline path instead of the defer path while
still (possibly) passing or failing for the wrong reason — a misleading signal on a hook that
gates every Edit/Write.

## Acceptance Criteria

- [ ] The `itest-defer` api-domain test in `.claude/hooks/test-inject-patterns.sh` no longer
      depends on a sub-~200B margin — either switch it to a domain/fixture with comfortable
      headroom (as the `database` case already does) or make the assertion tolerant of small
      `DOMAIN_BUDGET`-relative shifts, whichever keeps the test's INTENT (verifying the defer
      path) intact.
- [ ] The test still fails if the defer logic regresses (i.e. it is not weakened into a no-op).
- [ ] `bash .claude/hooks/test-inject-patterns.sh` green.
- [ ] `npm run preflight` green.

## Implementation Notes

- Files in scope: `.claude/hooks/test-inject-patterns.sh` (the `itest-defer` case), and
  possibly its fixture setup. Do NOT change `.claude/hooks/inject-patterns.sh` behavior or the
  `DOMAIN_BUDGET` / `THRESHOLD` constants — this is a test-robustness fix, not a behavior change.
- Reference the wide-margin pattern the `database` test added in PR #504 (~5498B over budget)
  as the model for comfortable headroom.
- Measured margin at filing: api pre-estimate `8774` vs `DOMAIN_BUDGET 8600` ≈ 174B.
- Executor note: touches `.claude/hooks/` → `todo-automerge-guard.sh` will HOLD the PR for
  individual review (expected).

## Dependencies

- None blocking. Independent of PR #504 (the fragile test pre-dates it on `main`). If #504 has
  merged by the time this is picked up, the wide-margin `database` test it adds will already be
  present as a reference.

## Risks

- Low. Test-only robustness change. The only real risk is weakening the assertion into
  something that no longer catches a defer-logic regression — the second acceptance criterion
  guards against that.

## Updates

### 2026-07-04

- Initial creation. Filed from the 2026-07-03 `/todo` run's pre-merge review of PR #504
  (inject-patterns pre-estimate defer-before-build), flagged by both the executor and the
  independent reviewer as a pre-existing, unworsened fragility worth a low-priority follow-up.
