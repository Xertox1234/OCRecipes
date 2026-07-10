<!-- Filename: P3-2026-07-10-distill-productionization.md -->

---

title: "PG Lab: productionize episodic distillation (noise reduction first, then cadence)"
status: backlog
priority: low
created: 2026-07-10
updated: 2026-07-10
assignee:
labels: [deferred, harness, pg-lab]
github_issue:

---

# PG Lab: productionize episodic distillation (noise reduction first, then cadence)

## Summary

The episodic-distillation experiment concluded **KEEP** (2026-07-10): automation-only
candidates cleared the ≥ 4 threshold ~60× over at $0.71 total spend, and surfaced knowledge
fully disjoint from what `/codify` captured in the same window. Productionize it — but
volume control comes before any cron.

## Background

Experiment record: `docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md`
(VERDICT section) and `todos/archive/P3-2026-07-05-pg-episodic-distillation.md`.
Pipeline: `scripts/pg-lab/distill.sh` (+ `distill-gate.py`), merged in PR #564 with fixes
in PR #566. Key learnings to design against:

- The distiller produced ~3.3 candidates/sent-session (254 from 77) despite the
  "empty array is the expected common case" prompt stance — noise control by prompt alone
  did not hold.
- The reviewer's accept bar was inclusive (98.8% accepted); the hand-codification step is
  the real filter, and a 251-item accepted backlog now exists (see AC below).
- Near-dup assist flagged 16/254 but zero against window-period files — cross-pipeline
  duplication was not the problem; volume was.
- Gate held: 12.5% drop, all classes exercised, zero parse failures.

## Acceptance Criteria

- [ ] Triage the 251 accepted candidates from the experiment into canonical stores
      (memory files / `docs/solutions/` via existing conventions) or explicit discard —
      then drop the three `harness.memory_candidates`/`distill_runs`/`distilled_sessions`
      tables per the experiment-scoped rail.
- [ ] Candidate-volume control designed and implemented: some combination of a stricter
      prompt (fewer, higher-bar candidates), a hard per-session candidate cap, and/or
      pre-ranking so review sees the best N first. Target: ≤ 1 candidate/session average
      on a comparable window.
- [ ] Review UX: `--review` gains a progress indicator (`#k of N`) so an interrupted
      session is visible (the silent-early-quit incident of 2026-07-10 motivates this).
- [ ] Cadence decision AFTER volume control proves out: manual `--window` per fortnight vs
      cron/LaunchAgent; cron requires its own spend ceiling and a notification path.

## Implementation Notes

- Do not weaken the health gate for throughput — any gate change re-runs the fixture suite
  (`.claude/hooks/test-pg-lab-distill.sh`, the anti-loosening rail).
- Cost cap machinery ($5 default, over-estimate pricing, ledger in `distill_runs`) carries
  over unchanged; a cron variant needs a per-period cap, not just cumulative.
- Recall/injection of distilled knowledge into sessions stays out of scope until the
  triage AC shows the accepted content is actually being used.

## Dependencies

- PR #566 merged (csv field limit + gate false-positive + review re-prompt fixes).

## Risks

- The 251-item triage is itself a big manual job — if it stalls, that is evidence the
  accept bar needs to move into the pipeline (stricter prompt/cap), which is exactly what
  the volume-control AC exists to fix.

## Updates

### 2026-07-10

- Filed per the experiment's Keep criterion (spec: "file a follow-up todo for
  productionizing — possible cron, review-queue UX").
