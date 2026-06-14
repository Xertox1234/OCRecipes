#!/usr/bin/env bash
# PreToolUse hook — inject relevant patterns, rules, and learnings before Edit/Write
# Reads tool event JSON from stdin; outputs additionalContext JSON or exits 0 silently.
set -uo pipefail

INPUT=$(cat)

# Extract tool name and file path; exit silently on parse failure
TOOL_NAME=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
FILE_PATH=$(printf '%s' "$INPUT" | jq -re '.tool_input.file_path' 2>/dev/null) || exit 0

# Only inject for Edit, Write, and MultiEdit tool calls
[[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "MultiEdit" ]] || exit 0

# Resolve paths relative to project root (two levels up from .claude/hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SOLUTIONS_DIR="$PROJECT_ROOT/docs/solutions"
RULES_DIR="$PROJECT_ROOT/docs/rules"

# Max solution files injected per domain (path + title only, newest-first).
# Bounds total output: ~4 domains x 4 files x ~110B ≈ 1.8KB of solution refs,
# leaving headroom for the full rules files under the 9000-byte spill threshold.
SOLUTIONS_PER_DOMAIN=4

# Map file path to domains
DOMAINS=""
add_domain() {
  case ",$DOMAINS," in
    *,"$1",*) ;;
    *) DOMAINS="${DOMAINS:+$DOMAINS,}$1" ;;
  esac
}
_add() { add_domain "$1"; }
# shellcheck source=lib/domain-map.sh
source "$SCRIPT_DIR/lib/domain-map.sh"

apply_domain_map "$FILE_PATH"

# Add typescript for .ts/.tsx files ONLY when no more-specific domain matched.
# Rationale: typescript rules are mostly general knowledge; project-specific TS conventions
# are already covered by more-specific domains (api, react-native, etc.). Suppressing
# typescript-on-top keeps the 4-domain stack under the 9000-byte spill threshold while
# preserving typescript guidance as the fallback for pure type-utility files (e.g. shared/).
if [ -z "$DOMAINS" ]; then
  case "$FILE_PATH" in
    *.ts|*.tsx) add_domain typescript ;;
  esac
fi

# Build context in a temp file (avoids subshell newline stripping)
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

printf '=== Pre-write context for %s ===\n' "$FILE_PATH" >> "$TMPFILE"

# Discipline preamble — applies to every Edit/Write regardless of domain match
cat >> "$TMPFILE" <<'EOF'

[DISCIPLINE — applies before any edit]
- Think before coding. State your assumptions out loud. If the request is ambiguous, ask. If a simpler approach exists, push back. Stop when you are confused, name what is unclear, do not just pick one interpretation and run.
- Simplicity first. Write the minimum code that solves the problem. No speculative abstractions. No flexibility nobody asked for. The test: would a senior engineer call this overcomplicated.
- Surgical changes. Touch only what the task requires. Do not improve neighboring code. Do not refactor what is not broken. Every changed line should trace back to the request.
- Goal-driven execution. Turn vague instructions into verifiable targets before writing a line. "Add validation" becomes "write tests for invalid inputs, then make them pass."
- LSP-first. Before editing a shared symbol, check its blast radius with the LSP tool (findReferences / call-hierarchy), not grep — it resolves @/ and @shared/ aliases. See docs/rules/lsp.md.
EOF

# Map a hook domain to the ERE fragment that matches it inside a `tags:` line.
# Most domains are their own whole-word tag (`\bapi\b`). The ai-prompting domain
# matches both the bare `ai` tag and every `ai-*` tag (ai-safety, ai-coaching,
# ai-content, ai-integration, ai-prompting) — all are AI-domain solutions.
domain_tag_pattern() {
  case "$1" in
    ai-prompting) printf '\\bai(-[a-z]+)?\\b' ;;
    *) printf '\\b%s\\b' "$1" ;;
  esac
}

