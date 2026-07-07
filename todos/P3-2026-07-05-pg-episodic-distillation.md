<!-- Filename: P3-2026-07-05-pg-episodic-distillation.md -->

---

title: "PG Lab (spec-first): episodic transcript distillation experiment vs /codify"
status: blocked
priority: low
created: 2026-07-05
updated: 2026-07-07
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

- [ ] Brainstorm session covering: distillation model (local Ollama vs API call — cost/privacy/quality tradeoff, cheap-worker rules DON'T apply since this is explicitly harness-side, but health-data redaction from the transcript importer DOES); distillation prompt + typed-memory schema; cadence (cron vs manual `--distill`); the comparison protocol (e.g. 2 weeks of sessions → distilled candidates vs actually-codified solutions from the same period, categorized: caught-by-both / automation-only / codify-only / noise).
- [ ] Spec written to `docs/superpowers/specs/` and passed through `/spec-review`.
- [ ] Success/kill criteria predefined in the spec: e.g. automation-only useful findings ≥ X per week justifies keeping the cron; below that, archive with the measured verdict — this experiment is explicitly allowed to conclude "not worth it."
- [ ] Decision recorded after the experiment window.

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
