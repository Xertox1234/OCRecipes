#!/usr/bin/env bash
# PreToolUse(Bash) — reuse-ladder nudge when a command ADDS a dependency.
#
# `npm install <pkg>` / `npm i` / `npm add`, `npx expo install <pkg>`, `yarn add`, `pnpm add`
# with at least one package argument get a one-line additionalContext asking for the ladder's
# rung-3/4 justification. Lockfile installs (`npm install`, `npm ci`, flags-only), global
# installs (`-g`/`--global`), `npm run`, and quoted mentions stay silent.
#
# Design: ADVISORY only — never emits permissionDecision; fails open and silent on any parse
# or library error. Quote-aware via lib/cmd-detect.sh's word rendering (a `-m "… npm install
# foo …"` mention is one argv word there, so it cannot spell the verb) and substitution-deep
# so `$(npm install x)` still counts. Companion: inject-patterns.sh's [DEPENDENCY] line on a
# package.json edit covers the file-edit half. Tests: test-nudge-dependency-add.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
  cmd_fastpath_has "$CMD" '*npm*' '*expo*' '*yarn*' '*pnpm*' || exit 0
fi
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_words_deep >/dev/null || exit 0

WORDS=$(cmd_words_deep "$CMD")
[ -n "$WORDS" ] || exit 0

# One invocation per line: the verb in command position, then its arguments up to the next
# separator. A package argument is a word that is not a flag. Globals are excluded in the
# flag scan, so `npm install -g eas-cli` never counts as a project dependency.
ADD_SEEN=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  # Split the line into simple commands on separators, then inspect each.
  while IFS= read -r seg; do
    seg="${seg#"${seg%%[![:space:]]*}"}"
    # Strip leading env assignments / wrappers the shell would absorb.
    while [[ "$seg" =~ ^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+(.*)$ ]]; do seg="${BASH_REMATCH[2]}"; done
    verb=""
    case "$seg" in
      "npm install "*|"npm i "*|"npm add "*) verb=npm; args="${seg#npm * }" ;;
      "npx expo install "*)                 verb=expo; args="${seg#npx expo install }" ;;
      "yarn add "*)                         verb=yarn; args="${seg#yarn add }" ;;
      "pnpm add "*)                         verb=pnpm; args="${seg#pnpm add }" ;;
      *) continue ;;
    esac
    pkg=0; global=0
    for w in $args; do
      case "$w" in
        -g|--global) global=1 ;;
        -*) ;;
        *) pkg=1 ;;
      esac
    done
    if [ "$pkg" = 1 ] && [ "$global" = 0 ]; then ADD_SEEN=1; fi
  done < <(printf '%s\n' "$line" | tr ';&|()`' '\n\n\n\n\n\n')
done <<< "$WORDS"

[ "$ADD_SEEN" = 1 ] || exit 0

jq -n --arg m '[DEPENDENCY] this command adds a package. Reuse ladder, rungs 3 and 4: say in one line why no installed dependency or platform API (Expo SDK, React Native, Node) already covers it. Never add a dependency for a few lines; if one is justified, the same PR explains it.' '{
  "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": $m }
}'
exit 0
