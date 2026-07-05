<!-- Filename: P3-2026-07-03-inject-patterns-defer-before-build.md -->

---

title: "inject-patterns: pre-estimate domain size to skip building payloads that will defer (~145ms/first-touch edit)"
status: done
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

## Resolution (2026-07-03) — IMPLEMENTED

Implemented the conservative pre-estimate skip. A `[RULES — <domain>]`-only lower-bound size
check runs BEFORE `solutions_from_markdown`: when a domain's rules alone already exceed
`DOMAIN_BUDGET`, it is certain to defer regardless of solution refs, so the ~50-70ms corpus
sweep is skipped and the domain defers with a rules-only spill payload.

- **AC1** — met. First-touch multi-domain edits skip `solutions_from_markdown` for
  certain-to-defer domains. Because rules-only is a strict lower bound on the full payload,
  the estimate NEVER mis-defers a domain the exact check would have kept inline (verified by
  code review). `security` (rank 10, emitted first, `EMITTED_FULL=0`) is never pre-estimated
  away, so the first-fit ordering risk does not materialize.
- **AC2** — the recoverability removal is an explicit, documented decision. Pre-estimate-
  deferred domains ship rules-only to the spill; their solution refs auto-inject in full on
  the session's next edit ("rules now, solution refs next edit"). The `itest-defer` api test
  was reframed accordingly, and a wide-margin `server/storage`/`database` test proves the
  sweep is skipped. Documented in the priority-order-context-injection solution's Exceptions.
- **AC3** — `bash .claude/hooks/test-inject-patterns.sh` green (52/52).
- **AC4** — measured before/after (N=40 first-touch runs, dedup ON):
  - `client/components` (4 domains): ~348ms → ~201ms/run (~146ms, 42% faster)
  - `server/routes` (3 domains): ~284ms → ~145ms/run (~139ms, 49% faster)
  - `server/storage` (3 domains): ~333ms → ~170ms/run (~163ms, 49% faster)
