<!-- Filename: P3-2026-07-05-pg-lab-foundation-codify-near-dup.md -->

---

title: "PG Lab foundation: create ocrecipes_lab DB + pg_trgm near-dup advisory at /codify time"
status: backlog
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

- [ ] `scripts/pg-lab/init.sh`: creates `ocrecipes_lab` DB if absent, `CREATE EXTENSION IF NOT EXISTS pg_trgm`, creates schemas `harness`, `repo`, `dev`. Idempotent. Respects `LAB_DATABASE_URL` (default `postgresql://localhost/ocrecipes_lab`).
- [ ] `scripts/pg-lab/schema/codify-neardup.sql`: `harness.solution_titles(path, title, summary, tags, created)` — a derived projection of `docs/solutions/` frontmatter.
- [ ] `scripts/pg-lab/codify-neardup.sh --rebuild`: drops and repopulates the projection from the markdown corpus (one-way derivation; no parity checking).
- [ ] `scripts/pg-lab/codify-neardup.sh "<candidate title>"`: prints top-5 `similarity()` matches above a threshold (start 0.45, tune) with paths; exit 0 always.
- [ ] `/codify` skill (`.claude/skills/codify/SKILL.md`) near-dup step invokes the script when `ocrecipes_lab` is reachable, silently falls back to the existing title grep when not (fail-silent rail).
- [ ] Value probe: the script appends one line per invocation (timestamp, candidate, top-score) to `harness.codify_neardup_log` so a later query shows whether the advisory ever fires above threshold. Prune date: if zero useful hits by 2026-10-01, revert the skill edit.
- [ ] Tests: shellcheck-clean; a fixture-driven test proving --rebuild + query round-trip on a temp corpus dir (pattern: RECENT_SOLUTIONS_DIR test seam from session-recent-issues.sh).

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
