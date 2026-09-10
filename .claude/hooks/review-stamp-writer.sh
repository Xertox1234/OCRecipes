#!/usr/bin/env bash
# SubagentStop — write ONE review stamp per reviewer subagent.
#
# Registered in .claude/settings.json with an agent_type matcher so it fires only for
# roster reviewers. The orchestrating agent can neither invoke nor suppress this hook —
# that is the entire point (spec §2.2): evidence the agent did not author.
#
# THIS HOOK MUST NEVER RUN git. A dispatched reviewer does not inherit the orchestrator's
# worktree cwd (docs/AI_WORKFLOW.md:40) and this hook fires in that same ambient context,
# so `git rev-parse HEAD` here would read the MAIN CHECKOUT — plausible-looking and
# silently wrong. Every field below is ASSERTED by the reviewer and BOUND by the merge
# gate's comparison against the real PR head. That makes a stale or mis-scoped review
# detectable; it does not make a fabricated one detectable.
#
# Fail-silent: any missing tool or unparseable payload exits 0 writing nothing. A missing
# stamp denies the merge (fail-closed at the gate), so silence here is the safe direction.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)

AGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.agent_type // empty' 2>/dev/null) || exit 0
[ -n "$AGENT_TYPE" ] || exit 0
# Defend the path segment: agent_type becomes a filename.
case "$AGENT_TYPE" in *[!a-zA-Z0-9_-]*) exit 0 ;; esac

