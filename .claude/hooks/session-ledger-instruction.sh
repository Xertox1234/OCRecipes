#!/usr/bin/env bash
# SessionStart — tell every session how and when to write a context-ledger note.
#
# Fires on EVERY source (startup/resume/clear/compact), unlike session-resume-ledger.sh:
# the curated tier fills only if the model knows ledger-note.sh exists, and before this
# hook nothing outside .claude/hooks/ named it, so the tier sat empty. On compact the
# text lands next to the restored digest, so the resumed session keeps noting.
#
# Fixed text; reads no files. The command is spelled RELATIVE and must match the
# permissions.allow rule in .claude/settings.json byte for byte: permission rules
# prefix-match the unexpanded string, and $CLAUDE_PROJECT_DIR is not exported to the
# Bash tool (measured 2026-09-26). test-context-ledger.sh pins the pairing.
#
# Fail-open: no jq -> exit 0 with no output.
set -uo pipefail

# Drain stdin so the hook runner's writer never takes SIGPIPE; the input is not needed.
cat >/dev/null 2>&1
command -v jq >/dev/null 2>&1 || exit 0

MSG=$(cat <<'EOF'
[CONTEXT LEDGER — notes that survive compaction]
At milestones, record the facts later work will rely on, one line each:
  `bash .claude/hooks/ledger-note.sh VERIFIED "<claim>" "<command that showed it>"`
  `bash .claude/hooks/ledger-note.sh ASSUMED "<claim>" "<why it is not measured>"`
Milestones: before reporting a result to the user, before a commit/PR/merge, and when the user says they are about to compact.
Run it as its own command from the repo or worktree root (cd back in a separate call if needed) — a `cd … &&` prefix misses the allow rule and prompts. Single-line fields, 500 bytes max each.
After a compaction the CONTEXT LEDGER block shows these rows; re-verify an ASSUMED row before relying on it.
EOF
)

jq -n --arg ctx "$MSG" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
