#!/usr/bin/env bash
# scripts/pg-lab/transcripts.sh — Claude Code session-transcript archive, backed by the
# ocrecipes_lab lab DB (harness.transcript_messages / harness.transcript_sessions — see
# scripts/pg-lab/schema/transcripts.sql), so "when did we decide X?" is a search instead of
# archaeology through ~/.claude/projects/*/*.jsonl by hand.
#
# Three modes:
#   --import              Incrementally ingest new lines from every ~/.claude/projects/*/*.jsonl
#                          file (or PG_LAB_TRANSCRIPTS_DIR/*/*.jsonl in tests). Per-session
#                          bookmark in harness.transcript_sessions.last_imported_line makes a
#                          repeat run with no new content a no-op — safe to cron.
#   --rebuild              Truncate harness.transcript_messages + harness.transcript_sessions
#                          (never dropped, only emptied — same convention as
#                          harness.solution_titles in codify-neardup.sql) and reimport
#                          everything from scratch. A human runs this directly.
#   "<search terms>"       Ranked matches (ts_rank via plainto_tsquery) with ±1 message of
#                          context per hit. `--fuzzy` switches to pg_trgm similarity() for
#                          misremembered phrasing.
#
# Unlike codify-neardup.sh's query mode (invoked automatically from the /codify write-time
# hook, so it must fail SILENTLY per the PG Lab "fail-silent in hooks" rail), this script is
# never auto-invoked — no watch daemon in v1, manual/cron `--import` only (per the todo's
# Implementation Notes) — so every mode here fails LOUD (set -e) on a real error.
#
# JSONL parsing follows the same shape as ~/.local/bin/extract-chat (prior art cited by the
# todo), with one correction verified against real transcripts: a `type: "user" | "assistant" |
# ...` record; both user and assistant `content` can be either a plain string or a list of
# blocks. A string is ingested unless it starts with "<" (framework-injected caveats/
# command-name/session-summary XML). A list is iterated per-block: `text` is ingested (as
# `user`/`assistant` respectively, and still subject to the "<" framework-injection check --
# a real question can travel alongside a framework `<ide_opened_file>` block in the same
# array), `tool_use` is ingested as its `name` only, never `input` (keeps secrets/params out
# and satisfies "text only ... + tool names"), and `tool_result`/`image`/`thinking`/any other
# block type is skipped (tool_result deliberately never ingested per the todo AC: "do NOT
# ingest tool result payloads in v1"; extract-chat's own list-content handling assumes user
# list-content is always tool_result, which real transcripts disprove -- do not repeat that
# assumption here). Every other top-level record `type` (mode, system, attachment,
# queue-operation, pr-link, permission-mode, last-prompt, ai-title, file-history-snapshot, and
# any future/unknown type) is skipped tolerantly -- this format is undocumented and may change
# (todo Risk).
#
# msg_uuid (the natural PK in transcript_messages) is the JSONL record's own `uuid` field,
# suffixed `#<block-index>` when one assistant record yields more than one row (multiple
# text/tool_use blocks) -- this makes `ON CONFLICT (msg_uuid) DO NOTHING` a correctness net
# on top of the per-session line bookmark, not just a bookmark-driven no-op.
#
# Privacy: a lightweight regex redaction pass runs on every ingested content string before
# insert (todo Risk: "add a --redact-patterns pass ... before insert") -- OpenAI-style keys,
# AWS access-key IDs, PEM private-key blocks, JWT-shaped strings, generic key=value secrets,
# and credentials embedded in a postgres:// URL. Best-effort, not exhaustive.
#
# psql gotcha (docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md):
# any `:'var'` substitution MUST go through stdin/a heredoc, never a `-c` string -- followed
# throughout this script.
#
# Usage:
#   scripts/pg-lab/transcripts.sh --import
#   scripts/pg-lab/transcripts.sh --rebuild
#   scripts/pg-lab/transcripts.sh "search terms" [--fuzzy]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
PROJECTS_DIR="${PG_LAB_TRANSCRIPTS_DIR:-$HOME/.claude/projects}"
# word_similarity() cutoff for --fuzzy (see run_search: content is long free-text, so the
# whole-string similarity()/`%` operator under-scores a short misremembered phrase against
# it -- word_similarity()/`<%` measures the query against the best-matching EXTENT of content
# instead, which is the correct primitive here. 0.3 is a conservative starting point (the
# built-in pg_trgm.word_similarity_threshold default of 0.6 is tuned for short-string/
# autocomplete matching, not fuzzy recall over full sentences) -- override to tune.
FUZZY_THRESHOLD="${PG_LAB_TRANSCRIPTS_FUZZY_THRESHOLD:-0.3}"
# Validated eagerly (not just left to fail inside the `SET pg_trgm.word_similarity_threshold
# = :threshold;` substitution below) so a stray non-numeric override produces a clear usage
# error here instead of a confusing raw SQL error deep in run_search.
if ! [[ "$FUZZY_THRESHOLD" =~ ^[0-9]*\.?[0-9]+$ ]]; then
  echo "transcripts.sh: PG_LAB_TRANSCRIPTS_FUZZY_THRESHOLD must be a plain number, got '$FUZZY_THRESHOLD'" >&2
  exit 1
