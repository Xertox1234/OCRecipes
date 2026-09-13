#!/usr/bin/env bash
# PreCompact — build a verification-ledger digest for injection after compaction.
#
# Two INDEPENDENT tiers (spec §3 decision 3):
#   curated   — claims paired with the command that established them (ledger-note.sh)
#   mechanical— commands that RAN, extracted from the transcript. NOT a verification tier.
# Independent inputs mean either can be absent; both absent yields an empty digest, which
# is the one deliberate silent case (spec §9).
#
# Fail-open: every failure path exits 0 with no output (spec §7).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
# shellcheck source=lib/context-ledger-path.sh
. "$SCRIPT_DIR/lib/context-ledger-path.sh" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null) || exit 0
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
LEDGER_DIR=$(context_ledger_dir "$SID") || exit 0

# --- Transcript resolution chain (spec §4.2) --------------------------------
# 1) stdin  2) cwd-INDEPENDENT glob, newest-mtime candidate wins  3) none.
# The glob is required rather than a computed path: the project dir is cwd-derived and
# moves on worktree entry, so a computed path misses exactly the worktree-heavy sessions
# this project runs. A session can leave stale transcripts under more than one project dir
# (main checkout plus worktrees); picking the lexicographically-first match can pick a
# stale one, defeating the point of the glob, so every candidate is compared and the most
# recently modified one wins.
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$TRANSCRIPT" ] || [ ! -r "$TRANSCRIPT" ]; then
  TRANSCRIPT=""
  BEST_MTIME=-1
  for cand in "$HOME"/.claude/projects/*/"$SID".jsonl; do
    [ -r "$cand" ] || continue
    CAND_MTIME=$(stat -f %m "$cand" 2>/dev/null) || CAND_MTIME=$(stat -c %Y "$cand" 2>/dev/null) || CAND_MTIME=0
    case "$CAND_MTIME" in ''|*[!0-9]*) CAND_MTIME=0 ;; esac
    if [ "$CAND_MTIME" -gt "$BEST_MTIME" ]; then
      BEST_MTIME=$CAND_MTIME
      TRANSCRIPT="$cand"
    fi
  done
fi

CURATED=""
# Bounded at 2048 bytes, keeping the MOST RECENT entries. The curated tier grows one line
# per ledger-note.sh call and is otherwise unbounded. `tail -c 2048` is a byte cut, so when
# it actually truncates the file it can land mid-line; `tail -n +2` then drops that partial
# first line. Only applied when the file is actually larger than the window — otherwise a
# small curated.md would lose its genuine first line for no reason.
if [ -r "$LEDGER_DIR/curated.md" ]; then
  # `wc -c` pads its number with leading spaces (BSD and GNU both), which the digit-only
  # guard below would otherwise treat as "not a number" and zero out — silently disabling
  # this whole check. Strip whitespace before validating.
  CSIZE=$(wc -c < "$LEDGER_DIR/curated.md" 2>/dev/null | tr -d '[:space:]') || CSIZE=0
  case "$CSIZE" in ''|*[!0-9]*) CSIZE=0 ;; esac
  if [ "$CSIZE" -gt 2048 ]; then
    # `tail -n +2` drops the partial first line — but when that ONE partial line is the
    # entire 2048-byte window (a single curated row over 2048 bytes on its own), dropping
    # it leaves nothing. A row that big already can't be salvaged as a clean line, but an
    # empty curated tier is worse: it silently discards every other (intact) row that
    # fits in the window too. Fall back to the raw cut rather than lose the whole tier.
    CUT=$(tail -c 2048 "$LEDGER_DIR/curated.md" 2>/dev/null)
    CURATED=$(printf '%s\n' "$CUT" | tail -n +2)
    [ -n "$CURATED" ] || CURATED="$CUT"
  else
    CURATED=$(cat "$LEDGER_DIR/curated.md" 2>/dev/null)
  fi
fi

FLOOR=""
if [ -n "$TRANSCRIPT" ]; then
  # One line per Bash call: description and command, both clamped. Read as raw lines (`-R`)
  # and parse each with `fromjson?` so one malformed line degrades instead of aborting
  # extraction of every record after it — feeding the whole file to a plain `jq -r` parses
  # it as one JSON stream, and a parse error partway through silently drops every record
  # that follows. `// ""` on .input.command mirrors the guard .input.description already
  # had, so a Bash record missing a command degrades instead of erroring. The second
  # `// ""` after the index matters too: `"" | split("\n")` is `[]` in jq, so indexing `[0]`
  # on a missing command is an out-of-bounds `null` — without this guard the floor line
  # would show the literal text "null" instead of degrading cleanly to empty.
  # `tail -n 12` mirrors session-recent-issues.sh's cap; dedup via awk keeps repeats out.
  # Reversed first (pure-awk reverse — no GNU `tac`, and BSD `tail -r` doesn't exist on the
  # ubuntu-latest CI runner this hook's own tests run under; CI has no prior tail -r/tac use
  # to fall back on) so awk's "keep first occurrence" keeps each distinct command's MOST
  # RECENT run, not its earliest; capping via awk (not `head`, which can exit before
  # draining its stdin and hand the writer SIGPIPE under `pipefail`) then keeps by true
  # recency; the trailing reverse restores chronological (oldest-of-the-kept-first) order.
  rev_lines() { awk '{ a[NR]=$0 } END { for (i=NR; i>=1; i--) print a[i] }'; }
  FLOOR=$(jq -R -r '
      fromjson?
      | select(.type=="assistant")
      | .message.content[]?
      | select(.type=="tool_use" and .name=="Bash")
      | "  \((.input.description // "(no description)") | .[0:60]) ← \((.input.command // "") | split("\n")[0] // "" | .[0:100])"
    ' "$TRANSCRIPT" 2>/dev/null | rev_lines | awk '!seen[$0]++' | awk 'NR<=12' | rev_lines)
fi

# Both tiers empty -> write nothing. Spec §9: emitting "nothing captured" would spend
# post-compact budget to convey no information.
if [ -z "$CURATED" ] && [ -z "$FLOOR" ]; then
  exit 0
fi

# --- Assemble, then measure (spec §5.2's 4KB hard cap) -----------------------
# A cap enforced only on the INPUTS (tail -c 2048, tail -n 12, per-field clamps) is only as
# good as the arithmetic behind it — that arithmetic assumed the floor stays ~1.8KB, and a
# realistic fixture (long-but-legal descriptions, 12 distinct Bash calls) broke it: 4329
# bytes against the 4096 cap. The bound that can't be defeated by an input the arithmetic
# failed to anticipate is one measured on the assembled OUTPUT: build the digest, measure
# it, and while it's still over cap drop the oldest FLOOR row first (mechanical, disposable
# scaffolding) — only once the floor is exhausted does the oldest CURATED row (verified
# fact) start giving way. Re-measure after every drop; write only once it fits.
assemble_digest() {
  echo "[CONTEXT LEDGER — verification state carried across compaction]"
  # If a later PreCompact run exits without writing (both tiers empty, or a timeout), this
  # file is left in place and gets injected as though it were current. It's still a real,
  # true digest of an earlier compaction — worth keeping (fail-open asymmetry) — but a
  # reader needs to be able to tell it's stale, hence the timestamp.
  echo "Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Native compaction preserves the narrative. This carries what it cannot: which"
  echo "facts were MEASURED vs ASSUMED. Re-verify before relying on an ASSUMED line."
  if [ -n "$CURATED" ]; then
    echo ""
    printf '%s\n' "$CURATED"
  fi
  if [ -n "$FLOOR" ]; then
    echo ""
    echo "MECHANICAL FLOOR — commands run this session (most recent 12)"
    echo "NOTE: these record what RAN, not what was concluded. Not a verification tier."
    printf '%s\n' "$FLOOR"
  fi
  echo ""
  echo "Full history: session ${SID} — glob ~/.claude/projects/*/${SID}.jsonl"
  echo "(the recorded path may not resolve if this session entered a worktree)"
}

