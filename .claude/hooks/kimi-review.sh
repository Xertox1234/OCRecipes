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

# 6) Map staged files to review patterns
PATTERNS=''
add_pattern() {
  case ",$PATTERNS," in
    *,$1,*) ;;
    *) PATTERNS="${PATTERNS:+$PATTERNS,}$1" ;;
  esac
}

while IFS= read -r file; do
  case "$file" in
    server/routes/*)
      add_pattern api; add_pattern security; add_pattern architecture ;;
    server/storage/*|shared/schema.ts|migrations/*)
      add_pattern database; add_pattern security; add_pattern architecture ;;
    server/middleware/*)
      add_pattern security; add_pattern api ;;
    server/services/photo-analysis.ts|server/services/nutrition-coach.ts|server/services/recipe-chat.ts|server/services/recipe-generation.ts)
      add_pattern ai-prompting; add_pattern architecture ;;
    evals/*)
      add_pattern ai-prompting; add_pattern testing ;;
    server/services/*)
      add_pattern architecture ;;
    client/screens/*|client/navigation/*)
      add_pattern react-native; add_pattern design-system; add_pattern accessibility ;;
    client/components/*)
      add_pattern react-native; add_pattern design-system; add_pattern accessibility; add_pattern performance ;;
    client/hooks/*)
      add_pattern hooks; add_pattern client-state; add_pattern react-native; add_pattern accessibility ;;
    client/context/*)
      add_pattern client-state ;;
    client/lib/*)
      add_pattern client-state ;;
    client/constants/theme.ts|design_guidelines.md)
      add_pattern design-system ;;
    .github/workflows/*)
      add_pattern architecture; add_pattern testing ;;
    vitest.config.*|eslint.config.*)
      add_pattern testing; add_pattern typescript ;;
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/__tests__/*)
      add_pattern testing ;;
  esac
  case "$file" in
    *.ts|*.tsx) add_pattern typescript ;;
  esac
done <<< "$FILES"

# 7) Run review on the staged TypeScript diff. Only CRITICAL + WARNING (project convention).
REVIEW_DIFF=$(git diff --cached --diff-filter=ACMDR -- '*.ts' '*.tsx')
[ -n "$REVIEW_DIFF" ] || exit 0

if [ -n "$PATTERNS" ]; then
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" \
    --profile ocrecipes \
    --patterns "$PATTERNS" \
    --rules "$PATTERNS" \
    --pattern-max-chars 12000 \
    --tiers CRITICAL,WARNING 2>&1)
else
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" \
    --profile ocrecipes \
    --tiers CRITICAL,WARNING 2>&1)
fi

# 8) Detect CRITICAL findings by matching the tool's MANDATED finding shape, not
#    by keyword. kimi-review instructs the model to format every finding exactly
#    as `[CRITICAL] path/to/file.ts:42 — description`, so a real finding always
#    carries a `:<line-number>` after the tag. A clean review has no such line.
#    Earlier fixes keyed detection on a guess about the tool's clean-output
#    phrasing (first the bare word `CRITICAL`, then a `[CRITICAL]` tag minus a
#    "no findings" substring). Both broke because an LLM phrases a clean tier
#    freely — the model ignores "omit empty tiers" and emits a bracketed
#    `[CRITICAL] No critical issues found.` placeholder, which the prose exclude
#    ("no findings") never matched. Keying on the finding shape sidesteps every
#    clean phrasing: a placeholder has no `path:line`, so it cannot match.
#    The pattern: `[CRITICAL]` tag, then non-colon chars (the path), then `:` and
#    a digit (the line number). It is deliberately NOT anchored to line start so
#    an LLM-decorated finding ("- [CRITICAL] ...", "**[CRITICAL]** ...") still
#    fails closed. Literal brackets use POSIX bracket-expression escaping
#    (`[[]`, `[]]`), portable across GNU and BSD grep without a GNU ERE extension.
#    Trade-off: a malformed real finding that omits the line number would fail
#    OPEN (not block) — acceptable because it still surfaces in additionalContext
#    below, and it matches the existing precedent that a bare `[CRITICAL]` tag
#    does not block. Do not "fix" this back to prose matching.
#    The result is captured (not piped into `grep -q`) so grep does not exit
#    early — under `set -o pipefail` an early `-q` exit can SIGPIPE the upstream
#    process and surface a non-zero pipeline status that would silently skip the block.
CRITICAL_FINDINGS=$(printf '%s\n' "$REVIEW" \
  | grep -E '[[]CRITICAL[]][^:]*:[0-9]')
if [ -n "$CRITICAL_FINDINGS" ]; then
  # Block the commit and feed the full review body back to the model so it
  # can decide whether to amend, abort, or override.
  REASON=$(printf 'kimi-review blocked the commit — CRITICAL finding present.\n\n%s\n\n%s' \
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