fi

# Hard safety rail: this script must never point at a real app database (see init.sh /
# codify-neardup.sh for the identical guard).
case "${LAB_DATABASE_URL##*/}" in
  nutricam | ocrecipes_solutions)
    echo "transcripts.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DATABASE_URL##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

command -v psql >/dev/null 2>&1 || { echo "transcripts.sh: psql not found on PATH" >&2; exit 1; }

MODE="${1:-}"
if [ -z "$MODE" ]; then
  echo "usage: $0 --import | --rebuild | \"<search terms>\" [--fuzzy]" >&2
  exit 1
fi

apply_schema() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$SCRIPT_DIR/schema/transcripts.sql"
}

# --- Python JSONL block parser: reads lines (start, end] of a transcript file, emits CSV rows
# (msg_uuid,session_id,project_dir,ts,role,content) for user/assistant text + tool_use names.
# session_id is passed in (verified against the file by the caller) rather than trusted from
# each record's own `sessionId` field, so a stray/absent field can never misfile a row under
# the wrong session.
parse_file() {
  local file="$1" start="$2" end="$3" fallback_dir="$4" session_id="$5"
  python3 - "$file" "$start" "$end" "$fallback_dir" "$session_id" <<'PYEOF'
import csv
import json
import re
import sys

REDACT_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{16,}"),                                  # OpenAI-style secret keys
    re.compile(r"AKIA[0-9A-Z]{16}"),                                     # AWS access key id
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL),
    re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),    # JWT-shaped tokens
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}"),
    re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@"),                   # DB URL credentials
]

# `to_tsvector` (the schema's GENERATED tsv column) errors with "string is too long for
# tsvector" past ~1MB; cap well under that -- search is for dialogue, not indexing a pasted
# file/log dump wholesale.
MAX_CONTENT_CHARS = 200_000
TRUNCATION_NOTE = "\n\n[...truncated for transcript archive...]"

TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$")


def redact(text):
    for pat in REDACT_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


def sanitize_ts(ts):
    # Guards the caller's `NULLIF(ts, '')::timestamptz` cast -- an unparseable timestamp
    # string would otherwise fail the whole COPY. Falls back to empty (-> SQL NULL) rather
    # than crashing or dropping the row. Accepted tradeoff: a NULL ts row-comparison in
    # run_search's LATERAL prev/next lookup evaluates to UNKNOWN, so that one message
    # silently loses its ±1-message context (search still finds and returns the message
    # itself) -- graceful degradation of a nice-to-have, not loss of the row, is preferred
    # over hard-failing the whole file's import over one bad timestamp.
    return ts if TS_RE.match(ts) else ""


def emit(writer, msg_uuid, session_id, project_dir, ts, role, content):
    content = content.strip() if isinstance(content, str) else ""
    if not content:
        return
    content = content.replace("\x00", "")  # NUL bytes are rejected by `\copy` into TEXT
    if len(content) > MAX_CONTENT_CHARS:
        content = content[:MAX_CONTENT_CHARS] + TRUNCATION_NOTE
    writer.writerow([msg_uuid, session_id, project_dir, sanitize_ts(ts), role, redact(content)])


