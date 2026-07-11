<!-- Filename: P3-2026-07-05-pg-injection-ranking-layer.md -->

---

title: "PG Lab (spec-first): injection ranking layer — time decay + git-aware boosts + budget"
status: blocked
priority: low
created: 2026-07-05
updated: 2026-07-11
assignee:
labels: [deferred, harness, spec-first]
github_issue:

---

# PG Lab (spec-first): injection ranking layer — time decay + git-aware boosts + budget

## Summary

Design (spec first, then implement in a dedicated session) a relevance-ranking layer for pattern injection: exponential time decay on solution age, git-aware boosts from recent-commit keywords, quality/dedup scoring, and an explicit per-injection budget with phased allocation — replacing "all tag matches, unranked" with "best N under budget." This is R2 of the 2026-07-04 research report, the highest-value item identified.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`; evidence and the doobidoo scoring model (decay weight 0.5, +0.3 project/+0.2 language tag bonuses, 1.2× git multiplier, 8-14 item budget with 4-phase allocation) are detailed in `docs/research/2026-07-04-postgres-memory-for-claude-code.md` §3/§5. This touches the hottest hook path and changes what context the model sees on every edit — wrong ranking is worse than no ranking. Hence spec-first, NOT /todo-batch material.

## Acceptance Criteria (for the SPEC phase — implementation gets its own criteria in the spec)

- [ ] Brainstorm session run (superpowers:brainstorming) covering: scoring formula and weights; where ranking lives (pure-bash over markdown vs Postgres derived index — decide with data from the corpus size and the usage-telemetry todo's findings); budget size and allocation phases; interaction with the existing over-budget deferral logic (PR #492/#504); rollout (shadow-mode scoring that only logs vs immediate).
- [ ] Spec written to `docs/superpowers/specs/` and passed through `/spec-review`.
- [ ] Spec explicitly defines an evaluation: N recorded real injection events replayed under old vs new selection, human-judged relevance on the diff (no vibes-based "seems better").
- [ ] Decision recorded: proceed / simplify / drop — with reasons.

## Implementation Notes

- Do NOT start implementation from this todo. The deliverable here is the reviewed spec; implementation follows in a dedicated session with its own plan.
- Prior art to read first: doobidoo memory-scorer.js values (in the research report), `inject-patterns.sh` current selection + deferral logic, and the usage-telemetry report (dependency below) for real firing-frequency data.
- Shadow mode is the strongly suggested default rollout: compute scores, log what WOULD change, ship the behavior flip only after the log looks right.

## Dependencies

- `P3-2026-07-05-pg-injection-usage-telemetry.md` MERGED and ~30 days of data (the ranking design should be informed by real delivery stats, not guesses).
- `P3-2026-07-05-pg-git-history-mining.md` helpful (git-aware boost source) but not blocking.

## Risks

- Ranking changes model-visible context on every edit — regressions are subtle and diffuse. Shadow mode + replay eval is the mitigation.
- Weight cargo-culting from doobidoo (their weights, their corpus) — treat as starting points to tune against replay data, not truths.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Phase D, spec-first).

### 2026-07-07

- Marked `blocked` by the `/todo` orchestrator (P3-only run), for two independent reasons:
  (1) this todo's own Acceptance Criteria requires an interactive `superpowers:brainstorming`
  session covering scoring formula, ranking location, and rollout — decisions only the user
  can make, not something an autonomous `todo-executor` should fabricate; (2) its Dependencies
  section requires "~30 days of data" from `pg-injection-usage-telemetry.md`, which merged only
  2 days before this triage — the temporal gate cannot be satisfied yet regardless of the spec
  question. Unblock once ~30 days of usage-telemetry data exists AND a human-led brainstorming
  session is run.

### 2026-07-11

- Telemetry gate checked (user-led, decision **WAIT**): 6 of ~30 days accumulated
  (2026-07-06 → 2026-07-11; 583 rows, 29 sessions, 11/14 domains; 494 pointer / 74 injected /
  15 deferred; 70 of ~620 solution docs ever delivered). Sample is workload-biased (daily rows
  368→1 as the week shifted to harness work), dead-weight stats and the replay-eval corpus need
  the full window.
- **Do NOT flip this todo to `backlog` before 2026-08-05.** At re-check, re-run the volume
  queries against `harness.injection_log` in `ocrecipes_lab` (row count / first-last day,
  action mix, deferral-by-domain, distinct docs delivered), then unblock only for a human-led
  brainstorming session per the Acceptance Criteria — never for autonomous execution.
