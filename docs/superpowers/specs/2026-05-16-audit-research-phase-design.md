# Design: Add a Research Phase to the Audit Skill

> **Date:** 2026-05-16
> **Topic:** Audit skill — documentation research phase
> **Status:** Approved, pending implementation plan

## Problem

The `/audit` skill (`.claude/skills/audit/SKILL.md`) runs an 8-phase, full-session
code audit. Its specialist agents and fix logic operate on the orchestrator's
training knowledge, which lags real-world documentation by months (training
cutoff January 2026; audits are run later). This produces two failure modes:

1. **Stale false positives in Discovery** — a specialist agent flags a pattern as
   wrong, or an API as deprecated, when current docs say otherwise. This wastes
   triage attention.
2. **Stale knowledge gaps** — a current-doc best practice is never flagged because
   no agent knows it exists.

The project provides a `context7` MCP server for up-to-date library documentation,
but the audit skill has no phase that uses it, so it sits effectively unused.

## Root Cause of "context7 is never used"

Two compounding causes:

- **No trigger.** The skill never tells the orchestrator _when_ or _what_ to look
  up, so it defaults to training knowledge. A research phase placed _before_
  Discovery would have nothing to anchor on and would fetch docs for the entire
  stack speculatively — token-expensive and unfocused.
- **Dead tool name.** `.claude/agents/docs-researcher.md` instructs itself to call
  `mcp__plugin_compound-engineering_context7__query-docs`, which does not exist in
  this environment. The context7 MCP is namespaced `plugin:context7:context7`, so
  the real tools are `mcp__plugin_context7_context7__query-docs` and
  `mcp__plugin_context7_context7__resolve-library-id`. The agent has been pointed
  at a tool it cannot reach.

## Solution Overview

Insert a targeted research phase **after Discovery, before triage**, anchored on
the concrete findings table. Dispatch `docs-researcher` subagents (one per audit
domain) that validate each finding against current documentation and return a
compact per-finding verdict. The user then triages with research verdicts visible
in the manifest.

Three files change:

- `.claude/agents/docs-researcher.md`
- `.claude/skills/audit/SKILL.md`
- `docs/audits/TEMPLATE.md`

## Deliverable 0 — Fix the dead context7 tool name (prerequisite)

In `.claude/agents/docs-researcher.md`, rename both references:

- `mcp__plugin_compound-engineering_context7__query-docs`
  → `mcp__plugin_context7_context7__query-docs`
- Add / correct the sibling reference to
  `mcp__plugin_context7_context7__resolve-library-id`

Without this, Phase 2.5 dispatches agents that physically cannot reach context7.
This must ship as part of the change, not as a follow-up.

## Deliverable 1 — New "Phase 2.5: Research" in `SKILL.md`

Inserted as **Phase 2.5** — a half-number, with **no renumbering** of existing
phases. The skill has many internal `Phase N` cross-references; renumbering is
churn without benefit.

Placement and ordering:

- Phase 2 (Discovery) keeps its discovery / dedup / current-code verification
  steps. Its current **step 5** — "show the user the complete findings table and
  ask which findings to fix and which to defer" — is **removed from Phase 2** and
  becomes the **final step of Phase 2.5**. The user triages with research verdicts
  already attached to the manifest.
- **Executor:** one `docs-researcher` subagent per audit domain, dispatched in
  parallel, mirroring Phase 2's batching:
  - `full` / `pre-launch` — batch the domains the same way Phase 2 batches its
    specialist agents.
  - Named scope — one `docs-researcher` for that domain.
- **Skip rule:** a domain with zero findings gets no researcher.

## Deliverable 2 — The Phase 2.5 dispatch prompt

The prompt handed to each `docs-researcher` must **mandate** doc retrieval, not
merely permit it. A dispatched subagent shares the orchestrator's training cutoff;
a permissive prompt lets it silently fall back to training knowledge, hiding the
staleness problem behind the agent boundary instead of solving it.

Prompt requirements:

- For each finding in the assigned domain, the agent **MUST** call
  `mcp__plugin_context7_context7__query-docs` to check current documentation.
  **A verdict with no doc citation is invalid.**
- Each finding receives exactly one verdict:
  - **`confirmed`** — current docs agree the finding is valid. Stays `open`,
    annotated.
  - **`better-fix`** — finding is real, but current docs show a cleaner or
    different fix than the discovering agent assumed. Stays `open`; the
    doc-informed approach is attached so Phase 3 uses it.
  - **`contradicted`** — current docs say the flagged pattern is fine, or the
    "deprecated" API is not deprecated. Stays `open`, flagged
    `⚠ docs contradict`. **Not** auto-marked `false-positive` — the audit reserves
    `false-positive` for verified agent errors, and a researcher verdict is one
    more agent opinion. The user decides at the triage gate.
  - **`not-applicable`** — the finding does not hinge on external library or
    framework behavior (e.g. IDOR, missing `userId` check, N+1 query, dead code).
    Skipped; no doc call. This filter lives **in the prompt** so researchers do
    not pad verdicts or waste context7 calls.
- **Opportunistic new findings:** if, while validating, a researcher sees a
  current-doc best practice clearly unmet in code **it already viewed**, it may
  surface a new finding. That finding is **not** trusted on the researcher's word —
  it routes through **Phase 2's existing current-code verification** (read the
  file at the reported line, grep for the pattern) before being written to the
  manifest as `open`. This captures the staleness _gap_ without turning a
  validation pass into an unverified second discovery pass.

## Deliverable 3 — Manifest changes in `docs/audits/TEMPLATE.md`

- Add a **`Research`** column to all four findings tables
  (Critical / High / Medium / Low). New column order:
  `ID | Finding | Domain | Agent | File(s) | Research | Status | Verification`.
  Values: `confirmed`, `better-fix`, `contradicted ⚠`, or `—` (research not
  applicable, or pre-research baseline).
- One-line correction while editing this file: the section heading
  `## Codification (Phase 7)` is stale — `SKILL.md` calls codification Phase 8.
  Correct the heading to match.

## Out of Scope

- No full doc-driven discovery pass (a parallel doc-focused audit channel was
  considered and rejected — it doubles Phase 2's cost with a weaker tool).
- No changes to Phases 3–8 logic beyond Phase 3 consuming the `better-fix`
  annotation when applying a fix.
- No renumbering of existing phases.

## Acceptance Criteria

- [ ] `docs-researcher.md` references only the real context7 tool names.
- [ ] `SKILL.md` contains a "Phase 2.5: Research" section between Phase 2 and
      Phase 3.
- [ ] The Phase 2 triage step is moved to the end of Phase 2.5.
- [ ] Phase 2.5 specifies one `docs-researcher` per domain, parallel, with the
      same batching as Phase 2 and a skip rule for zero-finding domains.
- [ ] The dispatch prompt mandates a context7 call per finding and rejects
      uncited verdicts.
- [ ] The four verdicts (`confirmed`, `better-fix`, `contradicted`,
      `not-applicable`) and their manifest effects are documented.
- [ ] Opportunistic new findings are explicitly routed through Phase 2's
      current-code verification.
- [ ] `TEMPLATE.md` has a `Research` column in all four findings tables and the
      `Phase 7` → `Phase 8` heading fix.
