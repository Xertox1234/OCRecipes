<!-- Filename: P3-2026-07-05-pg-episodic-distillation.md -->

---

title: "PG Lab (spec-first): episodic transcript distillation experiment vs /codify"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-10
assignee:
labels: [deferred, harness, spec-first]
github_issue:

---

# PG Lab (spec-first): episodic transcript distillation experiment vs /codify

## Summary

Design (spec first) a bounded experiment: periodically distill imported session transcripts with a local LLM into typed candidate memories (behavior/preference/pattern), and benchmark the output against the manual `/codify` workflow — does automation surface knowledge the curated flow misses, or mostly noise it already filters? This is R3 of the 2026-07-04 research report and its open question #4.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. The daringanitch/claude-memory exemplar proved the pipeline shape (30-min cron import + Ollama qwen2.5:7b distillation into typed memories) but shipped it with prompt-driven recall and zero evidence of value. This todo runs the pipeline as an _experiment with a measured verdict_ — candidates land in a review queue, never directly into `MEMORY.md` or `docs/solutions/` (curation stays human+Claude, markdown stays canonical).

## Acceptance Criteria (for the SPEC phase)

- [x] Brainstorm session covering: distillation model (local Ollama vs API call — cost/privacy/quality tradeoff, cheap-worker rules DON'T apply since this is explicitly harness-side, but health-data redaction from the transcript importer DOES); distillation prompt + typed-memory schema; cadence (cron vs manual `--distill`); the comparison protocol (e.g. 2 weeks of sessions → distilled candidates vs actually-codified solutions from the same period, categorized: caught-by-both / automation-only / codify-only / noise).
- [x] Spec written to `docs/superpowers/specs/` and passed through `/spec-review` (2026-07-09, revise → all required changes applied same session).
- [x] Success/kill criteria predefined in the spec: keep iff automation-only ≥ 4 over the 2-week window; early-kill tripwires = cost cap / gate drop-rate / parse-failure rate.
- [x] Decision recorded after the experiment window (2026-07-10, see Updates — VERDICT: KEEP).

## Implementation Notes

- Do NOT implement from this todo; deliverable is the reviewed spec, then the experiment in a dedicated session.
- Candidates table: `harness.memory_candidates(ts, session_id, type, content, status[pending/accepted/rejected], reviewer_note)` — the accept path writes markdown via the existing /codify or memory-file conventions, keeping one canonical store.
- Prior art: daringanitch's distill_sessions.py + behavioral_pass.py prompt structure (read for shape, don't port wholesale).

## Dependencies

- `P3-2026-07-05-pg-transcript-fts.md` MERGED (provides the imported, redacted transcript corpus).

## Risks

- Distillation noise drowning the review queue — the predefined kill criteria exist precisely so this fails fast and cheap.
- Token/compute spend on a cron — keep it local-model-first; any API-model variant needs an explicit cost ceiling in the spec.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Phase D, spec-first).

### 2026-07-07

- Marked `blocked` by the `/todo` orchestrator (P3-only run). This todo's own Acceptance
  Criteria requires a `superpowers:brainstorming` session — inherently interactive, exploring
  the user's intent on model choice, prompt/schema design, and cadence. An autonomous
  `todo-executor` cannot supply those decisions; dispatching one risks a fabricated spec
  document opened as a PR without genuine design input. Unblock by running the brainstorming
  session directly with the user in a dedicated interactive session, then write and
  `/spec-review` the resulting spec per this todo's Acceptance Criteria.

### 2026-07-10 — VERDICT: KEEP (experiment complete)

- Spec + plan 2026-07-09 (interactive brainstorm → /spec-review "revise" → fixes applied);
  pipeline implemented + merged (PR #564); live-run fixes in PR #566 (csv field limit,
  volume-guard assembly-prefix false positive, --review re-prompt on stray input).
- Window 2026-06-25 → 2026-07-08: 88 sessions — 77 sent / 11 gated (12.5%) / 0 parse
  failures; spend $0.71 of the $5 cap (1.58M in / 201K out tokens, over-estimate pricing).
  No kill tripwire fired.
- Four buckets (254 candidates, fully human-reviewed): **automation-only 251** (threshold
  ≥ 4 met ~60×) / caught-by-both 0 / noise 3 / **codify-only 74** (zero overlap — automation
  and /codify surface disjoint knowledge).
- Caveat recorded in the spec verdict: the accept bar was inclusive (98.8%), so accepts mean
  "plausibly useful"; the manual write-into-canonical-stores step is the real filter and now
  holds a 251-item backlog. Productionization follow-up filed:
  `todos/P3-2026-07-10-distill-productionization.md`. Full verdict + honest read: spec
  (`docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md`, local-only).
