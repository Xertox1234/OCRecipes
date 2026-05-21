#!/usr/bin/env bash
# Fails if any symbol-working agent's LSP block diverges from the canonical copy
# in docs/rules/lsp.md (compared between the LSP-AGENT-BLOCK markers).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/rules/lsp.md"
AGENTS=(code-reviewer architecture-specialist database-specialist api-specialist \
        performance-specialist typescript-specialist security-auditor \
        todo-executor todo-researcher)

extract() {
  awk '/<!-- LSP-AGENT-BLOCK:START -->/{f=1;next} /<!-- LSP-AGENT-BLOCK:END -->/{f=0} f' "$1"
}

BLOCK="$(extract "$SRC")"
if [ -z "$BLOCK" ]; then
  echo "ERROR: canonical LSP block not found in $SRC" >&2
  exit 1
fi

FAIL=0
for a in "${AGENTS[@]}"; do
  FILE="$ROOT/.claude/agents/$a.md"
  if [ ! -f "$FILE" ]; then
    echo "DRIFT: $a.md not found" >&2; FAIL=1; continue
  fi
  if [ "$(extract "$FILE")" != "$BLOCK" ]; then
    echo "DRIFT: $a.md LSP block missing or divergent — re-sync from docs/rules/lsp.md" >&2
    FAIL=1
  fi
done

[ "$FAIL" -eq 0 ] && echo "LSP agent block: all 9 in sync"
exit $FAIL
