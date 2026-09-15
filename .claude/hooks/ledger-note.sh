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

# Bound each field well under precompact-ledger.sh's 2048-byte curated-tier window: a row
# that fills (or exceeds) that whole window leaves the byte-cut recovery nothing to fall
# back on but the fragment itself, and poisons every future compaction since curated.md
# only ever grows. 500 bytes each keeps even a VERIFIED row (tier + two separators) far
# under 2048. Reject here, at write time, where the author can see and fix it.
MAX_FIELD_BYTES=500
CLAIM_BYTES=$(printf '%s' "$CLAIM" | wc -c | tr -d '[:space:]') || CLAIM_BYTES=0
EVIDENCE_BYTES=$(printf '%s' "$EVIDENCE" | wc -c | tr -d '[:space:]') || EVIDENCE_BYTES=0
case "$CLAIM_BYTES" in ''|*[!0-9]*) CLAIM_BYTES=$((MAX_FIELD_BYTES+1)) ;; esac
case "$EVIDENCE_BYTES" in ''|*[!0-9]*) EVIDENCE_BYTES=$((MAX_FIELD_BYTES+1)) ;; esac
if [ "$CLAIM_BYTES" -gt "$MAX_FIELD_BYTES" ] || [ "$EVIDENCE_BYTES" -gt "$MAX_FIELD_BYTES" ]; then
  echo "ledger-note: claim and evidence must each be <= ${MAX_FIELD_BYTES} bytes (got claim=${CLAIM_BYTES}, evidence=${EVIDENCE_BYTES})" >&2
  exit 1
fi

SID="${CLAUDE_CODE_SESSION_ID:-}"
LEDGER_DIR=$(context_ledger_dir "$SID") || {
  # TWO causes now, and naming only the first sent a reader after an input that was fine:
  # either the sid is unusable (empty, `.`/`..`, or outside [A-Za-z0-9._-]), or no ledger
  # ROOT is derivable because neither an absolute XDG_STATE_HOME nor a HOME is set.
  echo "ledger-note: cannot derive a ledger path -- either CLAUDE_CODE_SESSION_ID is empty or outside [A-Za-z0-9._-], or neither an absolute XDG_STATE_HOME nor HOME is set. Refusing to guess a ledger key." >&2
  exit 1
}

# Refuse a path that is not ours before creating or appending. curated.md is the SECOND
# injection entry point, and the more permissive of the two: precompact-ledger.sh folds it
# into the digest WITHOUT passing it through redact_secrets/entropy_net — only the
# mechanical FLOOR tier is filtered — so a planted curated.md reaches additionalContext
# essentially verbatim. The field validations above (tier whitelist, single-line rule,
# 500-byte cap) are write-time hygiene for THIS writer, not a boundary: they do nothing
# about a file someone else wrote directly.
context_ledger_path_ok "$LEDGER_DIR" || exit 1
# umask 077 on the DIRECTORY and on the append below. An earlier version of this comment
# said "the directory and every file under it are ours alone" while the subshell contained
# only the mkdir -- measured, curated.md landed 0644 under umask 022 and 0664 under 002
# against a directory that was 0700 in all three. That is the same
# comment-claims-what-the-code-lacks pattern this change retired one file over, so the
# append is now inside its own umask scope and the sentence says only what is enforced.
# Both are subshell-scoped so the caller's umask is untouched.
(umask 077; mkdir -p "$LEDGER_DIR") || exit 1
context_ledger_path_ok "$LEDGER_DIR/curated.md" || exit 1
(umask 077; printf '%s | %s | %s\n' "$TIER" "$CLAIM" "$EVIDENCE" >> "$LEDGER_DIR/curated.md") || exit 1
