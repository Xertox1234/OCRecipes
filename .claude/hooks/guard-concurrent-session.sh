#!/usr/bin/env bash
# PreToolUse(Bash) — warn when a SECOND live Claude session is mutating the SAME working tree.
#
# Criterion #4 of todos P2 git-churn ("each agent owns its worktree / lock git-mutating ops").
# The observed corruption (core.bare flips, t@t override, reverted tracked edits) happened while
# a second agent ran in another terminal against the same checkout. The closed vectors fixed the
# *self-inflicted* causes (a non-hermetic self-test under inherited GIT_DIR); this hook covers the
# remaining one: two sessions sharing one un-isolated working tree, where either can clobber the
# other's uncommitted work and shared .git/config.
#
# A true cross-process mutex is impossible from PreToolUse (the hook returns before the command
# runs, so it cannot hold a lock across it). The only real fix is ISOLATION, not a lock — so this
# hook DETECTS the shared-tree contention and NUDGES toward a per-agent worktree. It is the
# complement of guard-worktree-isolation.sh: that hook enforces isolation once a worktree exists;
# this one flags its ABSENCE when two sessions share the main checkout.
#
# Mechanism (self-expiring lease, no SessionEnd cleanup needed):
#   - On EVERY Bash op, refresh this session's heartbeat file under a per-working-tree lease dir.
#   - On a git-MUTATOR op, if a DIFFERENT session's heartbeat is fresh (within TTL), warn ONCE.
#   - Leases age out by mtime (TTL), so a crashed/stale session stops counting on its own.
#
# Design principles (mirrors drift-detect.sh / core-bare-guard.sh):
#   - WARN, never block. A stale lease only ever costs one spurious nudge — cheap by construction.
#   - Keyed by the WORKING-TREE root (git rev-parse --show-toplevel), NOT the common .git dir:
#     two agents in SEPARATE worktrees have distinct toplevels → correctly seen as isolated → no
#     warning. Only a shared tree (same toplevel) triggers it.
#   - Keyed by session_id from the hook JSON (a session's own heartbeat never counts against it).
#   - Warn at most once per session (a .warned marker) — a single actionable nudge, not per-commit spam.
#   - Fails open on any parse / git / fs error.
# Tests: .claude/hooks/test-guard-concurrent-session.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Must be inside a git repo with a resolvable working tree.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$TOPLEVEL" ] || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
[ -n "$SESSION" ] || exit 0
# session_id is a harness-minted UUID and becomes a lease FILENAME below. A path-shaped value is
# malformed (and could escape the lease dir) — fail open rather than build a path from it.
case "$SESSION" in */*|*..*) exit 0 ;; esac

# Per-working-tree lease dir, keyed by a stable hash of the toplevel path. Use only cksum's first
# field (the checksum) — GNU coreutils appends a trailing " -" for stdin that BSD omits, so taking
# the whole line would yield different keys across toolchains for the same worktree.
KEY=$(printf '%s' "$TOPLEVEL" | cksum | awk '{print $1}')
[ -n "$KEY" ] || exit 0
LEASE_DIR="/tmp/claude-session-lease/$KEY"
mkdir -p "$LEASE_DIR" 2>/dev/null || exit 0

# Heartbeat: refresh this session's lease on every Bash op so liveness stays current.
touch "$LEASE_DIR/$SESSION" 2>/dev/null || true

# The contention WARNING only fires on ops that actually mutate shared git state — the moment of
# risk. (Same family as drift-detect-update's HEAD movers, plus the working-tree mutators.)
MUTATOR_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|push|rebase|reset|pull|merge|cherry-pick|checkout|switch|restore|clean|stash)([[:space:]]|$)'
COMPOUND_MUTATOR_RE='(&&|\|\||;)[[:space:]]*git[[:space:]]+(commit|push|rebase|reset|pull|merge|cherry-pick|checkout|switch|restore|clean|stash)([[:space:]]|$)'
if ! [[ "$CMD" =~ $MUTATOR_RE ]] && ! printf '%s' "$CMD" | grep -qE "$COMPOUND_MUTATOR_RE"; then
  exit 0
fi

# Nudge at most once per session per working tree.
WARNED="$LEASE_DIR/$SESSION.warned"
[ -f "$WARNED" ] && exit 0

# A live peer = a different session's heartbeat modified within the TTL window. Hardcoded like
# the sibling hooks: a peer idle longer than this stops counting, so a stale lease self-expires.
TTL_MIN=20
PEER_FILE=$(find "$LEASE_DIR" -maxdepth 1 -type f ! -name "$SESSION" ! -name '*.warned' -mmin "-${TTL_MIN}" 2>/dev/null | head -1)
[ -n "$PEER_FILE" ] || exit 0

touch "$WARNED" 2>/dev/null || true
PEER_ID=$(basename "$PEER_FILE")
MSG="Concurrent-session notice: another Claude session (id ${PEER_ID}) has been active in this same working tree (${TOPLEVEL}) within the last ${TTL_MIN} min, and you are about to mutate git state here. Two sessions sharing one checkout can clobber each other's uncommitted edits and shared .git/config — the P2 git-churn failure mode (core.bare flip, reverted tracked files). If this parallel work is intentional, give one agent its own worktree via the superpowers:using-git-worktrees skill so each owns an isolated checkout. (Warn-only; shown once per session.)"
jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": $m
  }
}'
exit 0
