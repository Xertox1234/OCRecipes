<!-- Filename: P3-2026-07-10-distill-productionization.md -->

---

title: "PG Lab: productionize episodic distillation (noise reduction first, then cadence)"
status: done
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

- [x] Triage the 251 accepted candidates from the experiment into canonical stores
      (memory files / `docs/solutions/` via existing conventions) or explicit discard —
      then drop the three `harness.memory_candidates`/`distill_runs`/`distilled_sessions`
      tables per the experiment-scoped rail. _(Done 2026-07-10 — see Updates.)_
- [x] Recreate the session bookmark before any future run: `harness.distilled_sessions`
      (the at-most-once send guarantee) was dropped with the experiment tables on
      2026-07-10, so a fresh run currently has NO memory of what was sent and would
      re-send (and re-bill) the entire window. Recreate the table — or an equivalent
      durable bookmark — as part of the production schema, and make `distill.sh` fail
      loudly if it is absent rather than silently re-sending. _(Done 2026-07-12 — see
      Updates.)_
- [x] Candidate-volume control designed and implemented: some combination of a stricter
      prompt (fewer, higher-bar candidates), a hard per-session candidate cap, and/or
      pre-ranking so review sees the best N first. Target: ≤ 1 candidate/session average
      on a comparable window. Triage evidence (2026-07-10): ~9% survival vs canon and
      near-zero near-dup catch rate on 118 conceptual duplicates — include a canon-aware
      semantic dedup pass, not just a stricter generation prompt. _(Done 2026-07-12 — see
      Updates; efficacy caveat noted there.)_
- [x] Review UX: `--review` gains a progress indicator (`#k of N`) so an interrupted
      session is visible (the silent-early-quit incident of 2026-07-10 motivates this).
      _(Done 2026-07-12 — see Updates.)_
- [ ] Cadence decision AFTER volume control proves out: manual `--window` per fortnight vs
      cron/LaunchAgent; cron requires its own spend ceiling and a notification path.
      _(Deliberately deferred — see Updates; this AC's own wording gates it on volume
      control proving out first, which needs a live run's worth of evidence this PR does
      not produce.)_

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
- Added the bookmark-recreation AC: dropping the experiment tables also deleted
  `harness.distilled_sessions`, so the idempotent-resume guarantee is gone until
  productionization recreates it.
- **Triage AC complete** (same day). 4 parallel classifier agents checked all 251
  accepted candidates against docs/solutions (615 files), the memory dir, and
  CLAUDE.md/docs/rules. Outcome: 118 already covered, 73 ephemeral, 34 other-project
  (exported as a digest into the plant_id_community checkout), 1 rerouted to
  `P3-2026-07-10-audit-deterministic-scanners.md`, **23 kept** — 9 new memory files,
  8 memory-file appends, 5 new solution docs, 1 solution-doc append (this PR). The
  three `harness.*` experiment tables were then dropped. Net survival rate ~9% —
  hard evidence for the volume-control AC below: the distiller's accept stream is
  ~10× too permissive against canon, and near-dup titles alone caught almost none
  of the 118 conceptual duplicates.

### 2026-07-12

