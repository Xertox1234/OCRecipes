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

# Inline size cap: Claude Code's hook-output cap is ~10K; past THRESHOLD the assembled
# context is copied to the spill file and truncated inline (see the spill block at the end).
THRESHOLD=9000
# Byte budget for FULL domain payloads when session dedup is ON. Once the assembled context
# would cross this, remaining domains are DEFERRED — a one-line pointer now, full injection
# on the session's next edit (a deferred domain is simply not recorded in the dedup state).
# Sits under THRESHOLD to leave headroom for the pointer lines themselves, so a first-touch
# multi-domain edit lands inline instead of byte-truncating mid-file to the spill.
DOMAIN_BUDGET=$((THRESHOLD - 400))

# Cap a newest-first `rel<TAB>title` candidate list to $1 lines, but guarantee at least one
# bug-track line (category dir = logic-errors|runtime-errors|code-quality|performance-issues)
# survives the cap when the candidates contain one. Keeps the original order otherwise.
# solutions_from_markdown feeds an OVER-cap (SOLUTIONS_PER_DOMAIN + 4) candidate list through
# this so a recent bug-track ref just outside the natural top-N can be swapped into the LAST slot.
reserve_bug_slot() {
  local cap="$1" line rel
  local -a all=() top=() rest=()
  while IFS= read -r line; do [ -n "$line" ] && all+=("$line"); done
  # Split into the natural top-$cap and the remainder.
  local idx=0
  for line in "${all[@]}"; do
    if [ "$idx" -lt "$cap" ]; then top+=("$line"); else rest+=("$line"); fi
    idx=$((idx+1))
  done
  # Does the natural top already contain a bug-track line?
  local has_bug=false
  for line in "${top[@]}"; do
    rel="${line%%	*}"
    case "$rel" in logic-errors/*|runtime-errors/*|code-quality/*|performance-issues/*) has_bug=true; break;; esac
  done
  if [ "$has_bug" = false ] && [ "${#rest[@]}" -gt 0 ]; then
    # Find the newest bug-track line in the remainder; if present, swap it for the LAST top line.
    local bug=""
    for line in "${rest[@]}"; do
      rel="${line%%	*}"
      case "$rel" in logic-errors/*|runtime-errors/*|code-quality/*|performance-issues/*) bug="$line"; break;; esac
    done
    if [ -n "$bug" ] && [ "${#top[@]}" -gt 0 ]; then
      top[$(( ${#top[@]} - 1 ))]="$bug"
    fi
  fi
  # Guard the expansion: "${top[@]}" on an empty array errors under `set -u` in bash 3.2.
  [ "${#top[@]}" -gt 0 ] && printf '%s\n' "${top[@]}"
}

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

# Build context in a temp file (avoids subshell newline stripping); BLOCKFILE stages one
# domain's payload at a time so the deferral decision can measure it before committing it.
TMPFILE=$(mktemp)
BLOCKFILE=$(mktemp)
trap 'rm -f "$TMPFILE" "$BLOCKFILE"' EXIT

printf '=== Pre-write context for %s ===\n' "$FILE_PATH" >> "$TMPFILE"

# Per-session dedup: inject each payload (the DISCIPLINE preamble, and each domain's full
# rules + solution refs) only the FIRST time it appears in a session; on later edits emit a
# one-line pointer instead. This bounds the repeated cost of editing many files in one
# session (e.g. a /todo loop).
# Requires a real session_id — when it's absent (or PATTERN_INJECT_NO_DEDUP=1) dedup is OFF and
# full payloads are always injected (fail-safe: more context, not less; also keeps session-less
# test runs deterministic).
# `// empty` is load-bearing: `jq -r '.session_id'` emits the literal "null" for an absent
# key (and -e only changes the exit code, not the output), which would make session-less
# callers share a "/tmp/...-null" state file and wrongly dedup. `// empty` yields "" instead.
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
DEDUP=1
{ [ -z "$SESSION" ] || [ "${PATTERN_INJECT_NO_DEDUP:-0}" = "1" ]; } && DEDUP=0
DEDUP_STATE="/tmp/ocrecipes-pattern-inject-${SESSION}"

# Discipline preamble — applies to every Edit/Write regardless of domain match, but is
# injected in FULL at most once per session (marker line `__preamble__` in the dedup state;
# `__` can never collide with a domain name). A missing/wiped state file fails OPEN to the
# full preamble — more context, not less.
if [ "$DEDUP" = "1" ] && grep -qxF "__preamble__" "$DEDUP_STATE" 2>/dev/null; then
  printf '\n[DISCIPLINE] injected earlier this session — still binding: think before coding, simplest change that works, surgical diffs, LSP-first on shared symbols.\n' >> "$TMPFILE"
else
  cat >> "$TMPFILE" <<'EOF'

[DISCIPLINE — applies before any edit]
- Think before coding. State your assumptions out loud. If the request is ambiguous, ask. If a simpler approach exists, push back. Stop when you are confused, name what is unclear, do not just pick one interpretation and run.
- Simplicity first. Write the minimum code that solves the problem. No speculative abstractions. No flexibility nobody asked for. The test: would a senior engineer call this overcomplicated.
- Surgical changes. Touch only what the task requires. Do not improve neighboring code. Do not refactor what is not broken. Every changed line should trace back to the request.
- Goal-driven execution. Turn vague instructions into verifiable targets before writing a line. "Add validation" becomes "write tests for invalid inputs, then make them pass."
- LSP-first. Before editing a shared symbol, check its blast radius with the LSP tool (findReferences / call-hierarchy), not grep — it resolves @/ and @shared/ aliases. See docs/rules/lsp.md.
EOF
  [ "$DEDUP" = "1" ] && printf '__preamble__\n' >> "$DEDUP_STATE"
fi

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

# Emit "source_rel<TAB>title" lines for a domain from the canonical docs/solutions/ tree.
solutions_from_markdown() {
  local domain="$1" tag_pattern
  tag_pattern=$(domain_tag_pattern "$domain")
  [ -d "$SOLUTIONS_DIR" ] || return 0
  local matches
  # Widen CAP#1 by +4 so a bug-track ref just outside the natural top-N is a reservation
  # candidate (reserve_bug_slot caps back to SOLUTIONS_PER_DOMAIN at the end).
  # --exclude=README.md: the schema README quotes example frontmatter lines that the
  # line-anchored grep would otherwise treat as a real solution's tags.
  matches=$(grep -rl --include='*.md' --exclude=README.md -E "^tags:.*${tag_pattern}" \
    "$SOLUTIONS_DIR" 2>/dev/null | grep -v '/_manifests/' \
    | sed "s|.*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)\.md\$|\1 &|" \
    | sort -r | cut -d' ' -f2- | head -n "$((SOLUTIONS_PER_DOMAIN + 4))" || true)
  [ -n "$matches" ] || return 0
  local priority="" fallback="" nl=$'\n'
  while IFS= read -r sol; do
    [ -n "$sol" ] || continue
    local pats matched=false
    # applies_to is inline flow style (canonical corpus format): strip `applies_to: [ ... ]`,
    # split on commas, trim surrounding spaces and optional quotes. Tolerates quoted too.
    pats=$(grep -m1 '^applies_to:' "$sol" 2>/dev/null \
      | sed -E 's/^applies_to:[[:space:]]*\[?//; s/\][[:space:]]*$//' \
      | tr ',' '\n' \
      | sed -E "s/^[[:space:]]*[\"']?//; s/[\"']?[[:space:]]*\$//" \
      | grep -v '^[[:space:]]*$' || true)
    if [ -n "$pats" ]; then
      while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        # shellcheck disable=SC2254
        [[ "$_FILE_REL" == $pat ]] && { matched=true; break; }
      done <<< "$pats"
    fi
    if [ "$matched" = true ]; then priority="${priority:+$priority$nl}$sol"; else fallback="${fallback:+$fallback$nl}$sol"; fi
  done <<< "$matches"
  # Widen CAP#2 by +4 too (mirrors CAP#1): build the OVER-cap candidate list, then reserve.
  matches=$(printf '%s\n%s\n' "$priority" "$fallback" | grep -v '^$' | head -n "$((SOLUTIONS_PER_DOMAIN + 4))")
  # Emit the over-cap `rel<TAB>title` candidates (newest/priority-first), then pipe the WHOLE
  # loop straight into reserve_bug_slot — capping back to SOLUTIONS_PER_DOMAIN with a guaranteed
  # bug slot. Piping the loop (not a captured $(...)) preserves the trailing newline so the
  # helper's `read` sees every candidate line.
  while IFS= read -r sol_file; do
    [ -n "$sol_file" ] || continue
    local rel title
    rel="${sol_file#"$PROJECT_ROOT"/}"
    rel="${rel#docs/solutions/}"
    # Strip a YAML scalar wrapper: double-quoted, OR single-quoted (with '' → ' unescape),
    # so quoted titles emit as their parsed scalar value.
    title=$(grep -m1 -E '^title:' "$sol_file" 2>/dev/null | sed -E "s/^title:[[:space:]]*//; s/^\"//; s/\"\$//; s/^'//; s/'\$//; s/''/'/g" || true)
    printf '%s\t%s\n' "$rel" "${title:-untitled}"
  done <<< "$matches" | reserve_bug_slot "$SOLUTIONS_PER_DOMAIN"
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
  EMITTED_FULL=0
  for DOMAIN in "${DOMAIN_LIST[@]}"; do
    RULES_FILE="$RULES_DIR/${DOMAIN}.md"

    # Already injected this session? Emit a one-line pointer and skip the full payload.
    if [ "$DEDUP" = "1" ] && grep -qxF "$DOMAIN" "$DEDUP_STATE" 2>/dev/null; then
      printf '\n[RULES — %s] already injected earlier this session — re-read docs/rules/%s.md if the rules are no longer in context.\n' "$DOMAIN" "$DOMAIN" >> "$TMPFILE"
      continue
    fi

    # Stage this domain's FULL payload (rules + solution refs) in BLOCKFILE so the deferral
    # decision below can measure it before committing it inline.
    : > "$BLOCKFILE"

    # Inject full rules file (short by design) — docs/rules/ is NOT being retired.
    if [ -f "$RULES_FILE" ]; then
      printf '\n[RULES — %s]\n' "$DOMAIN" >> "$BLOCKFILE"
      cat "$RULES_FILE" >> "$BLOCKFILE"
    fi

    # Inject the most relevant docs/solutions/ files for this domain (path + title only —
    # Read the file for the body). Matching rule: a solution matches a domain if the
    # domain's tag is in the solution's `tags`, newest-first by the YYYY-MM-DD in the
    # filename, capped at SOLUTIONS_PER_DOMAIN. Solutions whose applies_to: globs match
    # the edited file are promoted ahead of the rest. See solutions_from_markdown.
    SOLUTION_LINES=$(solutions_from_markdown "$DOMAIN")
    if [ -n "$SOLUTION_LINES" ]; then
      printf '\n[SOLUTIONS — %s (Read the file for the full body)]\n' "$DOMAIN" >> "$BLOCKFILE"
      while IFS=$'\t' read -r rel title; do
        [ -n "$rel" ] || continue
        printf -- '- docs/solutions/%s — %s\n' "$rel" "${title:-untitled}" >> "$BLOCKFILE"
      done <<< "$SOLUTION_LINES"
    fi

    # Defer instead of truncate: with session state available and at least one domain already
    # emitted in full, a domain that would push the context over DOMAIN_BUDGET is deferred —
    # NOT recorded in the dedup state, so the session's next edit injects it in full. The
    # first domain always emits regardless of size (otherwise an oversized single domain
    # would defer forever); the spill block below remains the backstop for that case.
    if [ "$DEDUP" = "1" ] && [ "$EMITTED_FULL" = "1" ] &&
      [ $(($(wc -c < "$TMPFILE") + $(wc -c < "$BLOCKFILE"))) -gt "$DOMAIN_BUDGET" ]; then
      printf '\n[RULES — %s] deferred (inline size cap) — auto-injects on the next edit this session; or read docs/rules/%s.md now.\n' "$DOMAIN" "$DOMAIN" >> "$TMPFILE"
      continue
    fi

    cat "$BLOCKFILE" >> "$TMPFILE"
    EMITTED_FULL=1

    # Record this domain as injected so later edits in the session get the one-line pointer.
    [ "$DEDUP" = "1" ] && printf '%s\n' "$DOMAIN" >> "$DEDUP_STATE"
  done
fi

# Spill overflow to a stable temp file so the agent can read the rest (THRESHOLD is defined
# at the top). With session dedup ON the deferral above keeps injections under the cap, so
# this is now the backstop for session-less runs and single domains too big for the budget.
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
