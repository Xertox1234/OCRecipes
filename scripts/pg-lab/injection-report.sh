#!/usr/bin/env bash
# scripts/pg-lab/injection-report.sh — human-run report over harness.injection_log (see
# scripts/pg-lab/schema/injection-log.sql), the pattern-injection usage telemetry logged by
# .claude/hooks/inject-patterns.sh and .claude/hooks/session-recent-issues.sh.
#
# Three sections:
#   1. Docs never delivered in the last N days (default 30) — a full docs/rules/*.md +
#      docs/solutions/**/*.md corpus scan, LEFT JOINed against the log's delivered doc_paths.
#      A doc with NO row in the window (never delivered at all, or last delivered before the
#      window) is dead-weight-audit signal for docs/PATTERNS.md pruning.
#   2. Top domains by total payload bytes delivered (all-time) — which domains are the
#      heaviest injection-cost contributors.
#   3. Defer frequency by domain (all-time) — how often a domain's payload is deferred vs.
#      injected inline; complements the itest-defer margin concern (a domain that defers
#      constantly may need a smaller rules file or a payload-tuning pass).
#
# Unlike log-injection.sh (fail-silent, backgrounded off a hook's hot path), this is a human-
# invoked reporting tool: it fails LOUDLY (missing psql, unreachable DB, bad corpus paths).
#
# Usage: scripts/pg-lab/injection-report.sh [--days N]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
RULES_DIR="${PG_LAB_RULES_DIR:-$PROJECT_ROOT/docs/rules}"
SOLUTIONS_DIR="${PG_LAB_SOLUTIONS_DIR:-$PROJECT_ROOT/docs/solutions}"
DAYS=30

while [ $# -gt 0 ]; do
  case "$1" in
    --days)
      DAYS="${2:-}"
      shift 2
      ;;
    *)
      echo "injection-report.sh: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$DAYS" in ''|*[!0-9]*)
  echo "injection-report.sh: --days must be a positive integer, got: $DAYS" >&2
  exit 1
  ;;
esac

# Hard safety rail: mirrors init.sh / codify-neardup.sh — this must never read a real app
# database (a report over the wrong DB is worse than no report). Strip query string /
# fragment BEFORE the last-path-segment split — a raw `${VAR##*/}` split alone lets a
# suffix like `?sslmode=require` smuggle a denylisted name (e.g. `nutricam?sslmode=require`)
# past the `case` match entirely, while `psql` itself parses the full URI correctly and
# connects to the real database anyway. This remains a hand-parsed, best-effort guard, not
# a hard guarantee — it does not close a `?dbname=` query-parameter override, where libpq
# honors the override over the URI path segment
# (docs/solutions/logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md).
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"
LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "injection-report.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac
# Second, independent layer: a percent-encoded denylisted name (e.g. `nutr%69cam`, which
# libpq decodes to `nutricam` before connecting) fails the exact-match case above but is
# still not a safe bare identifier, so this allowlist catches it too.
if ! [[ "${LAB_DB_PATH##*/}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "injection-report.sh: refusing — '${LAB_DB_PATH##*/}' (derived from LAB_DATABASE_URL) is not a safe Postgres identifier" >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || { echo "injection-report.sh: psql not found on PATH" >&2; exit 1; }
psql -X -q -d "$LAB_DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1 || {
  echo "injection-report.sh: cannot reach $LAB_DATABASE_URL — is the lab DB up? (scripts/pg-lab/init.sh)" >&2
  exit 1
}

# --- Corpus scan: every repo-relative doc path that COULD be delivered -------------------
TMP_CORPUS="$(mktemp)"
trap 'rm -f "$TMP_CORPUS"' EXIT

[ -d "$RULES_DIR" ] && find "$RULES_DIR" -type f -name '*.md' -exec sh -c '
  for f; do printf "docs/rules/%s\n" "$(basename "$f")"; done
' _ {} + >> "$TMP_CORPUS"

if [ -d "$SOLUTIONS_DIR" ]; then
  find "$SOLUTIONS_DIR" -type f -name '*.md' \
    ! -path '*/_manifests/*' ! -name 'README.md' \
    -exec sh -c '
      root="$1"; shift
      for f; do
        rel="${f#"$root"/}"
        printf "docs/solutions/%s\n" "$rel"
      done
    ' _ "$SOLUTIONS_DIR" {} + >> "$TMP_CORPUS"
fi

CORPUS_COUNT=$(wc -l < "$TMP_CORPUS" | tr -d ' ')
if [ "$CORPUS_COUNT" -eq 0 ]; then
  echo "injection-report.sh: 0 corpus files found under $RULES_DIR / $SOLUTIONS_DIR — refusing to report (would flag everything as never-delivered)" >&2
  exit 1
fi

echo "=== PG Lab injection-log report (window: last ${DAYS}d; corpus: ${CORPUS_COUNT} docs) ==="
echo

echo "--- 1. Docs never delivered in the last ${DAYS} days ---"
psql -X -q -d "$LAB_DATABASE_URL" -v days="$DAYS" <<SQL
CREATE TEMP TABLE _corpus (doc_path TEXT PRIMARY KEY);
\copy _corpus FROM '$TMP_CORPUS'
SELECT c.doc_path
FROM _corpus c
LEFT JOIN (
  SELECT unnest(doc_paths) AS doc_path, max(ts) AS last_ts
  FROM harness.injection_log
  GROUP BY unnest(doc_paths)
) recent ON recent.doc_path = c.doc_path
WHERE recent.last_ts IS NULL
   OR recent.last_ts < now() - (:'days' || ' days')::interval
ORDER BY c.doc_path;
SQL
echo

echo "--- 2. Top domains by total payload bytes (all-time) ---"
psql -X -q -d "$LAB_DATABASE_URL" -c "
SELECT domain, sum(payload_bytes) AS total_bytes, count(*) AS events
FROM harness.injection_log
WHERE domain IS NOT NULL AND domain <> ''
GROUP BY domain
ORDER BY total_bytes DESC
LIMIT 15;
"
echo

echo "--- 3. Defer frequency by domain (all-time) ---"
psql -X -q -d "$LAB_DATABASE_URL" -c "
SELECT
  domain,
  count(*) FILTER (WHERE action = 'deferred') AS deferred,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE action = 'deferred') / NULLIF(count(*), 0), 1) AS defer_pct
FROM harness.injection_log
WHERE domain IS NOT NULL AND domain <> ''
GROUP BY domain
ORDER BY deferred DESC, defer_pct DESC;
"