# Emit "source_rel<TAB>title" lines for a domain from the markdown files (today's logic).
solutions_from_markdown() {
  local domain="$1" tag_pattern="$2"
  [ -d "$SOLUTIONS_DIR" ] || return 0
  local matches
  matches=$(grep -rl --include='*.md' -E "^tags:.*${tag_pattern}" \
    "$SOLUTIONS_DIR" 2>/dev/null | grep -v '/_manifests/' \
    | sed "s|.*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)\.md\$|\1 &|" \
    | sort -r | cut -d' ' -f2- | head -n "$SOLUTIONS_PER_DOMAIN" || true)
  [ -n "$matches" ] || return 0
  local priority="" fallback="" nl=$'\n'
  while IFS= read -r sol; do
    [ -n "$sol" ] || continue
    local pats matched=false
    pats=$(grep -m1 '^applies_to:' "$sol" 2>/dev/null | grep -oE '"[^"]+"' | tr -d '"' || true)
    if [ -n "$pats" ]; then
      while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        # shellcheck disable=SC2254
        [[ "$_FILE_REL" == $pat ]] && { matched=true; break; }
      done <<< "$pats"
    fi
    if [ "$matched" = true ]; then priority="${priority:+$priority$nl}$sol"; else fallback="${fallback:+$fallback$nl}$sol"; fi
  done <<< "$matches"
  matches=$(printf '%s\n%s\n' "$priority" "$fallback" | grep -v '^$' | head -n "$SOLUTIONS_PER_DOMAIN")
  while IFS= read -r sol_file; do
    [ -n "$sol_file" ] || continue
    local rel title
    rel="${sol_file#"$PROJECT_ROOT"/}"
    rel="${rel#docs/solutions/}"
    # Strip a YAML scalar wrapper: double-quoted, OR single-quoted (with '' → ' unescape),
    # so single-quoted titles match the DB path's properly-parsed title (Gate C equivalence).
    title=$(grep -m1 -E '^title:' "$sol_file" 2>/dev/null | sed -E "s/^title:[[:space:]]*//; s/^\"//; s/\"\$//; s/^'//; s/'\$//; s/''/'/g" || true)
    printf '%s\t%s\n' "$rel" "${title:-untitled}"
  done <<< "$matches"
}