# last_assistant_message is the documented shortcut — its own describe string says it
# "Avoids the need to read and parse the transcript file". Fall back to the transcript
# when it is absent (truncation, reformatting).
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)
if [ -z "$MSG" ]; then
  TP=$(printf '%s' "$INPUT" | jq -r '.agent_transcript_path // empty' 2>/dev/null)
  if [ -n "$TP" ] && [ -r "$TP" ]; then
    MSG=$(jq -rs '[.[] | select(.type=="assistant")] | last | .message.content[]?
                  | select(.type=="text") | .text' "$TP" 2>/dev/null) || MSG=""
  fi
fi
[ -n "$MSG" ] || exit 0

# --- parse the contract (docs/AI_WORKFLOW.md:49) -------------------------------
SHA=$(printf '%s\n' "$MSG" \
      | sed -n 's/^REVIEWED-SHA:[[:space:]]*\([0-9a-f]\{7,40\}\).*/\1/p' | head -1)
[ -n "$SHA" ] || exit 0

# Everything between REVIEWED-FILES: and the first findings line / blank-line boundary.
# Blank lines inside the block are SKIPPED, not a terminator (docs/AI_WORKFLOW.md's
# reviewer contract deliberately does not require "no blank lines inside the block" —
# confirmed non-load-bearing because this collector's NF test already tolerates them);
# only a bracketed finding or the literal "No findings." ends the block.
#
# NOTE: this parse feeds ONLY $FILES -> $DIGEST -> reviewed_files_digest. Verdict /
# CRITICAL detection (further below) never derives from $FILES or from this block
# boundary — deliberately: a reviewer who uses the unbracketed agent-definition findings
# format (no bracket, no literal "No findings.") leaves `collecting` on, so a finding
# line gets swallowed into $FILES here. That only corrupts the digest, which then
# mismatches Task 5's independent recomputation and DENIES the merge — fail-closed,
# confusing, safe. Coupling CRITICAL detection to this parse (e.g. "scan whatever isn't
# in $FILES") would instead have let that same swallowed line escape detection entirely
# — fail-open, the one direction this mechanism must never take.
FILES=$(printf '%s\n' "$MSG" | awk '
  /^REVIEWED-FILES:/ { collecting=1; next }
  collecting && /^\[(CRITICAL|WARNING|SUGGESTION)\]/ { collecting=0 }
  collecting && /^No findings\.?$/                   { collecting=0 }
  collecting && NF                                    { print }
' | sort -u)
[ -n "$FILES" ] || exit 0

DIGEST=$(printf '%s\n' "$FILES" | shasum 2>/dev/null | cut -c1-16)
[ -n "$DIGEST" ] || exit 0

# --- union CRITICAL detection (over-detect on purpose) ------------------------
# The five roster reviewer definitions (.claude/agents/{code-reviewer,server-reviewer,
# mobile-reviewer,ai-reviewer,security-auditor}.md) each mandate their OWN findings
# format — `file:line — issue — concrete fix`, severity-tagged CRITICAL/WARNING/
# SUGGESTION, no brackets required — independent of the dispatch prompt's bracketed
# `[CRITICAL] path:line — text` request. A reviewer may follow either. Matching only the
# bracketed form (`grep -E '^\[CRITICAL\]'`) misses the agent-definition rendering
# entirely and would record `verdict: clean` on genuine CRITICAL findings — fail-open.
#
# Fix: match a STANDALONE CRITICAL token anywhere on a line (word-bounded via a
# bracket-class boundary, not `\b` — BSD grep on macOS doesn't support `\b`), which
# catches both renderings by construction — no special-casing the brackets needed — plus
# any other position a reviewer's own prose puts the tag in.
#
# That alone would also match a REVIEWED-FILES entry whose path happens to contain the
# word (e.g. `client/hooks/CRITICAL.ts`). Excluded not by scoping to a parsed region (see
# the note above the $FILES parse for why that reopens the fail-open) but by SHAPE: the
# task-3 contract requires a REVIEWED-FILES line be a bare path with no whitespace at all
# ("no leading whitespace, bullets, numbering, backticks, or trailing commentary").
#
# A single "no whitespace at all" exclusion is NOT enough on its own — constructing the
# adversarial input (not just measuring real transcripts, see
# docs/solutions/logic-errors/union-over-renderings-does-not-cover-selection-within-one-2026-09-07.md)
# finds one immediately: a hyphen-packed finding line with no spaces at all, e.g.
# `server/foo.ts:10-CRITICAL-missing-check`, would read as "bare-path shaped" and get
# excluded — fail-open on exactly the line this widening exists to catch. So a candidate
# is excluded only when it has BOTH no whitespace AND no `file:line` colon-digit citation
# — the one structural element BOTH documented formats require in a finding line
# (`file:line — issue — concrete fix`) and that no real path in this repo's naming
# convention ever contains. Either signal alone keeps the line in play.
#
# DIRECTION: when in doubt, over-detect. A false "findings" blocks a merge and a human
# unblocks it; a false "clean" ships unreviewed code past the gate. This also fires on
# prose that merely mentions the word CRITICAL (e.g. "No CRITICAL issues found.") — a
# deliberate choice, pinned by this writer's own test suite, not an oversight.
CRITICALS=$(printf '%s\n' "$MSG" \
  | grep -E '(^|[^A-Za-z0-9_])CRITICAL($|[^A-Za-z0-9_])' \
  | grep -E '[[:space:]]|:[0-9]' || true)

# `clean` must be a POSITIVE signal, never the absence of one. The earlier `else clean`
# fallback made every non-review cause of a missing/mismatched CRITICAL tag — transcript
# truncation landing exactly at the header (the contract puts REVIEWED-SHA/FILES FIRST),
# an untagged or wrongly-cased severity marker, a bracketed WARNING that correctly
# terminates the FILES parse while the real finding goes unmatched — read as a permissive
# `clean` record. docs/AI_WORKFLOW.md's contract is explicit: "If there are no issues,
# write exactly: No findings." A message with neither a matched CRITICAL nor that literal
# line is not a contract-compliant review, so it gets NO stamp (fail-closed at the gate)
# rather than a manufactured `clean`.
#
# Plain (non -q/-m) grep here reads its entire input before exiting — no early-exit
# SIGPIPE risk under `pipefail` from a large message (contrast the `grep -oE | grep -Eq`
# shape that IS unsafe: docs/solutions/logic-errors/
# union-over-renderings-does-not-cover-selection-within-one-2026-09-07.md).
if [ -n "$CRITICALS" ]; then
  VERDICT=findings
elif printf '%s\n' "$MSG" | grep -E '^No findings\.?$' >/dev/null 2>&1; then
  VERDICT=clean
else
  exit 0   # no findings section -> not a contract-compliant review -> write nothing
fi

# --- write -------------------------------------------------------------------
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
. "$HERE/lib/review-stamp-path.sh" 2>/dev/null || exit 0
declare -F review_stamp_dir >/dev/null || exit 0

DIR=$(review_stamp_dir "$SHA") || exit 0
mkdir -p "$DIR" 2>/dev/null || exit 0

# `unresolved` is kept as the field name the brief's Task 4/5 interface already documents
# (Task 5 recomputes/consumes it under this name) — but its CONTENTS are wider than the
# name suggests: every line that survived the union-CRITICAL detection above, i.e. every
# line that caused VERDICT=findings. That can be a bracketed `[CRITICAL] ...` finding, an
# unbracketed agent-definition finding, or — by the over-detect direction this writer
# deliberately takes — a bare sentence of prose that merely mentions the word CRITICAL.
# Do not read a non-empty `unresolved` as "the list of CRITICAL findings" and do not
# filter/render it assuming every entry is a `file:line — issue — fix` shape; a consumer
# that does (e.g. `select(startswith("[CRITICAL]"))`) will silently see it as empty on a
# genuine agent-definition or prose trigger and treat a findings verdict as clean.
jq -n \
  --arg sha "$SHA" --arg digest "$DIGEST" --arg type "$AGENT_TYPE" \
  --arg verdict "$VERDICT" --arg criticals "$CRITICALS" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
     head_sha: $sha,
     reviewed_files_digest: $digest,
     agent_type: $type,
     verdict: $verdict,
     unresolved: ($criticals | if . == "" then [] else split("\n") | map(select(. != "")) end),
     written_by: "review-stamp-writer.sh",
     written_at: $at
   }' > "$DIR/${AGENT_TYPE}.json" 2>/dev/null || exit 0

exit 0
