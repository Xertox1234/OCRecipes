#!/usr/bin/env bash
# SubagentStop — write ONE review stamp per reviewer subagent.
#
# Registered in .claude/settings.json with an agent_type matcher so it fires only for
# roster reviewers. The orchestrating agent can neither invoke nor suppress this hook —
# but do NOT read that as "evidence the agent did not author". This record is an
# unprotected JSON file at a path derivable in one command, and nothing guards the
# directory, so an agent that DECIDES to fabricate one can, in one shell redirection
# (spec §6.2, corrected 2026-09-10). What this hook actually buys: a review that was
# silently OMITTED, or ran against an earlier commit or a different file set, cannot pass
# as one that happened.
#
# THIS HOOK MUST NEVER RUN git AGAINST THE AMBIENT CWD, and must never run it at all to
# obtain a REVIEWED VALUE. A dispatched reviewer does not inherit the orchestrator's
# worktree cwd (docs/AI_WORKFLOW.md:40) and this hook fires in that same ambient context,
# so `git rev-parse HEAD` here would read the MAIN CHECKOUT — plausible-looking and
# silently wrong. (One git call does happen, at the write step: review_stamp_dir derives
# the repo KEY, not a reviewed value, and it is explicitly anchored to this script's own
# directory there rather than to the ambient cwd. See the comment at that call.)
# Every field below is ASSERTED by the reviewer and BOUND by the merge
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
# ROSTER ALLOW-LIST — spec §9 requires "a non-reviewer agent_type produces no stamp", and
# the shape check above only proves the value is a safe FILENAME, not that it names a
# reviewer. Measured: `agent_type: general-purpose` with a contract-shaped message wrote
# {"verdict":"clean"} carrying a correct digest — and the orchestrator can hand that
# message to any subagent it dispatches. .claude/settings.json's SubagentStop matcher
# already names these same five, but a matcher is CONFIGURATION: widening it, or invoking
# this hook directly, re-opens the hole silently. Enforced here as well so the two must
# BOTH be changed. Source of the roster: docs/AI_WORKFLOW.md's Review Policy.
case "$AGENT_TYPE" in code-reviewer|server-reviewer|mobile-reviewer|ai-reviewer|security-auditor) ;; *) exit 0 ;; esac

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