- **Bookmark, volume-control, and review-UX ACs shipped** (this PR — 3rd execution
  attempt, prior two attempts completed research only). Changes:
  - `scripts/pg-lab/schema/memory-candidates.sql`: header rewritten from
    "EXPERIMENT-SCOPED... dropped by hand" to durable production status.
  - `scripts/pg-lab/distill.sh`: new `require_schema()` (checks
    `to_regclass('harness.distilled_sessions')`, exits non-zero naming `--init-schema` if
    absent) replaces the implicit `apply_schema` call in `run_window()`; new `--init-schema`
    CLI mode applies the schema explicitly. `--review`/`--report` unchanged (still
    unconditional `apply_schema`). New `DISTILL_MAX_CANDIDATES_PER_SESSION` (default 1) hard
    caps `send_session`'s insert loop. `DISTILL_PROMPT` rewritten to require the model
    self-rank and return at most 1 candidate, aware of a new canon-context file. New
    `build_canon_context()` projects `harness.solution_titles` (guarded by `to_regclass` so
    it degrades cleanly pre-`codify-neardup.sh --rebuild`) + existing memory-file titles into
    a size-capped (`DISTILL_CANON_CONTEXT_MAX_CHARS`, default 20000) file, sent to
    `$DISTILL_SEND_CMD` as a second path in the SAME `--paths` flag
    (`--paths "$artifact" "$canon"`) — verified empirically that `ask-kimi`'s argparse
    (`nargs="+"`, default `store` action) makes a _repeated_ `--paths` flag silently
    overwrite rather than accumulate, so this corrects that assumption while achieving the
    intended "two distinct files" outcome. `send_session` gained a 4th positional arg
    (canon path) and stays a bare call (file-based result handoff unchanged) per
    `docs/solutions/logic-errors/command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md`.
    `run_review()` threads a `k`/`total` counter (total = `wc -l` on the pending-ids file,
    computed once) into the per-candidate SQL SELECT, rendering `[k of N]` in the header.
  - `.claude/hooks/test-pg-lab-distill.sh`: 4 new assertion groups — schema-missing
    `--window` fails naming `--init-schema`; `--init-schema` succeeds (replacing the old
    direct `psql -f` schema-apply calls) and re-applies idempotently; a 3-candidate stub
    response truncates to 1 inserted row under the default cap (and `distill_runs.candidates`
    reflects the capped count, not the raw 3); the first candidate shown in `--review`
    carries a `[1 of N]` marker. Full suite verified against local Postgres — DB-dependent
    section confirmed to have actually run (no `skip:` line), all assertions `ok:`.
  - **AC3 honesty note** (advisor YELLOW, accepted): the hard cap of 1 makes "≤1/session"
    true by construction and is fully unit-tested. The "canon-aware semantic dedup" half of
    AC3 is implemented as a mechanism (prompt instructions + the canon-context file) but its
    _efficacy_ — whether the live model actually self-filters already-covered knowledge
    against the canon file — is unverifiable against a stubbed send command and rests on
    unproven live behavior. Treat the dedup mechanism as in place, not empirically proven;
    a future live `--window` run's candidate/session ratio and near-dup overlap are the real
    test.
  - **AC5 (cadence) deliberately deferred**, per the AC's own wording ("AFTER volume control
    proves out") — this PR ships the volume-control mechanism but does not yet have a live
    window's worth of evidence that it holds in production. Revisit after the first live
    `--window` run under the new cap + prompt.
- **Code review (code-reviewer) fixes applied** (same PR). `build_canon_context()`'s
  original `ORDER BY path` + byte-truncate was measured against the real 615-row
  `harness.solution_titles` corpus: at the default 20000-char budget it included ONLY
  `best-practices` (100%) and part of `code-quality`, giving `conventions` (210 files, the
  largest category), `design-patterns` (190), and `logic-errors` (113 — exactly the
  "discovered constraints or gotchas" content the distillation prompt targets) **zero**
  representation — a structural gap beyond the AC3 honesty note above, which had attributed
  dedup uncertainty only to unproven live model behavior. Fixed: title-only projection
  (summary dropped) + round-robin stratification (`row_number() OVER (PARTITION BY
split_part(path,'/',1) ORDER BY path)`, then `ORDER BY rn, category`) so truncation
  degrades breadth per category instead of dropping categories outright. Verified against
  the live corpus: all 7 categories now represented within the unchanged 20000-char budget
  (22/22/22/22/22/3/21 rows respectively, vs. 100%/12%/0%/0%/0%/0%/0% before). Also fixed
  two SUGGESTIONs: removed a dead `SCHEMA` var in the hook test (shellcheck SC2034, orphaned
  by the `--init-schema` migration) and added numeric validation on
  `DISTILL_MAX_CANDIDATES_PER_SESSION` (a non-numeric override would have made `[ -ge ]`
  exit 2 inside an `if`, which `set -e` treats as "false" — silently disabling the cap with
  no error). Re-verified: hook test suite all `ok:` (no regressions), full vitest suite
  (413 files / 6145 tests), types, and lint all clean.
