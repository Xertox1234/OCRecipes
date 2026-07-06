#!/usr/bin/env bash
# scripts/pg-lab/git-mine.sh — import this repo's `git log --numstat` into the
# ocrecipes_lab lab DB (repo.commits / repo.file_changes — see
# scripts/pg-lab/schema/git-mining.sql) and ship two canned queries git itself answers
# badly: churn hotspots and co-change coupling ("these two files change together N% of
# the time"). Part of PG Lab Batch C (docs/research/2026-07-05-pg-lab-roadmap.md).
#
# Modes:
#   --rebuild                 Truncate repo.commits/repo.file_changes/repo.import_cursor
#                              and re-import the FULL history from scratch (derived
#                              projection; one-way; a human runs this directly so it fails
#                              LOUDLY on error). Takes minutes on this repo's ~1800 commits
#                              — acceptable per the todo's implementation notes.
#   --import                  Incremental: resumes from repo.import_cursor.last_sha (the
#                              newest commit seen by the previous run). No prior cursor ->
#                              behaves like a full import. Zero new commits is the NORMAL
#                              steady-state case, not an error.
#   hotspots [--since 6mo]    Churn (commit count × line churn) ranked, filtered to files
#                              that still exist in the working tree and excluding
#                              lockfiles/generated files. --since accepts <N>(d|w|mo|y).
#   coupled <path> [--min-support N]
#                              Files that co-change with <path>, with support (shared
#                              commit count) and confidence % (support / commits touching
#                              <path>), excluding lockfiles/generated files. Default
#                              --min-support 5.
#
# v1 does NOT follow renames (--no-renames below) — a rename appears as an unrelated
# delete+add rather than a linked identity. This fragments co-change history across the
# 2026 route/storage domain-split moves; said loudly here, in git-mining.sql's header, and
# in the todo's report. A v2 could add `-M` + `old => new` arrow-path parsing.
#
# Test seam: PG_LAB_GIT_LOG_RAW, if set, is read as literal `git log --numstat --format=…`
# text INSTEAD of shelling out to git (mirrors PG_LAB_SOLUTIONS_DIR in codify-neardup.sh) —
# lets the hook self-test exercise --rebuild/hotspots/coupled against a synthetic history
# with no real git call.
#
# Respects LAB_DATABASE_URL (default: postgresql://localhost/ocrecipes_lab).
#
# Usage:
#   scripts/pg-lab/git-mine.sh --rebuild
#   scripts/pg-lab/git-mine.sh --import
#   scripts/pg-lab/git-mine.sh hotspots [--since 6mo]
#   scripts/pg-lab/git-mine.sh coupled <path> [--min-support 5]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
SCHEMA_FILE="$SCRIPT_DIR/schema/git-mining.sql"

# Hard safety rail (matches codify-neardup.sh / init.sh): this tool must never run against
# a real app database. Strip query string / fragment BEFORE the last-path-segment split — a
# raw `${VAR##*/}` split alone lets a suffix like `?sslmode=require` smuggle a denylisted
# name (e.g. `nutricam?sslmode=require`) past the `case` match entirely, while `psql` itself
# parses the full URI correctly and connects to the real database anyway.
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"
LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "git-mine.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

# An inherited absolute GIT_DIR (VS Code integrated terminal, a git-worktree context) wins
# over `git -C <path>` for repository resolution and would silently mine the WRONG repo —
# see docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md.
# Cheap to strip unconditionally before the first real git call.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

RS_MARK=$'\x02'
FS_MARK=$'\x01'
LOG_FORMAT="${RS_MARK}%H${FS_MARK}%aI${FS_MARK}%an${FS_MARK}%s"

usage() {
  echo "usage: $0 --rebuild | --import | hotspots [--since 6mo] | coupled <path> [--min-support 5]" >&2
}

apply_schema() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$SCHEMA_FILE" || {
    echo "git-mine.sh: failed to apply $SCHEMA_FILE" >&2
    exit 1
  }
}

# Emits raw `git log --numstat --format="$LOG_FORMAT"` text for $1 (a commit range, e.g.
# "HEAD" for full history or "<sha>..HEAD" for incremental) — either a real git call, or
# (test seam) the literal contents of PG_LAB_GIT_LOG_RAW when set.
git_log_source() {
  local range="$1"
  if [ -n "${PG_LAB_GIT_LOG_RAW:-}" ]; then
    # Test-only observability: PG_LAB_GIT_LOG_RAW always emits the same fixture text
    # regardless of $range, so a fixture-driven test can't otherwise see whether
    # do_import's cursor-based range construction ("<last_sha>..HEAD") is correct. When
    # set, record the range that WOULD have been passed to real git. Never read by
    # production code.
    [ -n "${PG_LAB_GIT_MINE_DEBUG_RANGE_FILE:-}" ] && printf '%s' "$range" > "$PG_LAB_GIT_MINE_DEBUG_RANGE_FILE"
    cat "$PG_LAB_GIT_LOG_RAW"
    return 0
  fi
  git -C "$PROJECT_ROOT" log "$range" --no-renames --numstat --format="$LOG_FORMAT"
}