def main():
    path, start, end, fallback_dir, session_id = (
        sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5],
    )
    writer = csv.writer(sys.stdout, lineterminator="\n")
    parse_errors = 0
    skipped_types = 0

    with open(path, encoding="utf-8", errors="replace") as f:
        for lineno, raw_line in enumerate(f, start=1):
            if lineno <= start:
                continue
            if lineno > end:
                break
            line = raw_line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                parse_errors += 1
                continue

            rtype = obj.get("type")
            if rtype not in ("user", "assistant"):
                skipped_types += 1
                continue

            msg_uuid = obj.get("uuid")
            if not msg_uuid:
                continue
            project_dir = obj.get("cwd") or fallback_dir
            ts = obj.get("timestamp") or ""
            message = obj.get("message") or {}
            content = message.get("content", "")

            def ingest_blocks(blocks, role):
                for idx, block in enumerate(blocks):
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    if btype == "text":
                        text = block.get("text", "")
                        stripped = text.strip() if isinstance(text, str) else ""
                        if stripped.startswith("<"):
                            continue  # framework-injected XML can appear as one block of many
                        emit(writer, f"{msg_uuid}#{idx:03d}", session_id, project_dir, ts, role, stripped)
                    elif btype == "tool_use" and role == "assistant":
                        emit(writer, f"{msg_uuid}#{idx:03d}", session_id, project_dir, ts,
                             "tool", block.get("name", ""))
                    # tool_result / image / thinking / any other block type: never ingested.

            if isinstance(content, str):
                stripped = content.strip()
                if stripped.startswith("<"):
                    continue  # framework-injected XML: caveats, command names, summaries
                emit(writer, msg_uuid, session_id, project_dir, ts, rtype, stripped)
            elif isinstance(content, list):
                ingest_blocks(content, rtype)

    print(f"parse errors: {parse_errors}, skipped record types: {skipped_types}", file=sys.stderr)


if __name__ == "__main__":
    main()
PYEOF
}

# --- Import a single session file: read only NEW lines (past its bookmark), load via a temp
# staging table + ON CONFLICT DO NOTHING, then upsert the session bookmark -- all in one
# transaction, so a bookmark update can never observe a partial/failed load.
import_file() {
  local file="$1"
  local basename session_id total bookmark tmp_csv fallback_dir

  basename="$(basename "$file" .jsonl)"
  session_id="$basename"
  # awk's NR counts a final line even without a trailing newline; `wc -l` (which counts
  # newline characters) would silently undercount that file by one and permanently strand
  # its last line unimported, since a session file that has already stopped growing never
  # gets a chance to "catch up" on a later run.
  total="$(awk 'END { print NR }' "$file")"

  bookmark="$(psql -X -q -tA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v sid="$session_id" <<'SQL'
SELECT COALESCE(last_imported_line, 0) FROM harness.transcript_sessions WHERE session_id = :'sid';
SQL
)"
  bookmark="${bookmark:-0}"

  if [ "$total" -le "$bookmark" ]; then
    echo "  $session_id: no new lines (at line $bookmark)"
    return 0
  fi

  # Fallback project_dir if no record in the new line range carries a `cwd` field -- derive
  # from the project-slug directory name (best-effort; real `cwd` values always win).
  fallback_dir="$(basename "$(dirname "$file")")"

  tmp_csv="$(mktemp)"
  # Explicit exit-status check (not a bare statement): `import_file` is invoked as
  # `if ! import_file "$f"` by import_all, and bash suspends `errexit` for a function's
  # ENTIRE dynamic extent while it is the subject of `if !`/`&&`/`||` -- not just its final
  # command. Without this check, a `parse_file` crash partway through a file would be
  # silently swallowed, its partial output would be loaded as if it were the complete file,
  # and the bookmark below would advance past content that was never actually parsed.
  if ! parse_file "$file" "$bookmark" "$total" "$fallback_dir" "$session_id" > "$tmp_csv"; then
    rm -f "$tmp_csv"
    return 1
  fi

  if ! psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v sid="$session_id" -v src="$file" -v total="$total" -v fallback="$fallback_dir" <<SQL
BEGIN;
CREATE TEMP TABLE tmp_transcript_import (
  msg_uuid TEXT, session_id TEXT, project_dir TEXT, ts TEXT, role TEXT, content TEXT
) ON COMMIT DROP;
\copy tmp_transcript_import FROM '$tmp_csv' WITH (FORMAT csv)

INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content)
SELECT msg_uuid, session_id, project_dir, NULLIF(ts, '')::timestamptz, role, content
FROM tmp_transcript_import
ON CONFLICT (msg_uuid) DO NOTHING;

INSERT INTO harness.transcript_sessions
  (session_id, project_dir, source_file, last_imported_line, message_count, first_ts, last_ts, imported_at)
