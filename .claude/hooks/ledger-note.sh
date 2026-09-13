#!/usr/bin/env bash
# Append one row to the CURRENT session's curated ledger.
#
#   ledger-note.sh VERIFIED "<claim>" "<command that established it>"
#   ledger-note.sh ASSUMED  "<claim>" "<why it is not measured>"
#
# Pairs a claim with its evidence at the moment the claim is made — the thing a prose
# compaction summary structurally cannot carry. Unlike the hooks this is INTERACTIVE:
# it returns non-zero and explains itself, because a silent failure here means the
# curated tier is quietly empty at compact time.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
# shellcheck source=lib/context-ledger-path.sh
. "$SCRIPT_DIR/lib/context-ledger-path.sh" || exit 1

TIER="${1:-}"; CLAIM="${2:-}"; EVIDENCE="${3:-}"

case "$TIER" in
  VERIFIED|ASSUMED) ;;
  *) echo "usage: ledger-note.sh VERIFIED|ASSUMED \"<claim>\" \"<evidence>\"" >&2; exit 1 ;;
esac

if [ -z "$CLAIM" ] || [ -z "$EVIDENCE" ]; then
  echo "ledger-note: claim and evidence are both required" >&2
  exit 1
fi

# The row format is a contract: one row is one line, and precompact-ledger.sh's byte-cut
# recovery and trim loop both assume that. A newline inside claim or evidence would turn
# one logical row into several physical lines, silently corrupting that assumption.
case "$CLAIM$EVIDENCE" in
  *$'\n'*) echo "ledger-note: claim and evidence must be single-line" >&2; exit 1 ;;
esac

SID="${CLAUDE_CODE_SESSION_ID:-}"
LEDGER_DIR=$(context_ledger_dir "$SID") || {
  echo "ledger-note: no usable CLAUDE_CODE_SESSION_ID; refusing to guess a ledger key" >&2
  exit 1
}

mkdir -p "$LEDGER_DIR" || exit 1
printf '%s | %s | %s\n' "$TIER" "$CLAIM" "$EVIDENCE" >> "$LEDGER_DIR/curated.md" || exit 1
