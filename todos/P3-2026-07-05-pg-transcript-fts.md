<!-- Filename: P3-2026-07-05-pg-transcript-fts.md -->

---

title: "PG Lab: Claude Code transcript archive with Postgres FTS + pg_trgm search"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: Claude Code transcript archive with Postgres FTS + pg_trgm search

## Summary

Import `~/.claude/projects/*/*.jsonl` session transcripts into `harness.transcript_messages` and expose a keyword-search CLI (FTS + trigram), so "when did we decide X?" stops being archaeology.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. The "recurring regression mystery" (project_recurring_regression_mystery memory) took real digging through history; `extract-chat` exists precisely because transcript archaeology is a recurring need. The 2026-07-04 research found keyword search is the evidence-favored paradigm (BM25 > vectors on jargon-heavy corpora) — so this is FTS + pg_trgm, deliberately NO embeddings. Also a prerequisite for the Phase D episodic-distillation experiment.

## Acceptance Criteria

- [ ] `scripts/pg-lab/schema/transcripts.sql`: `harness.transcript_messages(session_id, project_dir, ts, role, content, tsv tsvector GENERATED)` + GIN index; `harness.transcript_sessions` summary table.
- [ ] `scripts/pg-lab/transcripts.sh --import`: incremental (tracks last-imported file/offset per session; safe to cron); parses the Claude Code JSONL format tolerantly (skip-don't-crash on unknown record types). `--rebuild` drops and re-imports everything (derived-projection rail).
- [ ] `scripts/pg-lab/transcripts.sh "search terms"`: ranked matches (ts_rank) with session id, date, ±1 message of context; `--fuzzy` flag switches to pg_trgm similarity for misremembered phrasing.
- [ ] Text only from user/assistant messages + tool names; do NOT ingest tool result payloads in v1 (volume + noise; revisit later).
- [ ] Value probe: log searches to `harness.transcript_search_log`; if unused by 2026-10-01, archive with that finding.
- [ ] Fixture-driven test: import a small synthetic JSONL, assert search hit + incremental re-import no-op.

## Implementation Notes

- JSONL location: `~/.claude/projects/<project-slug>/*.jsonl`. Study 2-3 real files first — schema varies by record type (`type: "user" | "assistant" | ...`); `extract-chat`'s parsing logic is prior art (it's an unversioned local script in `~/.local/bin/` — read it, don't shell out to it).
- Content lives outside the repo; the importer script lives in-repo. No watch daemon in v1 — manual/cron `--import` is enough.
- Postgres FTS lacks IDF (known limitation, fine at this corpus size — noted in the research report).

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Transcript JSONL format is undocumented and may change with Claude Code versions — tolerant parsing + skip counters, never hard-fail.
- Privacy: transcripts contain secrets pasted in sessions. DB is local-only; add a `--redact-patterns` pass (at minimum: strings matching common key formats) before insert.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch B).