# Reads raw git-log text from stdin, writes CSV rows into $1 (commits) and $2 (file
# changes), and prints "count<TAB>newest_sha" to stdout (nothing if zero commits parsed).
# Binary files report "-" for both numstat counts (documented git behavior) — stored as 0
# with is_binary='t'.
parse_git_log() {
  local commits_csv="$1" changes_csv="$2"
  awk -v RS_MARK="$RS_MARK" -v FS_MARK="$FS_MARK" \
      -v commits_csv="$commits_csv" -v changes_csv="$changes_csv" '
    function csvq(v) { gsub(/"/, "\"\"", v); return "\"" v "\"" }
    BEGIN { count = 0; newest = ""; sha = "" }
    {
      line = $0
      if (substr(line, 1, length(RS_MARK)) == RS_MARK) {
        rest = substr(line, length(RS_MARK) + 1)
        n = split(rest, f, FS_MARK)
        sha = f[1]
        ts = f[2]
        author = f[3]
        subject = f[4]
        for (i = 5; i <= n; i++) subject = subject FS_MARK f[i]
        printf "%s,%s,%s,%s\n", csvq(sha), csvq(ts), csvq(author), csvq(subject) > commits_csv
        count++
        if (newest == "") newest = sha
        next
      }
      if (length(line) == 0) next
      m = split(line, nf, "\t")
      if (m < 3) next
      add = nf[1]; del = nf[2]; path = nf[3]
      for (i = 4; i <= m; i++) path = path "\t" nf[i]
      isbin = "f"
      if (add == "-") { add = 0; isbin = "t" }
      if (del == "-") { del = 0; isbin = "t" }
      printf "%s,%s,%s,%s,%s\n", csvq(sha), add + 0, del + 0, csvq(path), isbin > changes_csv
    }
    END {
      if (count > 0) printf "%d\t%s\n", count, newest
    }
  '
}

# Builds a single POSIX-ERE alternation matching lockfiles/generated files, so
# hotspots/coupled never surface noise. Shares the list with the repo's existing
# generated-file registry (.prettierignore — package-lock.json, the generated
# .github/copilot-instructions.md, the format-locked docs/solutions/ tree) instead of a
# hand-duplicated copy that can drift, unioned with common lockfile basenames
# .prettierignore doesn't (yet) list.
#
# Caveat: every .prettierignore entry is ERE-escaped literally, including glob
# metacharacters (*, ?, etc.) — correct today because .prettierignore only holds literal
# paths, but if it ever gains a real glob entry (e.g. `*.log`), the wildcard is escaped to
# a literal character and that exclusion silently becomes a no-op. Revisit with a proper
# glob-to-regex translation if .prettierignore grows glob entries.
build_exclude_regex() {
  local prettierignore="$PROJECT_ROOT/.prettierignore"
  local -a alts=()
  local line esc
  if [ -f "$prettierignore" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in
        '#'*) continue ;;
      esac
      # shellcheck disable=SC2016
      esc=$(printf '%s' "$line" | sed -e 's/[.[\*^$()+?{}|\\]/\\&/g')
      case "$line" in
        */) alts+=("^${esc}") ;;
        *) alts+=("(^|/)${esc}\$") ;;
      esac
    done < "$prettierignore"
  fi
  local extra
  for extra in yarn.lock pnpm-lock.yaml Podfile.lock Gemfile.lock composer.lock; do
    # shellcheck disable=SC2016
    esc=$(printf '%s' "$extra" | sed -e 's/[.[\*^$()+?{}|\\]/\\&/g')
    alts+=("(^|/)${esc}\$")
  done
  local IFS='|'
  printf '%s' "${alts[*]}"
}

