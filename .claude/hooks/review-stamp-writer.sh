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
# A THIRD signal is needed alongside those two: a bare bracketed severity tag alone on
# its own line (`[CRITICAL]` with nothing else on the line) has neither whitespace nor a
# `:digit` citation, so it was being dropped even though it is unambiguous and safe to
# admit. It can never be a REVIEWED-FILES path — not because paths don't contain `[`/`]`,
# but because the $FILES awk above terminates collection the moment it sees a line
# matching `^\[(CRITICAL|WARNING|SUGGESTION)\]`, so a bracket-only line is never collected
# as a file in the first place. It CAN be ordinary prose — a reviewer quoting the three
# severity tags as a bare list produces exactly this shape, and that flips a genuinely
# clean review to `findings`; that is the over-detect DIRECTION below working as intended,
# not a false premise this widening depends on. Widened narrowly to exactly this shape,
# not to "any bracket-containing line", so it can't be tricked into swallowing something
# else.
#
# DIRECTION: when in doubt, over-detect. A false "findings" blocks a merge and a human
# unblocks it; a false "clean" ships unreviewed code past the gate. This also fires on
# prose that merely mentions the word CRITICAL (e.g. "No CRITICAL issues found.") — a
# deliberate choice, pinned by this writer's own test suite, not an oversight.
CRITICALS=$(printf '%s\n' "$MSG" \
  | grep -E '(^|[^A-Za-z0-9_])CRITICAL($|[^A-Za-z0-9_])' \
  | grep -E '[[:space:]]|:[0-9]|^\[CRITICAL\]$' || true)

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
# The literal match must be ANCHORED TO THE LAST NON-EMPTY LINE, not accepted anywhere in
# the message. A round-1 version that searched the whole message was still fail-open with
# a CORRECT digest: a reviewer quoting the contract mid-review (while reviewing this very
# hook, or docs/AI_WORKFLOW.md) writes a stray standalone "No findings." line that is NOT
# the review's actual conclusion, and that stray line alone flipped a real, unmatched
# finding to verdict:clean. A genuine clean review's LAST line is that sentence; a review
# that found something ends with its findings, not with a quotation of the contract typed
# earlier. Computed via awk (not the last line of the file, the last NON-EMPTY line, so a
# trailing blank after "No findings." can't defeat this).
#
# The anchor is itself a NEW false-deny surface, and round 3 exists because of it: every
# roster reviewer definition (`docs/AI_WORKFLOW.md` -> `.claude/agents/code-reviewer.md`
# "Report" step) is required to place any patterns/notes list ABOVE "No findings.", never
# below — but the literal comparison below is still exact apart from ONE stripped
# dimension (this line's own trailing whitespace/CR), so a genuinely clean review can still
# be denied by something as small as an editor-appended trailing space on the line itself.
# Strip that one dimension before comparing — it costs nothing in the fail-open direction,
# since a message that fails this comparison still only denies (see the RESIDUAL comment
# below for what is NOT stripped and still denies).
LAST_LINE=$(printf '%s\n' "$MSG" | awk 'NF{last=$0} END{print last}')
LAST_LINE=${LAST_LINE%$'\r'}
LAST_LINE=${LAST_LINE%"${LAST_LINE##*[![:space:]]}"}
if [ -n "$CRITICALS" ]; then
  VERDICT=findings
elif [ "$LAST_LINE" = "No findings." ] || [ "$LAST_LINE" = "No findings" ]; then
  VERDICT=clean
else
  exit 0   # no findings section -> not a contract-compliant review -> write nothing
fi

# RESIDUALS — named explicitly, by CLASS, not by instance:
#
# 1. Last-line FORGERY (fail-open, narrow): a message whose LAST non-empty line is exactly
#    "No findings." (or "No findings") is trusted as clean regardless of what precedes it —
#    a reviewer that emits a real, unmatched finding earlier and then, for any reason, ends
#    its reply with that literal line still reads as clean. Narrowed from "any line" to
#    "the last line" by round 2, not closed.
#
# 2. False-DENY class (fail-closed, the class round 3 exists to name — its first instance
#    was this round's own CRITICAL finding, the always-dispatched baseline reviewer's own
#    mandated output shape denying every clean merge): the clean path requires "No
#    findings." (or "No findings") to be the message's final non-empty line, verbatim once
#    that one line's own trailing whitespace/CR is stripped, so any other deviation —
#    leading indentation before the literal, a trailing closing fence, or any trailing
#    prose after it — still makes an otherwise-genuinely-clean review write no stamp and
#    deny (safe, fail-closed, but a real class, not a hypothetical one).
#
# 3. Pre-existing gate-blindness: a review whose only findings are WARNING/SUGGESTION tags
#    (no CRITICAL match, and the literal "No findings." is never written because real
#    issues WERE found) writes no stamp either — nothing in this file distinguishes "the
#    reviewer found only minor issues" from "the reviewer never ran." Both deny; that is
#    the same fail-closed direction as everything else here, but worth naming since a human
#    reading a denied merge has no way to tell the two apart from this stamp alone.
#
# 4. CRITICAL-detection stays case-SENSITIVE by design: "Critical"/"critical" never counts,
#    on purpose — a known, deliberate narrowing, not an oversight, and is NOT to be "fixed"
#    with `grep -Ei` (round-1 report: case-insensitivity trips on ordinary prose like "this
#    is critical for correctness" and makes `findings` near-universal).

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