# Emit "source_rel<TAB>title" lines for a domain from the DB. Returns non-zero on psql failure.
solutions_from_db() {
  local domain="$1"
  [ -n "${SOLUTIONS_DB_READONLY_URL:-}" ] || return 1
  # Mirror the markdown path's tag matching EXACTLY: it greps each file's `tags:` line
  # with the ERE from domain_tag_pattern (`\b<domain>\b`, or `\bai(-[a-z]+)?\b` for
  # ai-prompting). Word boundaries make it match the domain as a hyphen/comma-delimited
  # token inside compound tags too (e.g. `\bapi\b` matches `paid-api`). Replicate that
  # per array element with the same regex, translating ERE `\b` → Postgres `\y`. (Exact
  # array membership would UNDER-match compound tags and diverge from markdown.)
  local pg_pattern
  pg_pattern=$(domain_tag_pattern "$domain")   # e.g. \bapi\b  or  \bai(-[a-z]+)?\b
  pg_pattern="${pg_pattern//\\b/\\y}"           # ERE \b → Postgres \y word boundary
  pg_pattern="${pg_pattern//\'/\'\'}"           # SQL-escape any single quotes (none today; defensive)
  local where="EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ~ '${pg_pattern}')"
  local rows
  rows=$(psql "$SOLUTIONS_DB_READONLY_URL" -tAF$'\t' -c \
    "SELECT source_path, title, array_to_string(applies_to,'|') FROM solutions WHERE ${where} LIMIT 200;" \
    2>/dev/null) || return 1
  [ -n "$rows" ] || return 0
  # Date-sort by the YYYY-MM-DD embedded in source_path (mirrors the markdown path's filename sort).
  local sorted
  # Cap to the newest SOLUTIONS_PER_DOMAIN by date BEFORE promotion — the markdown path
  # head's its match list before splitting priority/fallback, so applies_to promotion only
  # REORDERS within the date-top-N; it never pulls in an (N+1)th file. Capping here mirrors
  # that. (Capping after promotion would surface applies_to matches from the whole corpus.)
  sorted=$(printf '%s\n' "$rows" | awk -F'\t' '{
    if (match($1, /[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$/)) d=substr($1, RSTART, 10); else d="0000-00-00";
    print d "\t" $0 }' | sort -rk1,1 | cut -f2- | head -n "$SOLUTIONS_PER_DOMAIN")
  local priority="" fallback="" nl=$'\n' tab=$'\t'
  while IFS=$'\t' read -r sp title pats; do
    [ -n "$sp" ] || continue
    local matched=false pat patarr=()
    if [ -n "$pats" ]; then
      IFS='|' read -ra patarr <<< "$pats"   # IFS scoped to this read only — no leak
      for pat in "${patarr[@]}"; do
        [ -n "$pat" ] || continue
        # shellcheck disable=SC2254
        [[ "$_FILE_REL" == $pat ]] && { matched=true; break; }
      done
    fi
    local rel="${sp#docs/solutions/}"
    if [ "$matched" = true ]; then priority="${priority:+$priority$nl}${rel}${tab}${title}"; else fallback="${fallback:+$fallback$nl}${rel}${tab}${title}"; fi
  done <<< "$sorted"
  # `; return 0` is load-bearing under `set -o pipefail`: when the result is empty, `grep -v`
  # exits 1, which would make this function return non-zero and wrongly trigger the markdown
  # fallback for a LEGITIMATELY-empty DB result. psql failure is already caught above; here a
  # successful-but-empty query must return 0 (= "no refs", don't fall back).
  printf '%s\n%s\n' "$priority" "$fallback" | grep -v '^$' | head -n "$SOLUTIONS_PER_DOMAIN"; return 0
}

# Emission priority (lower = emitted earlier = fills the inline budget first). When a
# multi-domain edit overflows the inline cap, the LOWEST-priority domains are the ones
# that spill to the temp file — instead of the truncation victim being decided by accident
# of match order. security is highest-stakes and must take the inline budget first; the
# most general domains (typescript, architecture) spill first. Unknown domains sort middle.
domain_rank() {
  case "$1" in
    security)      echo 10 ;;
    database)      echo 20 ;;
    accessibility) echo 30 ;;
    api)           echo 40 ;;
    ai-prompting)  echo 50 ;;
    react-native)  echo 60 ;;
    hooks)         echo 70 ;;
    performance)   echo 80 ;;
    design-system) echo 90 ;;
    client-state)  echo 100 ;;
    testing)       echo 110 ;;
    typescript)    echo 120 ;;
    architecture)  echo 130 ;;
    *)             echo 75 ;;
  esac
}

# Per-session dedup: inject each domain's full rules + solution refs only the FIRST time that
# domain appears in a session; on later edits emit a one-line pointer instead. This bounds the
# repeated cost of editing many files in one domain over a long session (e.g. a /todo loop).
# Requires a real session_id — when it's absent (or PATTERN_INJECT_NO_DEDUP=1) dedup is OFF and
# full rules are always injected (fail-safe: more context, not less; also keeps session-less
# test runs deterministic). Mirrors the per-session state-file pattern in lsp-nudge.sh.
# `// empty` is load-bearing: `jq -r '.session_id'` emits the literal "null" for an absent
# key (and -e only changes the exit code, not the output), which would make session-less
# callers share a "/tmp/...-null" state file and wrongly dedup. `// empty` yields "" instead.
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
DEDUP=1
{ [ -z "$SESSION" ] || [ "${PATTERN_INJECT_NO_DEDUP:-0}" = "1" ]; } && DEDUP=0
DEDUP_STATE="/tmp/ocrecipes-pattern-inject-${SESSION}"

# Repo-relative path of the edited file — used by both solution-source functions for
# applies_to: glob matching. FILE_PATH may be absolute; strip the PROJECT_ROOT prefix.
_FILE_REL="${FILE_PATH#"$PROJECT_ROOT"/}"