SELECT
  :'sid',
  COALESCE((SELECT project_dir FROM tmp_transcript_import LIMIT 1), :'fallback'),
  :'src',
  :total,
  (SELECT count(*) FROM harness.transcript_messages WHERE session_id = :'sid'),
  (SELECT min(ts) FROM harness.transcript_messages WHERE session_id = :'sid'),
  (SELECT max(ts) FROM harness.transcript_messages WHERE session_id = :'sid'),
  now()
ON CONFLICT (session_id) DO UPDATE SET
  project_dir = EXCLUDED.project_dir,
  source_file = EXCLUDED.source_file,
  last_imported_line = EXCLUDED.last_imported_line,
  message_count = EXCLUDED.message_count,
  first_ts = EXCLUDED.first_ts,
  last_ts = EXCLUDED.last_ts,
  imported_at = EXCLUDED.imported_at;
COMMIT;
SQL
  then
    rm -f "$tmp_csv"
    return 1
  fi

  rm -f "$tmp_csv"
  echo "  $session_id: imported lines $((bookmark + 1))-$total"
}

# Populates the caller's `files` array (must be declared `local files=()` by the caller)
# with every transcript file under PROJECTS_DIR. Shared by import_all and --rebuild's
# pre-truncate guard so the two call sites can never drift on what counts as "no files".
scan_transcript_files() {
  shopt -s nullglob
  files=("$PROJECTS_DIR"/*/*.jsonl)
  shopt -u nullglob
}

import_all() {
  # Callers (both case branches below) are responsible for calling apply_schema
  # themselves before invoking this -- --rebuild needs the schema applied before its
  # TRUNCATE, which runs before import_all, so calling apply_schema again in here would
  # just be a second no-op round-trip on that path.
  local files=()
  scan_transcript_files
  if [ "${#files[@]}" -eq 0 ]; then
    echo "transcripts.sh: no .jsonl files found under $PROJECTS_DIR/*/*.jsonl" >&2
    return 0
  fi
  echo "▶ scanning ${#files[@]} transcript file(s) under $PROJECTS_DIR"
  local f failed=0
  for f in "${files[@]}"; do
    # Isolate one file's failure from the rest of the batch: without this, a single
    # poisoned/unreadable session file would abort the whole run under `set -e`, and
    # because its bookmark never advances past the failure, every later file in the loop
    # (and every future --import run) would be silently skipped forever.
    if ! import_file "$f"; then
      echo "  WARNING: import failed for $f — skipped, will retry on next run" >&2
      failed=$((failed + 1))
    fi
  done
  if [ "$failed" -gt 0 ]; then
    echo "✓ import complete ($failed file(s) failed and were skipped — see warnings above)"
  else
    echo "✓ import complete"
  fi
}

# --- Search: FTS (default) or pg_trgm (--fuzzy). Results are emitted one JSON object per
# line (via a ::text cast) so embedded newlines in message content never break line-based
# reading of psql's output -- reformatted below by a small python pretty-printer.
run_search() {
  local query="" fuzzy=0 arg
  for arg in "$@"; do
    if [ "$arg" = "--fuzzy" ]; then
      fuzzy=1
    else
      query="$arg"
    fi
  done
  if [ -z "$query" ]; then
    echo "usage: $0 \"<search terms>\" [--fuzzy]" >&2
    return 1
  fi

  apply_schema

  # `hits` filters+ranks first (index-accelerated: the GIN tsv index for FTS, the GIN trgm
  # index for --fuzzy) and LIMITs to 20 BEFORE the ±1-context lookup, so the two LATERAL
  # joins below only ever run against the matched rows, never against the whole table.
  local result_count results
  if [ "$fuzzy" -eq 1 ]; then
    results="$(psql -X -q -tA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v q="$query" -v threshold="$FUZZY_THRESHOLD" <<'SQL'
SET pg_trgm.word_similarity_threshold = :threshold;
WITH hits AS (
  SELECT msg_uuid, session_id, ts, role, content,
         word_similarity(:'q', content) AS rank
  FROM harness.transcript_messages
  WHERE :'q' <% content
  ORDER BY rank DESC
  LIMIT 20
)
SELECT row_to_json(x)::text FROM (
  SELECT h.session_id, h.ts, h.role, h.content, h.rank,
         prev.role AS prev_role, prev.content AS prev_content,
         next.role AS next_role, next.content AS next_content
  FROM hits h
  LEFT JOIN LATERAL (
    SELECT role, content FROM harness.transcript_messages m
    WHERE m.session_id = h.session_id AND (m.ts, m.msg_uuid) < (h.ts, h.msg_uuid)
    ORDER BY m.ts DESC, m.msg_uuid DESC LIMIT 1
  ) prev ON true
  LEFT JOIN LATERAL (
    SELECT role, content FROM harness.transcript_messages m
    WHERE m.session_id = h.session_id AND (m.ts, m.msg_uuid) > (h.ts, h.msg_uuid)
    ORDER BY m.ts ASC, m.msg_uuid ASC LIMIT 1
  ) next ON true
) x
ORDER BY x.rank DESC;
SQL
)"
  else
    results="$(psql -X -q -tA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v q="$query" <<'SQL'
WITH hits AS (
  SELECT msg_uuid, session_id, ts, role, content,
         ts_rank(tsv, plainto_tsquery('english', :'q')) AS rank
  FROM harness.transcript_messages
  WHERE tsv @@ plainto_tsquery('english', :'q')
  ORDER BY rank DESC
  LIMIT 20
)
SELECT row_to_json(x)::text FROM (
  SELECT h.session_id, h.ts, h.role, h.content, h.rank,
         prev.role AS prev_role, prev.content AS prev_content,
         next.role AS next_role, next.content AS next_content
  FROM hits h
  LEFT JOIN LATERAL (
    SELECT role, content FROM harness.transcript_messages m
    WHERE m.session_id = h.session_id AND (m.ts, m.msg_uuid) < (h.ts, h.msg_uuid)
    ORDER BY m.ts DESC, m.msg_uuid DESC LIMIT 1
  ) prev ON true
  LEFT JOIN LATERAL (
    SELECT role, content FROM harness.transcript_messages m
    WHERE m.session_id = h.session_id AND (m.ts, m.msg_uuid) > (h.ts, h.msg_uuid)
    ORDER BY m.ts ASC, m.msg_uuid ASC LIMIT 1
  ) next ON true
) x
ORDER BY x.rank DESC;
SQL
)"
  fi

  if [ -z "$results" ]; then
    result_count=0
    echo "no matches for: $query"
  else
    result_count="$(printf '%s\n' "$results" | grep -c .)"
    # `python3 -` reads its PROGRAM from stdin, so the piped JSON data below is fed via
    # process substitution (a real fd for the program) rather than a heredoc -- a heredoc
    # here would collide with the piped data on the same stdin and silently swallow it.
    printf '%s\n' "$results" | python3 <(cat <<'PYEOF'
import json
import sys

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    row = json.loads(line)
    print(f"[session {row['session_id']} @ {row.get('ts', '')}] (rank {row.get('rank'):.3f})")
    if row.get("prev_content"):
        print(f"  ... {row['prev_role']}: {row['prev_content'][:200]}")
    print(f"  >>> {row['role']}: {row['content']}")
    if row.get("next_content"):
        print(f"  ... {row['next_role']}: {row['next_content'][:200]}")
    print("---")
PYEOF
)
  fi

  # Value probe: log every search invocation (hit or miss), best-effort -- never let logging
  # block the result. Must go through stdin/heredoc, not -c (see the psql-c-flag solution).
  psql -X -q -d "$LAB_DATABASE_URL" -v q="${query:0:500}" -v fuzzy="$fuzzy" -v cnt="$result_count" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO harness.transcript_search_log (query, fuzzy, result_count)
VALUES (:'q', :fuzzy::boolean, :cnt);
SQL
}

case "$MODE" in
  --rebuild)
    apply_schema
    # Count-and-fail-on-zero BEFORE truncating (same rail as codify-neardup.sh --rebuild):
    # an empty/misconfigured PROJECTS_DIR must never wipe a previously-imported archive
    # with nothing to replace it.
    files=()
    scan_transcript_files
    if [ "${#files[@]}" -eq 0 ]; then
      echo "transcripts.sh --rebuild: refusing — no .jsonl files found under $PROJECTS_DIR/*/*.jsonl; would truncate the archive with nothing to reimport" >&2
      exit 1
    fi
    psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" <<'SQL'
TRUNCATE harness.transcript_messages, harness.transcript_sessions;
SQL
    import_all
    ;;
  --import)
    apply_schema
    import_all
    ;;
  *)
    run_search "$@"
    ;;
esac