do_import() {
  local mode="$1" # "rebuild" or "import"
  apply_schema

  local range="HEAD"
  if [ "$mode" = "import" ]; then
    local last_sha
    last_sha="$(psql -X -q -tA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" \
      -c "SELECT last_sha FROM repo.import_cursor WHERE id" 2>/dev/null)" || last_sha=""
    [ -n "$last_sha" ] && range="${last_sha}..HEAD"
  fi

  local tmp_c tmp_f
  tmp_c="$(mktemp)"
  tmp_f="$(mktemp)"
  # Values interpolated NOW (double-quoted trap string), not deferred: tmp_c/tmp_f are
  # function-local and would be unbound by the time this EXIT trap fires (after do_import
  # has returned and its locals have gone out of scope).
  # shellcheck disable=SC2064
  trap "rm -f '$tmp_c' '$tmp_f'" EXIT

  local summary
  summary="$(git_log_source "$range" | parse_git_log "$tmp_c" "$tmp_f")"
  local pipe_rc=$?
  if [ "$pipe_rc" -ne 0 ]; then
    echo "git-mine.sh --$mode: git log failed (range: $range)" >&2
    exit 1
  fi

  local count=0 newest_sha=""
  if [ -n "$summary" ]; then
    count="$(printf '%s' "$summary" | cut -f1)"
    newest_sha="$(printf '%s' "$summary" | cut -f2)"
  fi

  if [ "$mode" = "rebuild" ] && [ "$count" -eq 0 ]; then
    echo "git-mine.sh --rebuild: 0 commits parsed from git log — refusing to truncate the table" >&2
    exit 1
  fi

  if [ "$mode" = "import" ] && [ "$count" -eq 0 ]; then
    echo "git-mine.sh --import: no new commits since last import (up to date)"
    exit 0
  fi

  # --rebuild's TRUNCATE lives in the SAME transaction as the reload below (not a separate
  # psql invocation) so a crash/interrupt between the two can never leave the tables
  # truncated-but-unreloaded — --rebuild is all-or-nothing.
  local truncate_sql=""
  if [ "$mode" = "rebuild" ]; then
    truncate_sql="TRUNCATE repo.commits, repo.file_changes, repo.import_cursor;"
  fi

  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v newest="$newest_sha" <<PSQL || { echo "git-mine.sh --$mode: load failed" >&2; exit 1; }
BEGIN;
$truncate_sql
CREATE TEMP TABLE stage_commits (sha text, ts timestamptz, author text, subject text) ON COMMIT DROP;
CREATE TEMP TABLE stage_changes (sha text, additions int, deletions int, path text, is_binary boolean) ON COMMIT DROP;
\copy stage_commits FROM '$tmp_c' WITH (FORMAT csv)
\copy stage_changes FROM '$tmp_f' WITH (FORMAT csv)
INSERT INTO repo.commits (sha, ts, author, subject)
  SELECT sha, ts, author, subject FROM stage_commits
  ON CONFLICT (sha) DO NOTHING;
INSERT INTO repo.file_changes (sha, path, additions, deletions, is_binary)
  SELECT sha, path, additions, deletions, is_binary FROM stage_changes
  ON CONFLICT (sha, path) DO NOTHING;
INSERT INTO repo.import_cursor (id, last_sha, imported_at) VALUES (true, :'newest', now())
  ON CONFLICT (id) DO UPDATE SET last_sha = EXCLUDED.last_sha, imported_at = EXCLUDED.imported_at;
COMMIT;
PSQL

  echo "✓ git-mine.sh --$mode: imported $count commit(s); cursor at $newest_sha"
}

do_hotspots() {
  local since=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --since)
        # A bare trailing `--since` with no value must not spin forever: `shift 2` is a
        # documented no-op (nonzero exit, $# unchanged) when only one positional param is
        # left, so an unguarded loop never advances past `--since`.
        [ $# -ge 2 ] || {
          echo "git-mine.sh hotspots: --since requires a value" >&2
          exit 1
        }
        since="$2"
        shift 2
        ;;
      *)
        echo "git-mine.sh hotspots: unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  local interval_clause=""
  if [ -n "$since" ]; then
    if [[ "$since" =~ ^([0-9]+)(d|w|mo|y)$ ]]; then
      local num="${BASH_REMATCH[1]}" unit="${BASH_REMATCH[2]}" unit_word=""
      case "$unit" in
        d) unit_word="days" ;;
        w) unit_word="weeks" ;;
        mo) unit_word="months" ;;
        y) unit_word="years" ;;
      esac
      interval_clause="$num $unit_word"
    else
      echo "git-mine.sh hotspots: --since expects <N>(d|w|mo|y), e.g. 6mo — got '$since'" >&2
      exit 1
    fi
  fi

  apply_schema
  local exclude_re
  exclude_re="$(build_exclude_regex)"

  # Single source of truth for the raw-rank cutoff (interpolated into BOTH the SQL LIMIT
  # and the bash diagnostic below) — a previous version hardcoded 1000 in each place
  # independently, which could silently drift out of sync if only one were ever edited.
  local raw_limit=1000

  local rows
  rows="$(psql -X -q -tA -F $'\t' -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" \
    -v since="$interval_clause" -v excl="$exclude_re" <<SQL
