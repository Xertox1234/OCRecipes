#!/usr/bin/env bash
# SessionStart hook — inject a directive to warm the TypeScript LSP before first
# use. A shell hook cannot call the model-invoked LSP tool, so this automates the
# instruction; the model's first hover does the actual warming.
set -uo pipefail

MSG=$(cat <<'EOF'
[LSP warm-up] Your FIRST LSP action this session should be a throwaway `hover` on
a stable TypeScript symbol (e.g. a method in server/storage/index.ts, or
client/constants/theme.ts:210 withOpacity) to build the tsserver project graph.
The first findReferences/call-hierarchy is otherwise unreliable — if a result
looks impossibly small, re-run it once. Prefer the LSP tool over grep for symbol
work (see docs/rules/lsp.md).
EOF
)

jq -n --arg ctx "$MSG" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