# Domain section (skipped if no domains matched — preamble still emitted above)
if [ -n "$DOMAINS" ]; then
  IFS=',' read -ra DOMAIN_LIST <<< "$DOMAINS"
  # Reorder by emission priority so security fills the inline budget first and the most
  # general domains spill last (see domain_rank). Domain names are whitespace-free single
  # tokens, so word-splitting the newline-separated, rank-sorted list is safe (bash 3.2
  # compatible — no mapfile).
  # shellcheck disable=SC2207
  DOMAIN_LIST=($(for d in "${DOMAIN_LIST[@]}"; do printf '%s\t%s\n' "$(domain_rank "$d")" "$d"; done | sort -n | cut -f2))
  for DOMAIN in "${DOMAIN_LIST[@]}"; do
    RULES_FILE="$RULES_DIR/${DOMAIN}.md"

    # Already injected this session? Emit a one-line pointer and skip the full payload.
    if [ "$DEDUP" = "1" ] && grep -qxF "$DOMAIN" "$DEDUP_STATE" 2>/dev/null; then
      printf '\n[RULES — %s] already injected earlier this session — re-read docs/rules/%s.md if the rules are no longer in context.\n' "$DOMAIN" "$DOMAIN" >> "$TMPFILE"
      continue
    fi

    # Inject full rules file (short by design) — docs/rules/ is NOT being retired.
    if [ -f "$RULES_FILE" ]; then
      printf '\n[RULES — %s]\n' "$DOMAIN" >> "$TMPFILE"
      cat "$RULES_FILE" >> "$TMPFILE"
    fi

    # Inject the most relevant docs/solutions/ files for this domain (path + title only —
    # Read the file for the body). Source is the DB by default, with a markdown fallback.
    # Matching rule (both sources): a solution matches a domain if the domain's tag is in
    # the solution's `tags`, newest-first by the YYYY-MM-DD in the filename, capped at
    # SOLUTIONS_PER_DOMAIN. Solutions whose applies_to: globs match the edited file are
    # promoted ahead of the rest. See solutions_from_db / solutions_from_markdown.
    TAG_PATTERN=$(domain_tag_pattern "$DOMAIN")
    # DB path when enabled AND the query succeeds (exit 0 — even if empty, which means
    # "legitimately no refs"). Otherwise (markdown mode OR psql failure) use the mirror.
    if [ "${PATTERN_INJECT_SOURCE:-db}" != "markdown" ] && SOLUTION_LINES=$(solutions_from_db "$DOMAIN"); then
      :
    else
      SOLUTION_LINES=$(solutions_from_markdown "$DOMAIN" "$TAG_PATTERN")
    fi
    if [ -n "$SOLUTION_LINES" ]; then
      printf '\n[SOLUTIONS — %s (Read the file for the full body)]\n' "$DOMAIN" >> "$TMPFILE"
      while IFS=$'\t' read -r rel title; do
        [ -n "$rel" ] || continue
        printf -- '- docs/solutions/%s — %s\n' "$rel" "${title:-untitled}" >> "$TMPFILE"
      done <<< "$SOLUTION_LINES"
    fi

    # Record this domain as injected so later edits in the session get the one-line pointer.
    [ "$DEDUP" = "1" ] && printf '%s\n' "$DOMAIN" >> "$DEDUP_STATE"
  done
fi

# Spill overflow to a stable temp file so the agent can read the rest.
# Claude Code's hook-output cap is ~10K; multi-domain injections routinely exceed this.
THRESHOLD=9000
SPILL_FILE="/tmp/ocrecipes-injection-context.md"
CONTEXT_SIZE=$(wc -c < "$TMPFILE")
if [ "$CONTEXT_SIZE" -gt "$THRESHOLD" ]; then
  cp "$TMPFILE" "$SPILL_FILE"
  head -c 8800 "$TMPFILE" > "${TMPFILE}.trunc"
  mv "${TMPFILE}.trunc" "$TMPFILE"
  printf '\n\n[TRUNCATED — %d bytes total. Full pattern context written to %s. Read that file for the rest before editing.]\n' \
    "$CONTEXT_SIZE" "$SPILL_FILE" >> "$TMPFILE"
fi

# Output hook response JSON
CONTEXT=$(cat "$TMPFILE")
jq -n --arg ctx "$CONTEXT" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$ctx}}'