# Normalize CRLF once, at ingest, rather than per-consumer. A CR that survives here is
# not one symptom but three, and only the first was ever handled: (1) the verdict's
# last-line comparison sees "No findings.\r"; (2) the $FILES collector below sees the CR
# as part of a path, so the digest describes files that do not exist; (3) `awk
# 'NF{last=$0}'` treats a CR-ONLY line as NON-EMPTY, so a CRLF message ending in a blank
# line makes "\r" the last non-empty line — the literal is never compared at all and a
# genuinely clean review writes no stamp. Verified: printf 'No findings.\r\n\r\n' |
# awk 'NF{last=$0} END{print last}' prints a bare CR. Stripping here fixes all three; the
# per-consumer strip that used to sit in the verdict block fixed only (1), and was dead
# code besides (the trailing-whitespace trim on the next line already covers CR).
MSG=${MSG//$'\r'/}

# --- parse the contract (docs/AI_WORKFLOW.md:49) -------------------------------
SHA=$(printf '%s\n' "$MSG" \
      | sed -n 's/^REVIEWED-SHA:[[:space:]]*\([0-9a-f]\{40\}\).*/\1/p' | head -1)
# EXACTLY 40, not 7-40. The reader always passes the full `headRefOid`
# (merge-review-guard.sh:268 is the only other production caller of review_stamp_dir),
# so an abbreviated sha could never produce a record the reader finds — it could only
# file one in a directory nobody opens. Measured: a message carrying a 7-char sha and a
# CRITICAL finding wrote <root>/1234567/security-auditor.json while the full-sha clean
# review wrote <root>/<40-char>/code-reviewer.json, so the objection was invisible to
# the gate. Refusing to write is the honest failure: the gate then says "no record".
[ -n "$SHA" ] || exit 0

# Everything between REVIEWED-FILES: and the first line that is not a bare path. A blank
# line inside the block is SKIPPED, not a terminator, and "blank" here means EMPTY OR
# WHITESPACE-ONLY — docs/AI_WORKFLOW.md's reviewer contract deliberately does not require
# "no blank lines inside the block", so a separator line that happens to carry a stray
# space or tab must stay as harmless as a truly empty one. That is what the `NF &&` guard
# on the whitespace terminator below is for, and it is not decoration: without it, a
# space-only separator between two listed paths TRUNCATED the block at the first path and
# the digest silently described a strict prefix of the reviewed files
# (8f4842be754477ff for a two-path review that must digest to cf5a596de517834a). The
# block therefore ends at a bracketed finding, at the literal "No findings.", or at any
# NON-BLANK line containing whitespace.
#
# That third terminator is load-bearing, not belt-and-braces. The roster contract
# (docs/AI_WORKFLOW.md's dispatch prompt -> .claude/agents/code-reviewer.md "Report")
# REQUIRES a clean review to put its correctly-implemented-patterns list ABOVE the final
# "No findings." — i.e. exactly between the file list and the only two terminators this
# collector used to have. Every line of that mandated list was therefore collected as a
# PATH, so the always-dispatched baseline reviewer's own prescribed clean shape produced
# verdict=clean with digest 55fda4e16ce87ade where its one real path digests to
# 8f4842be754477ff: a record that PASSES on verdict and FAILS on scope, denying the merge
# with a message that points at diff scope while the cause is a patterns list. The same
# corruption hit the trailing-whitespace tolerance the verdict block deliberately grants
# below — "No findings.   " misses the exact-match terminator on line 3 of this awk and
# was collected as a path too.
#
# The test is WHITESPACE, not "does this look like a path", because that is the SAME
# shape property the CRITICALS exclusion below already depends on (a REVIEWED-FILES line
# is "no leading whitespace, no bullet markers, no numbering, no backticks, no trailing
# commentary" — one invariant, enforced at both sites through the same [[:space:]] class
# rather than two different spellings of "whitespace"). It is fail-closed in the only
# direction available to it: it can only SHRINK $FILES, never admit a line the previous
# collector rejected.
#
# NOTE: this parse feeds ONLY $FILES -> $DIGEST -> reviewed_files_digest. Verdict /
# CRITICAL detection (further below) never derives from $FILES or from this block
# boundary — deliberately: anything this collector still gets wrong can only corrupt the
# digest, which then mismatches Task 5's independent recomputation and DENIES the merge —
# fail-closed, confusing, safe. Coupling CRITICAL detection to this parse (e.g. "scan
# whatever isn't in $FILES") would instead let a swallowed line escape detection entirely
# — fail-open, the one direction this mechanism must never take. What can still be
# swallowed — a NON-BLANK line that contains no whitespace at all, which is the only
# shape left that reaches the `print` — is enumerated with measured digests in RESIDUAL 5
# below.
FILES=$(printf '%s\n' "$MSG" | awk '
  /^REVIEWED-FILES:/ { collecting=1; next }
  collecting && /^\[(CRITICAL|WARNING|SUGGESTION)\]/ { collecting=0 }
  collecting && /^No findings\.?$/                   { collecting=0 }
  collecting && NF && /[[:space:]]/                  { collecting=0 }
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
# trailing blank after "No findings." can't defeat this). "Non-empty" is awk's NF, which
# counts a CR-ONLY line as non-empty — that is precisely why CRLF is normalized at ingest
# above rather than here: without that, a CRLF message with a trailing blank line makes a
# bare "\r" the last non-empty line and this comparison never sees the literal at all.
#
# The anchor is itself a NEW false-deny surface, and round 3 exists because of it: every
# roster reviewer definition (`docs/AI_WORKFLOW.md` -> `.claude/agents/code-reviewer.md`
# "Report" step) is required to place any patterns/notes list ABOVE "No findings.", never
# below — but the literal comparison below is still exact apart from ONE stripped
# dimension (this line's own trailing whitespace; CR is already gone, stripped
# message-wide at ingest), so a genuinely clean review can still be denied by something as
# small as an editor-appended trailing space on the line itself.
# Strip that one dimension before comparing — it costs nothing in the fail-open direction,
# since a message that fails this comparison still only denies (see the RESIDUAL comment
# below for what is NOT stripped and still denies).
LAST_LINE=$(printf '%s\n' "$MSG" | awk 'NF{last=$0} END{print last}')
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
#    deny (safe, fail-closed, but a real class, not a hypothetical one). This item covers
#    ONLY deviations that produce NO stamp. A deviation that produces a stamp whose
#    verdict passes while its digest is wrong is a different class with a different
#    symptom — item 5. One shape MOVED into this item when the whitespace
#    terminator landed: a trailing space on the FIRST listed path now terminates the block
#    before anything is collected, so $FILES is empty and the hook exits writing nothing —
#    where it previously wrote a stamp carrying a corrupt digest (measured: 1e2deb28ad55f723
#    -> NO STAMP). The merge outcome is unchanged (both deny); only which residual class
#    it lands in changed, and no-stamp is the more honest of the two.
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
#
# 5. Verdict-PASSES / scope-FAILS class (fail-closed, but the two halves of one record
#    disagree, and the symptom surfaces somewhere other than the cause): a stamp can be
#    written with verdict `clean` and a `reviewed_files_digest` that does not describe the
#    reviewed files, because the $FILES collector admits any non-blank line up to its
#    terminators. Round 4's CRITICAL was the live instance — the contract-MANDATED
#    patterns list sat inside the block and every line of it was digested as a path. The
#    whitespace terminator closes every NON-BLANK shape carrying a space, tab or CR; what
#    REMAINS in this class is a non-blank line with NO whitespace at all, sitting between
#    the file list and the findings — still collected as a path. It is wider than a lone
#    `Notes:`; every one of these was constructed and run against this hook, digest shown
#    against a correct 8f4842be754477ff for the single path each fixture lists:
#        Notes:         fba83fc3c721dae5      Summary        8370d7186a8793d3
#        Findings:      06ae22ddc247655e      **Patterns**   1d32394501c77a8e
#        ---            3ce962d9ce280327      --             45b77a59993dc4e7
#    Task 5's gate then denies on SCOPE while this record reads `clean`, so a human sees a
#    passing verdict and a scope denial that look like they contradict each other; the
#    denial is right, and the verdict field is not the part that failed.
#
#    The REACHABLE half is closed at the contract, not here: docs/AI_WORKFLOW.md's
#    dispatch prompt now instructs that the first line below the file list must contain a
#    space, so a reviewer following it cannot produce any shape in the table above. The
#    parser is deliberately left permissive — tightening it to a positive bare-path shape
#    would trade this for a false-deny on legitimate paths.
#
#    Do NOT restate the inverse ("a changed-file path that CONTAINS whitespace truncates
#    the list") as a live residual: `git ls-files | grep -c ' '` is 0 in this repo, so
#    that half is unreachable, and naming it instead of the shapes above is what made this
#    item document the impossible case while missing the live one. This is the
#    same boundary the reviewer contract states in prose (docs/AI_WORKFLOW.md dispatch
#    prompt and .claude/agents/code-reviewer.md) — parser, contract and residual
#    deliberately name one property, not three. That property has to be stated with its
#    blank-line clause or it is not the parser's property: the `NF &&` guard above makes a
#    blank OR WHITESPACE-ONLY line a SKIPPED line rather than a terminator, so what must
#    contain a space is the first line of CONTENT below the file list. "Your first line
#    containing a space" on its own is the OLD, pre-round-5 boundary, and a reviewer who
#    leaves a space-only separator and infers from that shorter wording that the block
#    already ended reaches every row of the table above with a `clean` verdict.

# --- write -------------------------------------------------------------------
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
. "$HERE/lib/review-stamp-path.sh" 2>/dev/null || exit 0
declare -F review_stamp_dir >/dev/null || exit 0

# ANCHOR THE LOOKUP TO THIS SCRIPT'S OWN REPO, NOT TO THE AMBIENT CWD. review_stamp_dir
# runs `git rev-parse --git-common-dir` to derive its repo key, and this hook fires in the
# reviewer's uninherited cwd (see the header) — so an unanchored call keys the record by
# WHEREVER THE REVIEWER HAPPENED TO BE. Measured 2026-09-12 with SHA=deadbeef:
#   from the repo root -> /tmp/ocrecipes-review-stamps-07d4e12e42b1/deadbeef
#   from /tmp or $HOME -> /tmp/ocrecipes-review-stamps-global/deadbeef
# merge-review-guard.sh cds to $ROOT before its own call, so a record filed under the
# `-global-` key is one the reader never looks at: a genuinely clean review then denies as
# "no record", which is the restrictive failure this file's header warns gets gates
# switched off. `-global-` is also the one key two different repos can collide on.
# The cd is confined to this subshell, so the header's "never run git against the ambient
# cwd" invariant still holds for everything below.
DIR=$(cd "$HERE/../.." 2>/dev/null && review_stamp_dir "$SHA") || exit 0
[ -n "$DIR" ] || exit 0
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
