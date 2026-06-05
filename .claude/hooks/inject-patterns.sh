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

    # Inject full rules file (short by design) — docs/rules/ is NOT being retired.
    if [ -f "$RULES_FILE" ]; then
      printf '\n[RULES — %s]\n' "$DOMAIN" >> "$TMPFILE"
      cat "$RULES_FILE" >> "$TMPFILE"
    fi

    # Inject the most relevant docs/solutions/ files for this domain.
    # Matching rule: a solution file matches a domain if the domain's tag appears
    # in its YAML `tags:` frontmatter line (whole-word match). This is the simplest
    # concrete rule the schema supports — `tags` is required on every solution file.
    # Newest-first (filenames carry a YYYY-MM-DD suffix, so reverse-lex = recent),
    # capped at SOLUTIONS_PER_DOMAIN to bound output. Path + title only — Read the
    # file for the body, mirroring the previous TOC-not-excerpt philosophy.
    if [ -d "$SOLUTIONS_DIR" ]; then
      TAG_PATTERN=$(domain_tag_pattern "$DOMAIN")
      # Match the domain's tag on each file's `tags:` frontmatter line. The pattern
      # carries its own word boundaries (see domain_tag_pattern), so no grep -w.
      # _manifests/ files have no `tags:` line and are filtered out anyway.
      MATCHES=$(grep -rl --include='*.md' -E "^tags:.*${TAG_PATTERN}" \
        "$SOLUTIONS_DIR" 2>/dev/null | grep -v '/_manifests/' | sort -r | head -n "$SOLUTIONS_PER_DOMAIN" || true)
      if [ -n "$MATCHES" ]; then
        printf '\n[SOLUTIONS — %s (Read the file for the full body)]\n' "$DOMAIN" >> "$TMPFILE"
        while IFS= read -r SOL_FILE; do
          [ -n "$SOL_FILE" ] || continue
          SOL_REL="${SOL_FILE#"$PROJECT_ROOT"/}"
          SOL_TITLE=$(grep -m1 -E '^title:' "$SOL_FILE" 2>/dev/null \
            | sed -E 's/^title:[[:space:]]*//; s/^"//; s/"$//' || true)
          printf -- '- %s — %s\n' "$SOL_REL" "${SOL_TITLE:-untitled}" >> "$TMPFILE"
        done <<< "$MATCHES"
      fi
    fi
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
