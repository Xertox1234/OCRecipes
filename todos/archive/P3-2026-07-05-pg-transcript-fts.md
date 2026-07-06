<!-- Filename: P3-2026-07-05-pg-transcript-fts.md -->

---

title: "PG Lab: Claude Code transcript archive with Postgres FTS + pg_trgm search"
status: done
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

- [x] `scripts/pg-lab/schema/transcripts.sql`: `harness.transcript_messages(session_id, project_dir, ts, role, content, tsv tsvector GENERATED)` + GIN index; `harness.transcript_sessions` summary table.
- [x] `scripts/pg-lab/transcripts.sh --import`: incremental (tracks last-imported file/offset per session; safe to cron); parses the Claude Code JSONL format tolerantly (skip-don't-crash on unknown record types). `--rebuild` drops and re-imports everything (derived-projection rail).
- [x] `scripts/pg-lab/transcripts.sh "search terms"`: ranked matches (ts_rank) with session id, date, ±1 message of context; `--fuzzy` flag switches to pg_trgm similarity for misremembered phrasing.
- [x] Text only from user/assistant messages + tool names; do NOT ingest tool result payloads in v1 (volume + noise; revisit later).
- [x] Value probe: log searches to `harness.transcript_search_log`; if unused by 2026-10-01, archive with that finding.
- [x] Fixture-driven test: import a small synthetic JSONL, assert search hit + incremental re-import no-op.

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

### 2026-07-06

- Implemented: `scripts/pg-lab/schema/transcripts.sql` (`harness.transcript_messages` with a
  GENERATED tsvector + GIN index, GIN trgm index, `(session_id, ts)` btree; `harness.transcript_sessions`
  bookmark table; `harness.transcript_search_log` value-probe ledger) and
  `scripts/pg-lab/transcripts.sh` (`--import`, `--rebuild`, and `"search terms" [--fuzzy]`),
  plus `.claude/hooks/test-pg-lab-transcripts.sh` (30 assertions, fixture-driven).
- Two rounds of code review (code-reviewer + server-reviewer, then a code-reviewer
  verification pass) found and fixed: (1) the parser's original assumption that user
  list-content is always `tool_result` was empirically false — real user text can arrive as
  list content, now handled via a shared per-block ingestion path; (2) no content validation
  before insert — oversized content, NUL bytes, and malformed timestamps could each break the
  import — now truncated/stripped/validated in the Python parser; (3) `import_all`'s
  per-file loop had no failure isolation, AND the first fix for that (`if ! import_file`)
  itself suspended `set -e` across `parse_file`'s unchecked invocation, silently swallowing a
  mid-file parser crash and committing partial data with an advanced bookmark — fixed with an
  explicit exit-status check on `parse_file`, live-reproduced and verified closed; (4)
  `session_id` was trusted from each JSONL record's own field instead of the file-verified
  value; (5) `--rebuild` truncated before checking whether any source files existed; (6)
  `wc -l` undercounts a file with no trailing newline. All fixes have regression coverage in
  the fixture test.
