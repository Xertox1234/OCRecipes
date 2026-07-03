<!-- Filename: P3-2026-07-03-inject-patterns-defer-before-build.md -->

---

title: "inject-patterns: pre-estimate domain size to skip building payloads that will defer (~145ms/first-touch edit)"
status: backlog
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, harness, performance]
github_issue:

---

# inject-patterns: pre-estimate domain size to skip building payloads that will defer

## Summary

A domain that ends up deferred still builds its full payload first — including
`solutions_from_markdown`'s `grep -rl` sweep over the ~580-file docs/solutions corpus plus
per-file applies_to/title greps (~48-67ms per domain). Measured: ~145ms of built-then-used-
only-for-spill work on a 4-domain first-touch edit, roughly half the hook's ~300ms runtime,
re-paid on every catch-up edit until the domain lands inline. From the PR #492 review
(efficiency finding, verdict PLAUSIBLE).

## Background

The verifier measured (PR #492 review): 4-domain first-touch ≈ 308ms/run; one
`solutions_from_markdown` build ≈ 48-67ms (the corpus `grep -rl` is ~11ms; the ~16 per-file
greps dominate); the three deferred domains' staged payloads ≈ 145ms/run. Since PR #492's
follow-up, the staged BLOCKFILE is no longer fully discarded — it is written to the spill
file via DEFER_FILE — so the work buys recoverability, softening the original finding.

A cheap pre-estimate exists: `wc -c "$RULES_FILE"` (fstat) + a solution-ref upper bound
(`SOLUTIONS_PER_DOMAIN × ~150B`). Caveat the verifier flagged: solution refs genuinely
straddle the DOMAIN_BUDGET boundary, so an estimate can mis-defer a domain whose exact size
would have fit (or vice versa). The mis-defer failure mode is benign (pointer + spill
payload... but note the spill payload would then need building anyway — decide whether
deferred domains keep their spill-file payload, which negates most of the saving, or drop
it and accept pointer-only deferral for estimated defers).

## Acceptance Criteria

- [ ] First-touch multi-domain edits skip `solutions_from_markdown` for domains that a
      conservative pre-estimate marks as certain to defer — OR the todo is closed as
      won't-fix with a measurement showing the saving no longer justifies the complexity
- [ ] Deferred-payload recoverability (the `deferred payload recoverable from the spill
    file now` test) either still holds or its removal is an explicit, documented decision
- [ ] `bash .claude/hooks/test-inject-patterns.sh` green
- [ ] Measured before/after timings recorded in the PR description

## Implementation Notes

Files in scope: `.claude/hooks/inject-patterns.sh`, `.claude/hooks/test-inject-patterns.sh`.
This is a latency micro-optimization on a hook that gates every Edit/Write; if the
recoverability-vs-speed tradeoff turns out awkward, closing as won't-fix is a legitimate
outcome — the current behavior is correct, just not maximally cheap.

## Risks

- Estimate-based deferral changes which domains land inline for borderline sizes;
  first-fit ordering must stay rank-based so security never regresses.