SELECT fc.path, count(DISTINCT fc.sha) AS commits,
       sum(fc.additions + fc.deletions) AS churn,
       count(DISTINCT fc.sha) * sum(fc.additions + fc.deletions) AS score
FROM repo.file_changes fc
JOIN repo.commits c ON c.sha = fc.sha
WHERE (NULLIF(:'since', '') IS NULL OR c.ts >= now() - NULLIF(:'since', '')::interval)
  AND fc.path !~ :'excl'
GROUP BY fc.path
ORDER BY score DESC
LIMIT $raw_limit;
SQL
  )" || { echo "git-mine.sh hotspots: query failed" >&2; exit 1; }
  # The SQL LIMIT above is generous (comfortably above this repo's ~3600 ever-touched
  # distinct paths) precisely so the bash-side existing-file filter below never silently
  # starves the top-20 output: a deleted/renamed path (more likely here since --no-renames
  # fragments identity across moves) consumes a raw-ranked slot without producing a
  # displayed row. A tighter SQL-side LIMIT risked returning fewer than 20 survivors with
  # no diagnostic — the warning below catches that case if it still occurs.

  local shown=0 scanned=0
  local path commits churn score
  while IFS=$'\t' read -r path commits churn score; do
    [ -n "$path" ] || continue
    scanned=$((scanned + 1))
    [ -e "$PROJECT_ROOT/$path" ] || continue
    printf '%-60s commits=%-6s churn=%-8s score=%s\n' "$path" "$commits" "$churn" "$score"
    shown=$((shown + 1))
    [ "$shown" -ge 20 ] && break
  done <<< "$rows"

  if [ "$shown" -lt 20 ] && [ "$scanned" -ge "$raw_limit" ]; then
    echo "git-mine.sh hotspots: only $shown of the top-$raw_limit raw-ranked paths still exist on disk — raise the SQL LIMIT if this repo's deleted-path fraction keeps growing" >&2
  fi
}

do_coupled() {
  local target="${1:-}"
  [ -n "$target" ] || {
    echo "git-mine.sh coupled: missing <path>" >&2
    usage
    exit 1
  }
  shift
  local min_support=5
  while [ $# -gt 0 ]; do
    case "$1" in
      --min-support)
        [ $# -ge 2 ] || {
          echo "git-mine.sh coupled: --min-support requires a value" >&2
          exit 1
        }
        min_support="$2"
        shift 2
        ;;
      *)
        echo "git-mine.sh coupled: unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  # CRITICAL: min_support is spliced into the query as an UNQUOTED `:minsup` psql
  # substitution (`cc.support >= :minsup`) — psql inserts it as literal SQL text, not a
  # bound parameter. Without this check, `--min-support "0 OR 1=1"` rewrites the WHERE
  # clause (AND binds tighter than OR) and silently defeats the filter — a real SQL
  # injection primitive, verified experimentally. Validate as a plain non-negative integer
  # before it ever reaches the heredoc.
  [[ "$min_support" =~ ^[0-9]+$ ]] || {
    echo "git-mine.sh coupled: --min-support expects a non-negative integer — got '$min_support'" >&2
    exit 1
  }

  apply_schema
  local exclude_re
  exclude_re="$(build_exclude_regex)"

  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" \
    -v target="$target" -v minsup="$min_support" -v excl="$exclude_re" <<'SQL' || { echo "git-mine.sh coupled: query failed" >&2; exit 1; }
SELECT
    CASE WHEN cc.path_a = :'target' THEN cc.path_b ELSE cc.path_a END AS coupled_path,
    cc.support,
    round(100.0 * cc.support / fc.commits, 1) AS confidence_pct
FROM repo.co_change_pairs cc
JOIN repo.file_commit_counts fc ON fc.path = :'target'
WHERE (cc.path_a = :'target' OR cc.path_b = :'target')
  AND cc.support >= :minsup
  AND (CASE WHEN cc.path_a = :'target' THEN cc.path_b ELSE cc.path_a END) !~ :'excl'
ORDER BY confidence_pct DESC, cc.support DESC
LIMIT 20;
SQL
}

MODE="${1:-}"
[ -n "$MODE" ] || {
  usage
  exit 1
}

case "$MODE" in
  --rebuild) do_import "rebuild" ;;
  --import) do_import "import" ;;
  hotspots)
    shift
    do_hotspots "$@"
    ;;
  coupled)
    shift
    do_coupled "$@"
    ;;
  *)
    usage
    exit 1
    ;;
esac
