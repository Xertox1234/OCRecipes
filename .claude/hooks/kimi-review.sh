#!/usr/bin/env bash
# PreToolUse hook for Bash — when the about-to-run command is a real `git commit`,
# run kimi-review over the staged diff. CRITICAL findings block the commit;
# WARNING findings are surfaced as additionalContext but do not block.
#
# Skip semantics (all early exit 0, silently):
#   - $SKIP_KIMI_REVIEW=1                 → user opt-out (CI, rebases, known-good)
#   - `kimi-review` not on PATH            → dev without the tool installed
#   - `jq` not on PATH                     → cannot parse hook event or build JSON safely

set -uo pipefail

# 1) Explicit opt-out
[ -n "${SKIP_KIMI_REVIEW:-}" ] && exit 0

# 2) Required tooling — auto-skip if missing
command -v jq >/dev/null 2>&1 || exit 0
command -v kimi-review >/dev/null 2>&1 || exit 0

# 3) Read the hook event JSON and extract the pending Bash command
INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# 4) Match only real `git commit` invocations. Anchored at ^ so substrings like
#    `echo git commit ...` are rejected; trailing ([[:space:]]|$) so `commit-graph`
#    and other `commit*` subcommands are rejected. Allows leading VAR=val env
#    prefixes and `git -c key=val commit ...` chains.
GIT_COMMIT_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
[[ "$COMMAND" =~ $GIT_COMMIT_RE ]] || exit 0

# 5) No staged TypeScript changes → nothing to review. This hook deliberately
# excludes docs/config/env diffs from the external reviewer so accidental
# secret-bearing staged files are not transmitted as review input.
FILES=$(git diff --cached --name-only --diff-filter=ACMDR 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
[ -n "$FILES" ] || exit 0

# Full change-set (all files, with status) for the <changed-files> manifest.
# Separate from FILES (which is .ts/.tsx-only for the guard + pattern loop) so
# the reviewer can see non-code files (migrations, config) without those files
# entering pattern selection or being sent as content.
CHANGED_FILES=$(git diff --cached --name-status --diff-filter=ACMDR 2>/dev/null || true)

# 6) Map staged files to review patterns
PATTERNS=''
add_pattern() {
  case ",$PATTERNS," in
    *,$1,*) ;;
    *) PATTERNS="${PATTERNS:+$PATTERNS,}$1" ;;
  esac
}
_add() { add_pattern "$1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/domain-map.sh
source "$SCRIPT_DIR/lib/domain-map.sh"

while IFS= read -r file; do
  apply_domain_map "$file"
  case "$file" in
    *.ts|*.tsx) add_pattern typescript ;;
  esac
done <<< "$FILES"

# 7) Run review on the staged TypeScript diff. Only CRITICAL + WARNING (project convention).
REVIEW_DIFF=$(git diff --cached --function-context --diff-filter=ACMDR -- '*.ts' '*.tsx')
[ -n "$REVIEW_DIFF" ] || exit 0

if [ -n "$PATTERNS" ]; then
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" \
    --profile ocrecipes \
    --verify deterministic \
    --patterns "$PATTERNS" \
    --rules "$PATTERNS" \
    --pattern-max-chars 12000 \
    --changed-files "$CHANGED_FILES" \
    --tiers CRITICAL,WARNING 2>&1)
else
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" \
    --profile ocrecipes \
    --verify deterministic \
    --changed-files "$CHANGED_FILES" \
    --tiers CRITICAL,WARNING 2>&1)
fi
REVIEW_STATUS=$?

# 8) Block only on the engine's blocking exit code (2 = a CRITICAL survived
#    verification). Exit 0 = clean or non-blocking findings; any other non-zero =
#    tool error (timeout, missing key) which falls through to additionalContext
#    (fail-open) rather than blocking. The engine now emits structured findings
#    and owns the blocking decision, so the wrapper no longer parses prose.
if [ "$REVIEW_STATUS" -eq 2 ]; then
  # Block the commit and feed the full review body back to the model so it
  # can decide whether to amend, abort, or override.
  REASON=$(printf 'kimi-review blocked the commit — verified CRITICAL finding present.\n\n%s\n\n%s' \
    "${PATTERNS:+patterns: $PATTERNS}" \
    "$REVIEW")
  jq -n --arg reason "$REASON" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason}}'
  exit 0
fi

# 9) No CRITICAL — surface review (including any WARNING) as additionalContext.
jq -n --arg r "$REVIEW" --arg p "$PATTERNS" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":((if ($p | length) > 0 then "kimi-review patterns: " + $p + "\n" else "" end) + "kimi-review findings (WARNING is non-blocking; CRITICAL would have blocked):\n" + $r)}}' \
  2>/dev/null || true
exit 0