digest_size() {
  # Same leading-space padding from `wc -c` applies here; strip it before the caller's
  # digit-only guard runs, or the measured-trim loop below never sees a size over the cap.
  printf '%s\n' "$1" | wc -c | tr -d '[:space:]'
}

DIGEST=$(assemble_digest)
DSIZE=$(digest_size "$DIGEST") || DSIZE=0
case "$DSIZE" in ''|*[!0-9]*) DSIZE=0 ;; esac

while [ "$DSIZE" -gt 4096 ]; do
  if [ -n "$FLOOR" ]; then
    FLOOR=$(printf '%s\n' "$FLOOR" | tail -n +2)
  elif [ -n "$CURATED" ]; then
    CURATED=$(printf '%s\n' "$CURATED" | tail -n +2)
  else
    break
  fi
  DIGEST=$(assemble_digest)
  DSIZE=$(digest_size "$DIGEST") || DSIZE=0
  case "$DSIZE" in ''|*[!0-9]*) DSIZE=0 ;; esac
done

mkdir -p "$LEDGER_DIR" 2>/dev/null || exit 0
# Write to a temp file and rename into place: a kill mid-write (e.g. a timeout) cannot
# leave a truncated resume.md that the reader's `[ -s ]` check would accept as whole.
printf '%s\n' "$DIGEST" > "$LEDGER_DIR/resume.md.tmp" 2>/dev/null || exit 0
mv "$LEDGER_DIR/resume.md.tmp" "$LEDGER_DIR/resume.md" 2>/dev/null || exit 0

exit 0
