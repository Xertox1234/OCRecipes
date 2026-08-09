<!-- Filename: P3-2026-07-05-pg-lab-foundation-codify-near-dup.md -->

---

title: "PG Lab foundation: create ocrecipes_lab DB + pg_trgm near-dup advisory at /codify time"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab foundation: create ocrecipes_lab DB + pg_trgm near-dup advisory at /codify time

## Summary

Bootstrap the `ocrecipes_lab` local Postgres database (the shared home for all PG Lab items) and ship its first consumer: a pg_trgm near-duplicate advisory for `/codify`, restoring the 0.88-cosine near-dup check deliberately dropped in PR #491 — this time with zero embedding spend and a rebuildable index.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md` (design rails §1-4 are binding for ALL PG Lab todos). PR #491's todo explicitly listed "losing the 0.88-cosine near-dup advisory at codify time" as the one accepted regression, mitigated by a title grep. With 573+ solution files and growing, a trigram-similarity check over titles+summaries is a strictly better advisory. Foundation (DB create, conventions, helper) is folded in here so infra ships with a consumer, not speculatively.

## Acceptance Criteria

- [x] `scripts/pg-lab/init.sh`: creates `ocrecipes_lab` DB if absent, `CREATE EXTENSION IF NOT EXISTS pg_trgm`, creates schemas `harness`, `repo`, `dev`. Idempotent. Respects `LAB_DATABASE_URL` (default `postgresql://localhost/ocrecipes_lab`).
- [x] `scripts/pg-lab/schema/codify-neardup.sql`: `harness.solution_titles(path, title, summary, tags, created)` — a derived projection of `docs/solutions/` frontmatter.
- [x] `scripts/pg-lab/codify-neardup.sh --rebuild`: truncates and repopulates the projection from the markdown corpus (one-way derivation; no parity checking).
- [x] `scripts/pg-lab/codify-neardup.sh "<candidate title>"`: prints top-5 `similarity()` matches above a threshold (start 0.45, tune) with paths; exit 0 always.
- [x] `/codify` skill (`.claude/skills/codify/SKILL.md`) near-dup step invokes the script when `ocrecipes_lab` is reachable, silently falls back to the existing title grep when not (fail-silent rail).
- [x] Value probe: the script appends one line per invocation (timestamp, candidate, top-score) to `harness.codify_neardup_log` so a later query shows whether the advisory ever fires above threshold. Prune date: if zero useful hits by 2026-10-01, revert the skill edit.
- [x] Tests: shellcheck-clean; a fixture-driven test proving --rebuild + query round-trip on a temp corpus dir (pattern: RECENT_SOLUTIONS_DIR test seam from session-recent-issues.sh).

## Implementation Notes

- Files in scope: `scripts/pg-lab/init.sh`, `scripts/pg-lab/schema/codify-neardup.sql`, `scripts/pg-lab/codify-neardup.sh`, `.claude/skills/codify/SKILL.md`, test file under `scripts/pg-lab/` or `.claude/hooks/` test conventions.
- Frontmatter parsing: reuse the awk approach from `session-recent-issues.sh` (title/created unwrap, single-line inline-flow tags).
- psql is on PATH (see reference_dev_db_access memory). Use `psql -X -q -v ON_ERROR_STOP=1`.
- Conventions established here (schema-file-per-item, LAB_DATABASE_URL, fail-silent, --rebuild flag) are the template every subsequent PG Lab todo copies.

## Dependencies

- None. **All other PG Lab todos depend on this one MERGING first** (cross-dep merge gate).

## Risks

- Touches `.claude/skills/` → automerge guard will HOLD for individual review (expected).
- Trigram threshold needs tuning against real corpus; start conservative, log scores (value probe doubles as tuning data).

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch A).
- Implemented: `scripts/pg-lab/init.sh`, `scripts/pg-lab/schema/codify-neardup.sql`,
  `scripts/pg-lab/codify-neardup.sh` (--rebuild + query modes), `.claude/skills/codify/SKILL.md`
  Step 6b wired to try the advisory first, and `.claude/hooks/test-pg-lab-codify-neardup.sh`.
  Two review rounds (code-reviewer + server-reviewer): fixed a trailing-slash path-corruption
  bug in the awk frontmatter extractor, and a value-probe logging gap (a reachable-but-empty
  table now logs `top_score = NULL` so "never rebuilt" is distinguishable from "genuinely
  zero hits" for the 2026-10-01 prune-date decision), plus a TOCTOU-race swallow in
  `init.sh` and wording/comment cleanups. Verified live against a local Postgres 18 (real
  579-file corpus round-trip + fixture-driven test, all passing); no CRITICAL findings.

### 2026-08-09 — READ BEFORE THE 2026-10-01 PRUNE DECISION (PR #790)

- The projection was **stale for this probe's entire measurement window**. `--rebuild` was
  never invoked after 2026-07-09 (nothing in the repo called it), so all 112 logged
  invocations — the first landing 2026-07-10 — searched 615 rows against a 768-doc corpus.
  The `top_score = NULL` sentinel added above did not catch this: it fires only on a table
  with **zero** rows, and a partially-stale table logs a normal score.
- The prune criterion is **not currently met**. There is **1 genuine hit** (2026-07-21,
  score 0.472) and it produced the prescribed outcome — the matched doc was extended, not
  duplicated (commit `1b50f0f0`).
- Staleness was **not** the cause of the low hit rate, so do not treat this as a reason to
  re-measure before deciding. A time-correct replay of all 112 queries returns the same 1
  hit, and a corpus-wide census finds only 10 near-dup pairs in the whole corpus, all from
  the May/June bulk-import era, none involving the 153 docs the stale projection could not
  see.
- **Freshness from 2026-08-09 is better but NOT guaranteed.** `/codify` Step 7 refreshes the
  projection only from the **primary checkout**: worktree codifies (`/todo`, `/todo-fast`,
  `/audit`) skip it by design — a rebuild there would repopulate the shared projection from
  that branch's corpus and drop every sibling worktree's just-committed doc — and
  `todo-executor.md` Step 9 has its own codify commit path that never reaches Step 7. Before
  drawing a conclusion from the log, check the projection against the corpus:
  `SELECT count(*), max(created) FROM harness.solution_titles;` vs
  `find docs/solutions -type f -name '*.md' ! -path '*/_manifests/*' ! -name 'README.md' | wc -l`.
- Full analysis: `docs/solutions/logic-errors/freshness-guard-as-emptiness-check-passes-when-partially-stale-2026-08-09.md`
  and `docs/solutions/conventions/replay-eval-ground-truth-mutated-by-the-feature-under-test-2026-08-09.md`.
