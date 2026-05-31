---
title: "Implement /todo Gate 3 — per-todo advisor pre-check"
status: done
priority: medium
created: 2026-05-30
updated: 2026-05-30
assignee:
labels: [todo-skill, workflow, advisor]
github_issue:
---

# Implement /todo Gate 3 — per-todo advisor pre-check

## Summary

Add a new Step 3.5 in `.claude/agents/todo-executor.md` between Research (Step 3) and Implement (Step 4) that calls the `advisor` tool to validate each todo's approach before code is written. Final piece of the `/todo` hardening spec (`docs/superpowers/specs/2026-05-30-todo-skill-hardening-gates-design.md`).

## Background

The other four hardening gates landed in PRs #279, #280, #281, #282 (all merged to main 2026-05-30):

- Gate 1: LSP warm-up in executor + researcher
- Gate 5: codify durability via `MAIN_CHECKOUT` + sanity checks
- Gate 7: researcher GitHub tool refs renamed to `mcp__github__*`
- Gate 8: Phase 2 todo-quality check

Gate 3 was intentionally deferred per the hardening spec's implementation phasing: "Ship last so the simpler gates are settled and we can observe the advisor signal in isolation."

The gap Gate 3 closes: the executor jumps from Research directly into Implementation. `kimi-review` at Step 6 reviews the **diff**, not the **approach**. If the research brief recommends a flawed approach (subtly wrong API, misread project pattern, stale solution reused), the executor writes code on top of the bad approach and the review catches only diff-level issues — not the architectural mismatch.

Before implementing, **observe**: run `/todo` against the freshly-hardened workflow for at least one cycle. If the existing gates (research brief quality + Step 3a verified-solution read-back + Step 3b domain pattern injection + kimi-review at Step 6) already catch the failure modes Gate 3 targets, the per-todo advisor call may not pull its weight. Re-evaluate the value case before committing the implementation.

## Acceptance Criteria

- [ ] New `## Step 3.5 — Advisor pre-check` section added to `.claude/agents/todo-executor.md` between Step 3 (Research) and Step 4 (Implement).
- [ ] Executor calls the `advisor` tool with exactly this context: todo body (Acceptance Criteria, Implementation Notes, Risks), the research brief (or short-circuit solution citation from Step 3a), the `verified_solutions` note (max 3 entries), and the list of affected source file paths (paths only, **not** file contents).
- [ ] Advisor returns one of three structured outcomes per the spec: `GREEN` (proceed silently), `YELLOW: <reason>` (proceed, record reason in `DEFERRED_WARNINGS` for Phase 5), or `RED: <reason>` (return `blocked: advisor red-flag: <reason>` to orchestrator; do not write code).
- [ ] Failure path documented: if `advisor` tool is unavailable in the subagent's environment, log "advisor unavailable — skipping Step 3.5" and proceed to Step 4. Never block on advisor unavailability.
- [ ] Step 11 success-report format extended: `ADVISOR: <green|yellow|red>` field added so the orchestrator's Phase 5 summary can tally advisor outcomes.
- [ ] Phase 5 in `.claude/skills/todo/SKILL.md` updated to surface advisor outcome tallies alongside existing tallies (Completed/Blocked/Skipped/Failed).
- [ ] Cross-reference comment in the hardening spec design doc updated noting Gate 3 is now landed.

## Implementation Notes

Gate 3 design lives in `docs/superpowers/specs/2026-05-30-todo-skill-hardening-gates-design.md` (gitignored, local-only) under the "Gate 3 — Per-todo advisor pre-check" section. Key design decisions already settled there:

- **Hybrid blocking model.** YELLOW is advisory (proceed + record). RED is blocking (return `blocked` to orchestrator). The three-tier split is deliberate — a flat advisory/blocking gate would either fire too often (annoying) or never (useless).
- **Paths only, no source content.** The advisor reviews the _approach_, not the code. Source-level review remains kimi-review's job at Step 6.
- **Cost.** One advisor call per todo. With 4-parallel batches firing roughly simultaneously, net wall-clock impact is ~10-15s per batch. Token cost is small (brief + acceptance criteria, no source).

Files to edit:

- `.claude/agents/todo-executor.md` — add Step 3.5 between current Steps 3 and 4 (~line 156 area, after Step 3b's pattern injection lookup); update Step 11 success report format to include `ADVISOR:` field.
- `.claude/skills/todo/SKILL.md` — extend Phase 5 tallies block to include advisor outcome counts.

The existing `advisor` tool is documented in CLAUDE.md and is already used elsewhere in the codebase as a synchronous call that takes no parameters (it forwards the agent's transcript automatically). For Step 3.5 the advisor sees the executor's context naturally — no need to construct a synthetic prompt, just call `advisor()` after the research brief is in context.

## Dependencies

- None — independent of any other todo. All other hardening gates (1, 5, 7, 8) are already merged.

## Risks

- **The advisor signal may be noisy on first runs.** Advisor sees less than the executor (brief + paths, no source). If RED fires too aggressively on edge cases, the executor's `blocked` reports clutter the Phase 5 summary. Mitigation: observe a few cycles before deciding whether RED should be advisory-only.
- **YELLOW could be ignored as noise.** Since YELLOW just records and proceeds, executors and reviewers might not act on warnings. Mitigation: Phase 5's `DEFERRED_WARNINGS` already surfaces these for triage — same as kimi-review WARNINGs.
- **The value case may not hold.** If the existing gates (Step 3a read-back, Step 3b pattern injection, kimi-review at Step 6) already catch the failure modes Gate 3 targets, the per-todo advisor call adds cost without unique benefit. The spec's "observe before implementing" guidance exists precisely for this.

## Updates

### 2026-05-30

- Initial creation. Filed as the parked piece of the `/todo` hardening spec after Gates 1, 5, 7, 8 merged.

## Copilot Delegation

**Do not delegate.** This todo modifies a skill workflow agent that controls how other agents are spawned — touching it changes the project's autonomous-execution loop. The hardening spec's design decisions (three-tier outcome contract, paths-only advisor context, hybrid blocking model) require careful human-authored prose, not boilerplate generation. Implement directly when the value case is confirmed.
