#!/usr/bin/env bash
# Tests for the context-ledger hooks — run from project root.
# Hermetic: CONTEXT_LEDGER_ROOT redirects all state into a temp dir, so a run never
# touches a real session's ledger.
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

TMPROOT=$(mktemp -d) || exit 1
export CONTEXT_LEDGER_ROOT="$TMPROOT/ledger"
trap 'rm -rf "$TMPROOT" "${REAL_DIR:-}"' EXIT

. "$HOOKS_DIR/lib/context-ledger-path.sh" || { echo "FAIL: cannot source lib"; exit 1; }

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
no() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- Task 1: path resolution + sanitiser ---

out=$(context_ledger_dir "abc-123" 2>/dev/null)
[ "$out" = "$CONTEXT_LEDGER_ROOT/abc-123" ] \
  && ok "valid session id resolves under the test root" \
  || no "valid session id resolved to [$out]"

# Test 8 (spec §8): sanitiser. Asserted DIRECTLY, not inferred from a green suite.
# Contract is "return 1 AND print nothing" — both halves are checked, so a mutant
# that printed a path before `return 1` cannot pass.
for bad in "" "../etc" "a/b" 'a;rm -rf /' '$(whoami)' ".." "."; do
  out=$(context_ledger_dir "$bad" 2>/dev/null); rc=$?
  if [ $rc -eq 0 ] || [ -n "$out" ]; then
    no "sanitiser ACCEPTED or printed for bad id: [$bad] rc=$rc out=[$out]"
  else
    ok "sanitiser rejected [$bad]"
  fi
done

# Production default path (spec §8): pin the real, non-test branch so a later task's
# hardcoded reference can't drift silently. Unset in a subshell so the hermetic
# CONTEXT_LEDGER_ROOT export above is untouched for every other case.
out=$( unset CONTEXT_LEDGER_ROOT; HOME=/home/pinned XDG_STATE_HOME= context_ledger_dir "abc-123" 2>/dev/null )
if [ "$out" = "/home/pinned/.local/state/ocrecipes/context-ledger/abc-123" ]; then
  ok "production default path pinned"
else
  no "production default path drifted: [$out]"
fi
# XDG_STATE_HOME wins when set — the spec's own precedence, pinned so a later edit cannot
# quietly hardcode $HOME and strip a user's configured state dir.
out=$( unset CONTEXT_LEDGER_ROOT; HOME=/home/pinned XDG_STATE_HOME=/xdg/state context_ledger_dir "abc-123" 2>/dev/null )
if [ "$out" = "/xdg/state/ocrecipes/context-ledger/abc-123" ]; then
  ok "XDG_STATE_HOME takes precedence over \$HOME"
else
  no "XDG_STATE_HOME precedence drifted: [$out]"
fi
# A RELATIVE XDG_STATE_HOME is IGNORED, not honoured. The basedir spec requires it ("If an
# implementation encounters a relative path it MUST be ignored"), and the reason it matters
# here is sharper than compliance: a cwd-relative ledger would be CREATED by the writers
# under whatever directory the hook was invoked from and then looked for by the reader from
# a different one, so the digest silently vanishes -- the exact failure the shared-definition
# rationale at the top of context-ledger-path.sh exists to remove, arriving by another route.
out=$( unset CONTEXT_LEDGER_ROOT; HOME=/home/pinned XDG_STATE_HOME=relstate context_ledger_dir "abc-123" 2>/dev/null )
if [ "$out" = "/home/pinned/.local/state/ocrecipes/context-ledger/abc-123" ]; then
  ok "a relative XDG_STATE_HOME is ignored and \$HOME is used"
else
  no "relative XDG_STATE_HOME was honoured or mishandled: [$out]"
fi
# No derivable root -> REFUSE, quietly. Before this, an unset HOME tripped `set -u` inside
# the function, and the abort surfaced through ledger-note.sh as "no usable
# CLAUDE_CODE_SESSION_ID" -- blaming an input that was fine. Both halves are asserted: a
# non-zero return AND no stderr, since the misleading message was itself the bug.
err=$( unset CONTEXT_LEDGER_ROOT; env -u HOME -u XDG_STATE_HOME bash -c \
        ". \"$HOOKS_DIR/lib/context-ledger-path.sh\"; set -u; context_ledger_dir abc-123" 2>&1 )
rc=$?
if [ "$rc" -ne 0 ] && [ -z "$err" ]; then
  ok "no derivable ledger root refuses with a non-zero return and no stderr"
else
  no "unset HOME/XDG_STATE_HOME: expected rc!=0 and silence, got rc=$rc err=[$err]"
fi
# THE SECURITY PROPERTY, asserted rather than implied by the two literals above: the
# production default must not live under a world-writable directory. Its contents are read
# back into additionalContext, so anyone who can write there can write model input. A
# future edit to ${TMPDIR:-/tmp} would satisfy neither literal pin above AND would trip
# this one — which is the point, because TMPDIR is unset on the CI runner and that spelling
# collapses straight back to /tmp exactly where nobody would notice.
out=$( unset CONTEXT_LEDGER_ROOT; context_ledger_dir "abc-123" 2>/dev/null )
case "$out" in
  /tmp/*|/var/tmp/*|/private/tmp/*) no "production default path is under a world-writable root: [$out]" ;;
  *) ok "production default path is not under a world-writable root" ;;
esac

# --- Task 2: PreCompact digest builder ---

PRECOMPACT="$HOOKS_DIR/precompact-ledger.sh"
SID="sess-task2"
LDIR="$CONTEXT_LEDGER_ROOT/$SID"
mkdir -p "$LDIR"

# Build a minimal fake transcript with one Bash tool_use record.
FAKE_TX="$TMPROOT/fake.jsonl"
cat > "$FAKE_TX" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"diff before.txt after.txt","description":"Diff the config snapshots"}}]}}
EOF

# Test 1: floor only, no curated file.
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID" "$FAKE_TX" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Diff the config snapshots" "$LDIR/resume.md" 2>/dev/null; then
  ok "floor extracted a Bash call with no curated file"
else
  no "floor did not extract the Bash call"
fi

# Test 2: curated tier included.
printf 'VERIFIED | config diff identical | diff before.txt after.txt\n' > "$LDIR/curated.md"
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID" "$FAKE_TX" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "config diff identical" "$LDIR/resume.md" 2>/dev/null; then
  ok "curated tier included in digest"
else
  no "curated tier missing from digest"
fi

# Test 6: missing transcript_path WITH a curated file -> curated STILL emitted.
# Asserting silence here would pass against an implementation that ignores curation.
SID6="sess-task2-nopath"; L6="$CONTEXT_LEDGER_ROOT/$SID6"; mkdir -p "$L6"
printf 'VERIFIED | curated survives a missing transcript | (n/a)\n' > "$L6/curated.md"
printf '{"session_id":"%s"}' "$SID6" | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "curated survives a missing transcript" "$L6/resume.md" 2>/dev/null; then
  ok "missing transcript_path still emits the curated tier"
else
  no "missing transcript_path dropped the curated tier"
fi

# Test 6a: no transcript_path, but the glob CAN find it -> floor present.
# The glob is cwd-independent, which is the whole point (spec §6). Stage a transcript
# under a fake HOME so the hook's ~/.claude/projects/*/<sid>.jsonl lookup resolves.
FAKEHOME="$TMPROOT/home"
SID6A="sess-task2-glob"
mkdir -p "$FAKEHOME/.claude/projects/some-project-dir"
cp "$FAKE_TX" "$FAKEHOME/.claude/projects/some-project-dir/$SID6A.jsonl"
printf '{"session_id":"%s"}' "$SID6A" \
  | HOME="$FAKEHOME" bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Diff the config snapshots" "$CONTEXT_LEDGER_ROOT/$SID6A/resume.md" 2>/dev/null; then
  ok "glob fallback resolved the transcript without transcript_path"
else
  no "glob fallback failed to resolve the transcript"
fi

# Test 10: digest over the cap -> stays within the 6144-byte cap, newest curated entries survive.
# The pressure comes from a large curated.md, so the trim loop's curated branch is what is
# exercised. (Under the original 12-row floor a transcript alone could not breach the cap;
# the four section caps, 8+5+8+8 rows, now can — the sectioned-cap case covers that.) See
# ledger Ruling 1.
SID10="sess-task2-cap"; L10="$CONTEXT_LEDGER_ROOT/$SID10"; mkdir -p "$L10"
: > "$L10/curated.md"
i=0
while [ $i -lt 300 ]; do
  printf 'VERIFIED | filler claim number %s | some command %s\n' "$i" "$i" >> "$L10/curated.md"
  i=$((i+1))
done
# Sentinel written LAST — the tier keeps the most recent entries, so this must survive.
printf 'VERIFIED | newest entry must survive | sentinel-curated-row\n' >> "$L10/curated.md"

FAKE_TX2="$TMPROOT/fake2.jsonl"
cp "$FAKE_TX" "$FAKE_TX2"
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID10" "$FAKE_TX2" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
size=$(wc -c < "$L10/resume.md" 2>/dev/null || echo 999999)
if [ "$size" -le 6144 ] && grep -q "sentinel-curated-row" "$L10/resume.md" 2>/dev/null; then
  ok "digest respects the 6144-byte cap and keeps the newest curated entry ($size bytes)"
else
  no "cap violated or newest curated entry dropped (size=$size)"
fi
# The oldest filler must have been dropped — otherwise nothing was actually bounded.
if grep -q "filler claim number 0 " "$L10/resume.md" 2>/dev/null; then
  no "curated tier was NOT bounded — oldest entry still present"
else
  ok "curated tier bounded: oldest entries dropped"
fi

# MINOR 1 (fix round 1): `tail -c 2048` is a byte cut and can land mid-line, so a curated
# row can survive as a fragment (e.g. "FIED | filler claim number 262 | ..."). Any surviving
# "filler claim number" row must start the line with the intact "VERIFIED |" prefix.
if grep -E '[|] filler claim number [0-9]+ [|]' "$L10/resume.md" 2>/dev/null | grep -vE '^VERIFIED [|]' 2>/dev/null | grep -q .; then
  no "curated tier line was truncated mid-line (byte-cut fragment present)"
else
  ok "curated tier lines are intact (no mid-line byte-cut fragment)"
fi

# Test 7: malformed stdin -> silent, exit 0.
out=$(printf 'not json at all' | bash "$PRECOMPACT" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then
  ok "malformed stdin exits 0 silently"
else
  no "malformed stdin rc=$rc out=[$out]"
fi

# Test 9: both tiers absent -> no resume.md, exit 0 (the one deliberate silent case).
SID9="sess-task2-empty"
printf '{"session_id":"%s"}' "$SID9" | bash "$PRECOMPACT" >/dev/null 2>&1; rc=$?
if [ $rc -eq 0 ] && [ ! -s "$CONTEXT_LEDGER_ROOT/$SID9/resume.md" ]; then
  ok "both tiers absent -> empty digest, exit 0"
else
  no "both-tiers-absent case wrote a digest or failed (rc=$rc)"
fi

# --- Task 2 fix round 1: IMPORTANT 1 — caveat lines are load-bearing ---
# Deleting either banner line kept the suite at 17/17 before this case existed. $LDIR's
# resume.md still holds Test 2's output (curated + floor both present), so both caveats
# must appear in it without any further hook invocation.
if grep -q "MEASURED vs ASSUMED" "$LDIR/resume.md" 2>/dev/null; then
  ok "digest carries the MEASURED vs ASSUMED caveat"
else
  no "digest missing the MEASURED vs ASSUMED caveat"
fi
if grep -q "Not a verification tier" "$LDIR/resume.md" 2>/dev/null; then
  ok "digest carries the mechanical-floor 'not a verification tier' caveat"
else
  no "digest missing the mechanical-floor 'not a verification tier' caveat"
fi

# --- Task 2 fix round 1: IMPORTANT 2 — a malformed transcript line must not abort
# extraction of the records that follow it. ---
SID12="sess-task2-badline"; L12="$CONTEXT_LEDGER_ROOT/$SID12"; mkdir -p "$L12"
FAKE_TX3="$TMPROOT/fake-badline.jsonl"
cat > "$FAKE_TX3" <<'EOF'
not valid json at all
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo survives-the-bad-line","description":"Survives a malformed sibling line"}}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID12" "$FAKE_TX3" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Survives a malformed sibling line" "$L12/resume.md" 2>/dev/null; then
  ok "a malformed transcript line does not abort extraction of a later Bash record"
else
  no "malformed transcript line aborted extraction of the later Bash record"
fi

# A Bash record missing "command" entirely must degrade to an empty command, not the
# literal text "null" (found while fixing IMPORTANT 2: `"" | split("\n")` is `[]` in jq,
# so indexing [0] on it is an out-of-bounds null unless guarded a second time).
SID12B="sess-task2-nocommand"; L12B="$CONTEXT_LEDGER_ROOT/$SID12B"; mkdir -p "$L12B"
FAKE_TX3B="$TMPROOT/fake-nocommand.jsonl"
cat > "$FAKE_TX3B" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"description":"No command field on this record"}}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID12B" "$FAKE_TX3B" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "No command field on this record" "$L12B/resume.md" 2>/dev/null \
   && ! grep -q "No command field on this record ← null" "$L12B/resume.md" 2>/dev/null; then
  ok "a Bash record missing 'command' degrades to empty, not the literal text 'null'"
else
  no "a Bash record missing 'command' errored out or rendered the literal text 'null'"
fi

# --- Task 2 fix round 1: MINOR 2 — the glob picks the most recently modified candidate,
# not the lexicographically first one. ---
FAKEHOME2="$TMPROOT/home2"
SID13="sess-task2-glob-multi"
mkdir -p "$FAKEHOME2/.claude/projects/aaa-old-project" "$FAKEHOME2/.claude/projects/zzz-new-project"
OLD_TX="$FAKEHOME2/.claude/projects/aaa-old-project/$SID13.jsonl"
NEW_TX="$FAKEHOME2/.claude/projects/zzz-new-project/$SID13.jsonl"
cat > "$OLD_TX" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo stale-candidate","description":"Stale project dir candidate"}}]}}
EOF
cat > "$NEW_TX" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo fresh-candidate","description":"Fresh project dir candidate"}}]}}
EOF
# "aaa-old-project" sorts FIRST lexicographically but must NOT win — it is the OLDER file.
touch -t 202001010000 "$OLD_TX"
touch -t 203001010000 "$NEW_TX"
printf '{"session_id":"%s"}' "$SID13" \
  | HOME="$FAKEHOME2" bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Fresh project dir candidate" "$CONTEXT_LEDGER_ROOT/$SID13/resume.md" 2>/dev/null \
   && ! grep -q "Stale project dir candidate" "$CONTEXT_LEDGER_ROOT/$SID13/resume.md" 2>/dev/null; then
  ok "glob picks the most recently modified transcript, not the lexicographically first"
else
  no "glob picked a stale/lexicographically-first transcript over the newer one"
fi

# --- Task 2 fix round 1: CRITICAL — the 4KB cap must hold against a REALISTIC fixture,
# not just the synthetic Test 10 one. The input-side bounds (tail -c 2048, tail -n 12,
# per-field clamps) are only as good as the arithmetic behind them, and this exact shape —
# a curated.md over 2048 bytes plus 12 DISTINCT Bash calls with long-but-legal descriptions
# — is what broke that arithmetic in review (4329 bytes against the 4096 cap). Distinct
# descriptions/commands so awk dedup cannot collapse the 12 rows into fewer.
SID14="sess-task2-cap-realistic"; L14="$CONTEXT_LEDGER_ROOT/$SID14"; mkdir -p "$L14"
: > "$L14/curated.md"
i=0
while [ $i -lt 40 ]; do
  printf 'VERIFIED | claim about subsystem behavior number %03d confirmed by direct measurement | inspect-subsystem-%03d.sh --check\n' "$i" "$i" >> "$L14/curated.md"
  i=$((i+1))
done
curated_size=$(wc -c < "$L14/curated.md")

FAKE_TX4="$TMPROOT/fake-realistic.jsonl"
: > "$FAKE_TX4"
i=1
while [ $i -le 12 ]; do
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm run test:run -- --grep integration-scenario-%02d --reporter verbose --bail --timeout=30000","description":"Investigate integration scenario %02d flaky failure root cause"}}]}}\n' "$i" "$i" >> "$FAKE_TX4"
  i=$((i+1))
done

printf '{"session_id":"%s","transcript_path":"%s"}' "$SID14" "$FAKE_TX4" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
size14=$(wc -c < "$L14/resume.md" 2>/dev/null || echo 999999)
echo "INFO: cap proof fixture — curated.md=${curated_size} bytes, resume.md=${size14} bytes"
if [ "$size14" -le 6144 ]; then
  ok "cap holds against realistic input: 12 distinct floor rows + oversized curated ($size14 bytes)"
else
  no "cap VIOLATED against realistic input ($size14 bytes)"
fi

# --- Task 3: SessionStart injector ---

RESUME_HOOK="$HOOKS_DIR/session-resume-ledger.sh"
SIDR="sess-task3"; LR="$CONTEXT_LEDGER_ROOT/$SIDR"; mkdir -p "$LR"
# The sentinel is UNIQUE to this fixture. Asserting the generic "[CONTEXT LEDGER]" banner
# instead would pass against a hook that emits a hardcoded digest and never reads resume.md.
printf '[CONTEXT LEDGER]\nVERIFIED | sentinel-t3-unique | cmd\n' > "$LR/resume.md"

# Test 4: source=compact -> valid JSON carrying the ACTUAL file content.
out=$(printf '{"session_id":"%s","source":"compact"}' "$SIDR" | bash "$RESUME_HOOK" 2>/dev/null)
if printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null 2>&1 \
   && printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | grep -q "sentinel-t3-unique"; then
  ok "source=compact emits valid JSON carrying resume.md's actual content"
else
  no "source=compact output malformed or not sourced from resume.md: [$out]"
fi

# Test 4b: a digest containing JSON metacharacters survives encoding INTACT.
# `jq -n --arg` handles this; a printf-based implementation would emit invalid JSON or
# silently corrupt the digest. Nothing else in the suite would notice.
SIDQ="sess-task3-quotes"; LQ="$CONTEXT_LEDGER_ROOT/$SIDQ"; mkdir -p "$LQ"
printf '%s\n' 'VERIFIED | he said "hi" | grep -E "^a\\|b" path\with\back' > "$LQ/resume.md"
out=$(printf '{"session_id":"%s","source":"compact"}' "$SIDQ" | bash "$RESUME_HOOK" 2>/dev/null)
got=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null)
if printf '%s' "$got" | grep -q 'he said "hi"' && printf '%s' "$got" | grep -q 'path\\with\\back'; then
  ok "digest with quotes and backslashes survives JSON encoding intact"
else
  no "digest corrupted by JSON encoding: [$got]"
fi

# Test 5b: EMPTY (zero-byte) resume.md -> silent. Proves only that an empty resume.md
# produces NO output — not which guard causes it. Swapping `[ -s ]` for `[ -f ]` keeps
# this case green too: the file still exists, DIGEST still comes back empty, and the
# later `[ -n "$DIGEST" ]` guard independently catches the zero-byte case. The two
# guards are redundant on this input, so this case cannot discriminate between them.
SIDE="sess-task3-empty"; LE="$CONTEXT_LEDGER_ROOT/$SIDE"; mkdir -p "$LE"
: > "$LE/resume.md"
out=$(printf '{"session_id":"%s","source":"compact"}' "$SIDE" | bash "$RESUME_HOOK" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then
  ok "empty resume.md exits 0 silently"
else
  no "empty resume.md rc=$rc out=[$out]"
fi

# Test 7b: malformed stdin and hostile input -> silent, exit 0 (fail open). The
# `session_id:"../etc"` case only asserts fail-open on hostile input, not that the
# sanitiser rejected it: no resume.md exists at the resolved path whether the
# sanitiser rejects "../etc" or wrongly accepts it, so this loop cannot distinguish
# the two. The sanitiser itself is asserted directly, both halves (rc and output), in
# the Task 1 block above.
for bad_input in 'not json at all' '{"session_id":"../etc","source":"compact"}' '{}'; do
  out=$(printf '%s' "$bad_input" | bash "$RESUME_HOOK" 2>&1); rc=$?
  if [ $rc -eq 0 ] && [ -z "$out" ]; then
    ok "fail-open on bad input: ${bad_input:0:28}"
  else
    no "bad input leaked rc=$rc out=[$out] for: $bad_input"
  fi
done

# Test 3: source=startup -> NOTHING. The most likely regression. `fork` included:
# the installed SessionStart schema enumerates startup/resume/clear/compact/fork.
for src in startup resume clear fork; do
  out=$(printf '{"session_id":"%s","source":"%s"}' "$SIDR" "$src" | bash "$RESUME_HOOK" 2>&1); rc=$?
  if [ $rc -eq 0 ] && [ -z "$out" ]; then
    ok "source=$src emits nothing"
  else
    no "source=$src leaked output rc=$rc out=[$out]"
  fi
done

# Test 5: no resume.md -> exit 0, no output.
out=$(printf '{"session_id":"sess-task3-none","source":"compact"}' | bash "$RESUME_HOOK" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then
  ok "missing resume.md exits 0 silently"
else
  no "missing resume.md rc=$rc out=[$out]"
fi

# --- Task 4: curated-tier writer ---

NOTE="$HOOKS_DIR/ledger-note.sh"
SIDN="sess-task4"

CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOTE" VERIFIED "config diff identical" "diff a b" >/dev/null 2>&1
CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOTE" ASSUMED "latency 40-80ms" "never measured" >/dev/null 2>&1
CUR="$CONTEXT_LEDGER_ROOT/$SIDN/curated.md"
if grep -q "VERIFIED | config diff identical | diff a b" "$CUR" 2>/dev/null \
   && grep -q "ASSUMED | latency 40-80ms | never measured" "$CUR" 2>/dev/null; then
  ok "ledger-note appends both VERIFIED and ASSUMED rows"
else
  no "ledger-note did not append expected rows"
fi

# Appending must PRESERVE prior rows, not truncate. Checked explicitly: both earlier rows
# are still present after a third write, and the file has exactly 3 lines.
CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOTE" VERIFIED "third row" "cmd3" >/dev/null 2>&1
if [ "$(wc -l < "$CUR" 2>/dev/null | tr -d ' ')" = "3" ] \
   && grep -q "config diff identical" "$CUR" 2>/dev/null; then
  ok "ledger-note appends without truncating prior rows"
else
  no "ledger-note truncated or miscounted: $(wc -l < "$CUR" 2>/dev/null) lines"
fi

# Rejection must be BOTH non-zero exit AND no write. Checking only the exit code would pass
# a script that writes the row and then fails — the same "rc checked, side effect unchecked"
# gap review found in Task 1's sanitiser loop.
BEFORE=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
if CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOTE" MAYBE "x" "y" >/dev/null 2>&1; then
  no "ledger-note accepted an invalid tier"
else
  AFTER=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "invalid tier rejected AND nothing written"
  else
    no "invalid tier rejected but the file grew: $BEFORE -> $AFTER"
  fi
fi

# Missing arguments must also reject without writing.
BEFORE=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
for args in "VERIFIED" "VERIFIED claim-only"; do
  # shellcheck disable=SC2086
  if CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOTE" $args >/dev/null 2>&1; then
    no "ledger-note accepted incomplete args: [$args]"
  else
    ok "ledger-note rejected incomplete args: [$args]"
  fi
done
AFTER=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
[ "$BEFORE" = "$AFTER" ] \
  && ok "incomplete args wrote nothing" \
  || no "incomplete args grew the file: $BEFORE -> $AFTER"

# No session id -> fail, do not guess a key. Cover BOTH empty and UNSET: they take different
# code paths through `${CLAUDE_CODE_SESSION_ID:-}`, and only one of them is the real case.
# Both must ALSO leave the file untouched — checking only the exit code would pass a mutant
# that writes the row and then exits 1 in this branch, the same gap the tier case above
# guards against.
BEFORE=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
if CLAUDE_CODE_SESSION_ID="" bash "$NOTE" VERIFIED "x" "y" >/dev/null 2>&1; then
  no "ledger-note wrote with an empty session id"
else
  AFTER=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "ledger-note refuses an empty session id AND nothing written"
  else
    no "empty session id rejected but the file grew: $BEFORE -> $AFTER"
  fi
fi
BEFORE=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
if env -u CLAUDE_CODE_SESSION_ID bash "$NOTE" VERIFIED "x" "y" >/dev/null 2>&1; then
  no "ledger-note wrote with session id UNSET"
else
  AFTER=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "ledger-note refuses an unset session id AND nothing written"
  else
    no "unset session id rejected but the file grew: $BEFORE -> $AFTER"
  fi
fi

# Embedded newlines in claim or evidence must be rejected, not flattened or silently
# split into a fragment: precompact-ledger.sh's byte-cut recovery and trim loop both
# assume one row is one physical line.
BEFORE=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
if CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOTE" VERIFIED "$(printf 'line one\nline two')" "y" >/dev/null 2>&1; then
  no "ledger-note accepted a multi-line claim"
else
  AFTER=$(wc -c < "$CUR" 2>/dev/null | tr -d ' ')
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "multi-line claim rejected AND nothing written"
  else
    no "multi-line claim rejected but the file grew: $BEFORE -> $AFTER"
  fi
fi

# Missing lib must fail LOUD (non-zero, stderr message), not silently, unlike the two
# fail-open hooks. Copy the script to a tmpdir with no lib/ subdirectory at all.
NOLIB_DIR=$(mktemp -d)
cp "$NOTE" "$NOLIB_DIR/ledger-note.sh"
err=$(CLAUDE_CODE_SESSION_ID="$SIDN" bash "$NOLIB_DIR/ledger-note.sh" VERIFIED "x" "y" 2>&1 >/dev/null); rc=$?
rm -rf "$NOLIB_DIR"
if [ $rc -ne 0 ] && [ -n "$err" ]; then
  ok "missing lib fails loud: non-zero exit with a stderr message"
else
  no "missing lib did not fail loud: rc=$rc err=[$err]"
fi

# --- Task 5: SessionEnd cleanup ---
# HERMETIC, like every other task in this file. It did NOT used to be: the cleanup line
# re-derived /tmp/ocrecipes-context-ledger-<sid> inline and so ignored
# CONTEXT_LEDGER_ROOT, which forced this one task to abandon the hermetic root and
# assert against a real /tmp path. That divergence was the bug, not a property to test
# around — with the cleanup now asking context_ledger_dir() for the directory, writer
# and deleter agree under CONTEXT_LEDGER_ROOT and this task can use it like the rest.
#
# Keep it that way. If a future edit makes these two cases need a real /tmp path again,
# that is the signal that the reader and the writer have diverged a second time.
#
# SESSION_COORD_CLAUDE_PID is REQUIRED here: `deregister` falls through to
# scripts/pg-lab/session-coord.sh's do_deregister(), which removes a PID-keyed bridge
# file unscoped by session id — without a stub pid it resolves to and deletes the
# LIVE Claude Code session's own bridge file. test-session-coord.sh stubs this on all
# 7 of its register/deregister calls; match that precedent here.

COORD="$HOOKS_DIR/session-coord-hook.sh"
SIDC="sess-cleanup-$$"
FAKE_PID=$((91000000 + $$))
REAL_DIR="$CONTEXT_LEDGER_ROOT/${SIDC}"
mkdir -p "$REAL_DIR"; printf 'x\n' > "$REAL_DIR/resume.md"

printf '{"session_id":"%s"}' "$SIDC" | SESSION_COORD_CLAUDE_PID="$FAKE_PID" bash "$COORD" deregister >/dev/null 2>&1

if [ ! -d "$REAL_DIR" ]; then
  ok "SessionEnd removes the session's ledger directory"
else
  no "ledger directory leaked after deregister: $REAL_DIR"
  rm -rf "$REAL_DIR"
fi

# --- Task 5 fix round 1, Minor 2: cleanup must precede the pg-lab existence gate ---
# The hook's own comment states cleanup must not depend on pg-lab being installed.
# Copy the hook two directories deep into an empty tmp root so its own path math
# (ROOT="$(cd "$(dirname BASH_SOURCE)/../.." && pwd)") resolves SCRIPT to a path with
# no scripts/pg-lab/session-coord.sh — [ -f "$SCRIPT" ] is false — and assert the
# ledger directory is still removed regardless.
ORD_ROOT=$(mktemp -d) || exit 1
mkdir -p "$ORD_ROOT/a/b"
cp "$COORD" "$ORD_ROOT/a/b/session-coord-hook.sh"
# The hook now SOURCES lib/context-ledger-path.sh rather than re-deriving the path, so
# the relocated copy needs the lib reachable at the ROOT its own path math computes
# ($ORD_ROOT, two up from a/b). Without this the cleanup silently no-ops and this case
# passes for the wrong reason — it would be asserting that a hook which cannot find its
# library still deletes something, which it cannot.
mkdir -p "$ORD_ROOT/.claude/hooks/lib"
cp "$HOOKS_DIR/lib/context-ledger-path.sh" "$ORD_ROOT/.claude/hooks/lib/context-ledger-path.sh"
SIDO="sess-cleanup-ord-$$"
FAKE_PID_ORD=$((92000000 + $$))
ORD_DIR="$CONTEXT_LEDGER_ROOT/${SIDO}"
mkdir -p "$ORD_DIR"; printf 'x\n' > "$ORD_DIR/resume.md"

printf '{"session_id":"%s"}' "$SIDO" \
  | SESSION_COORD_CLAUDE_PID="$FAKE_PID_ORD" bash "$ORD_ROOT/a/b/session-coord-hook.sh" deregister >/dev/null 2>&1

if [ ! -d "$ORD_DIR" ]; then
  ok "cleanup runs before the pg-lab existence gate (still fires when pg-lab is absent)"
else
  no "cleanup did not fire with pg-lab script unreachable: $ORD_DIR"
  rm -rf "$ORD_DIR"
fi
rm -rf "$ORD_ROOT"

# --- Final review fixes: CRITICAL — one oversized curated row must not empty the tier ---
# A curated.md whose FIRST (only) row already exceeds the 2048-byte tail window used to
# produce an empty CURATED after the byte-cut recovery dropped the sole (partial) line.
# Manually confirmed against the pre-fix code: a 2527-byte single-row file produced a
# 0-byte CURATED and (with no transcript) no resume.md at all.
SIDCRIT="sess-crit-oversized-row"; LCRIT="$CONTEXT_LEDGER_ROOT/$SIDCRIT"; mkdir -p "$LCRIT"
LONGCLAIM=$(printf 'x%.0s' $(seq 1 2500))
printf 'VERIFIED | %s | some-command\n' "$LONGCLAIM" > "$LCRIT/curated.md"
rowsize=$(wc -c < "$LCRIT/curated.md" 2>/dev/null | tr -d '[:space:]')
printf '{"session_id":"%s"}' "$SIDCRIT" | bash "$PRECOMPACT" >/dev/null 2>&1
# The "VERIFIED |" prefix itself legitimately falls outside the last-2048-byte window and
# is gone — that's expected for a row this oversized. What must survive is the TAIL of the
# row (the fallback CUT), so assert on "some-command" rather than the (correctly absent)
# prefix.
if [ -s "$LCRIT/resume.md" ] && grep -q "some-command" "$LCRIT/resume.md" 2>/dev/null; then
  ok "a single oversized curated row (row=${rowsize}B > 2048B window) still yields a non-empty curated tier"
else
  no "oversized single curated row emptied the curated tier (row=${rowsize}B)"
fi

# ledger-note.sh must reject an oversized claim at write time, before it can ever reach
# curated.md. Same before/after size bracket the other rejection cases in Task 4 use.
SIDCRIT2="sess-crit-oversized-claim"
CLAUDE_CODE_SESSION_ID="$SIDCRIT2" bash "$NOTE" VERIFIED "seed row" "seed cmd" >/dev/null 2>&1
CUR_CRIT="$CONTEXT_LEDGER_ROOT/$SIDCRIT2/curated.md"
BEFORE=$(wc -c < "$CUR_CRIT" 2>/dev/null | tr -d ' ')
OVERSIZED_CLAIM=$(printf 'x%.0s' $(seq 1 600))
if CLAUDE_CODE_SESSION_ID="$SIDCRIT2" bash "$NOTE" VERIFIED "$OVERSIZED_CLAIM" "y" >/dev/null 2>&1; then
  no "ledger-note accepted an oversized (600B) claim"
else
  AFTER=$(wc -c < "$CUR_CRIT" 2>/dev/null | tr -d ' ')
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "oversized claim rejected AND nothing written"
  else
    no "oversized claim rejected but the file grew: $BEFORE -> $AFTER"
  fi
fi

# --- Final review fixes: IMPORTANT 1 — the three scripts are coupled only by the shared
# lib pinning the ledger DIRECTORY; curated.md/resume.md filenames are hardcoded
# independently in each script and a drift would leave every per-script test green. Chain
# the REAL scripts end to end under one session id and assert a sentinel survives all three.
SIDCHAIN="sess-chain-$$"
CHAIN_TX="$TMPROOT/chain.jsonl"
cat > "$CHAIN_TX" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo chain-fixture","description":"Chain fixture Bash call"}}]}}
EOF
CLAUDE_CODE_SESSION_ID="$SIDCHAIN" bash "$NOTE" VERIFIED "chain-sentinel-unique" "echo chain-fixture" >/dev/null 2>&1
printf '{"session_id":"%s","transcript_path":"%s"}' "$SIDCHAIN" "$CHAIN_TX" | bash "$PRECOMPACT" >/dev/null 2>&1
chain_out=$(printf '{"session_id":"%s","source":"compact"}' "$SIDCHAIN" | bash "$RESUME_HOOK" 2>/dev/null)
if printf '%s' "$chain_out" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | grep -q "chain-sentinel-unique"; then
  ok "full chain (ledger-note -> precompact -> session-resume) carries the sentinel through"
else
  no "full chain broke: [$chain_out]"
fi

# --- Final review fixes: IMPORTANT 2 — the digest must carry a build timestamp, so a
# stale resume.md left behind by a run that wrote nothing is identifiable as stale rather
# than silently injected as current. ---
SIDTS="sess-timestamp-$$"
printf '{"session_id":"%s","transcript_path":"%s"}' "$SIDTS" "$FAKE_TX" | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -qE '^Built: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$CONTEXT_LEDGER_ROOT/$SIDTS/resume.md" 2>/dev/null; then
  ok "digest includes a build timestamp"
else
  no "digest missing a build timestamp"
fi

# --- Final review fixes: MINOR 1 — the "(most recent 12)" label must keep each distinct
# command's MOST RECENT occurrence, not its first. Force a real truncation (13 distinct
# commands against the real cap of 12): "recency-marker-alpha" runs first, then 12 distinct
# fillers, then "recency-marker-alpha" reruns last (the true most-recent event overall).
# Pre-fix, awk keeps first-occurrence order and `tail -n 12` drops the FRONT of that list —
# which drops alpha (pinned at the front by its stale first run) and keeps the filler that
# is, in real recency terms, the least recently invoked of the 13.
SID15="sess-task2-recency"; L15="$CONTEXT_LEDGER_ROOT/$SID15"; mkdir -p "$L15"
FAKE_TX5="$TMPROOT/fake-recency.jsonl"
: > "$FAKE_TX5"
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo recency-marker-alpha","description":"Recency marker alpha first run"}}]}}\n' >> "$FAKE_TX5"
i=1
while [ $i -le 12 ]; do
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo recency-filler-%02d","description":"Recency filler %02d"}}]}}\n' "$i" "$i" >> "$FAKE_TX5"
  i=$((i+1))
done
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo recency-marker-alpha","description":"Recency marker alpha first run"}}]}}\n' >> "$FAKE_TX5"

printf '{"session_id":"%s","transcript_path":"%s"}' "$SID15" "$FAKE_TX5" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "recency-marker-alpha" "$L15/resume.md" 2>/dev/null \
   && ! grep -q "recency-filler-01" "$L15/resume.md" 2>/dev/null; then
  ok "floor keeps a command's MOST RECENT occurrence over its stale first-seen slot"
else
  no "floor kept the wrong occurrence at the truncation boundary (recency ordering bug)"
fi

# --- Floor extension: the mechanical floor now joins the command WITH its result ---

# Test: U+R join produces ONE line spanning "<command> ... <result>" — a composed-row
# assertion, not two independent substring checks, so a mutant that emitted the tool_use
# and tool_result as separate unjoined rows (defeating the whole point of the join) cannot
# pass this the way it could pass two separate `grep`s.
SID16="sess-floor-join"; L16="$CONTEXT_LEDGER_ROOT/$SID16"; mkdir -p "$L16"
FAKE_TX6="$TMPROOT/fake-join.jsonl"
cat > "$FAKE_TX6" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_J1","name":"Bash","input":{"command":"npm run test:run","description":"Run full suite"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_J1","content":"...\ntests=52 passed, 0 failed"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID16" "$FAKE_TX6" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -qE 'npm run test:run.*tests=52 passed, 0 failed' "$L16/resume.md" 2>/dev/null; then
  ok "floor joins the command with its actual result on one composed row"
else
  no "floor did not compose the command and its result onto one row"
fi

# Test: a tool_result that MATCHED but carried empty content renders as "(empty)", kept
# distinct from "never got a result at all" — otherwise a command with genuinely no
# stdout (e.g. `mkdir -p`) would be indistinguishable from an in-flight/truncated call.
SID17="sess-floor-empty-result"; L17="$CONTEXT_LEDGER_ROOT/$SID17"; mkdir -p "$L17"
FAKE_TX7="$TMPROOT/fake-empty.jsonl"
cat > "$FAKE_TX7" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_E1","name":"Bash","input":{"command":"mkdir -p some/dir","description":"Ensure scratch dir exists"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_E1","content":""}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID17" "$FAKE_TX7" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Ensure scratch dir exists ← mkdir -p some/dir → (empty)" "$L17/resume.md" 2>/dev/null; then
  ok "a matched-but-empty result renders as (empty), not (no result)"
else
  no "empty result did not render as the distinct (empty) placeholder"
fi

# Test: a Bash call with NO matching tool_result at all (call still in flight, or a
# transcript truncated mid-turn) still produces a row, distinguished as "(no result)".
SID18="sess-floor-no-result"; L18="$CONTEXT_LEDGER_ROOT/$SID18"; mkdir -p "$L18"
FAKE_TX8="$TMPROOT/fake-noresult.jsonl"
cat > "$FAKE_TX8" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_N1","name":"Bash","input":{"command":"long-running-build-step","description":"Kick off a build still in flight"}}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID18" "$FAKE_TX8" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Kick off a build still in flight ← long-running-build-step → (no result)" "$L18/resume.md" 2>/dev/null; then
  ok "a Bash call with no matching tool_result renders as (no result)"
else
  no "unmatched Bash call did not render as (no result)"
fi

# --- Secret redaction: the floor now captures raw command output, which can carry one ---

# Test: a secret in the captured result is redacted VISIBLY, while a legitimate
# neighbouring value on the SAME line survives — asserted in BOTH directions. A filter
# that blanked the whole row (or the whole line) would pass a naive "secret is gone"
# check with nothing left to prove the row wasn't simply nuked wholesale; the neighbour
# check is what makes that mutation fail. Mutation-checked by hand (see report): with
# redact_secrets neutered to a passthrough, this exact fixture surfaces the raw
# "sk-testFAKE..." secret in resume.md — confirming the fixture reaches the digest before
# redaction, and that this assertion actually goes red without the filter.
SID19="sess-floor-secret"; L19="$CONTEXT_LEDGER_ROOT/$SID19"; mkdir -p "$L19"
FAKE_TX9="$TMPROOT/fake-secret.jsonl"
cat > "$FAKE_TX9" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_S1","name":"Bash","input":{"command":"printenv | grep API_KEY","description":"Check API key configuration"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_S1","content":"OPENAI_API_KEY=sk-testFAKEsecretvalue1234567890abcdef tests=52 passed neighbor-value-ok"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID19" "$FAKE_TX9" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "sk-testFAKEsecretvalue1234567890abcdef" "$L19/resume.md" 2>/dev/null; then
  no "secret leaked into the digest unredacted"
elif grep -q 'OPENAI_API_KEY=\[redacted\]' "$L19/resume.md" 2>/dev/null \
     && grep -q "tests=52 passed neighbor-value-ok" "$L19/resume.md" 2>/dev/null; then
  ok "secret redacted (NAME kept, value gone) while a legitimate neighbouring value survives"
else
  no "secret redaction missing, or it over-redacted the legitimate neighbour too"
fi

# Test: a Bearer token is ALSO redacted (a second minimum-coverage pattern from the spec,
# independent of the NAME=value case above), again checked in both directions.
SID20="sess-floor-secret-bearer"; L20="$CONTEXT_LEDGER_ROOT/$SID20"; mkdir -p "$L20"
FAKE_TX10="$TMPROOT/fake-bearer.jsonl"
cat > "$FAKE_TX10" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_B1","name":"Bash","input":{"command":"curl -sI https://api.example.com/health","description":"Probe health endpoint auth"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_B1","content":"HTTP/1.1 200 OK Authorization: Bearer abcDEF123456ghiJKL789 status=ok"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID20" "$FAKE_TX10" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "abcDEF123456ghiJKL789" "$L20/resume.md" 2>/dev/null; then
  no "bearer token leaked into the digest unredacted"
elif grep -q 'Bearer \[redacted\]' "$L20/resume.md" 2>/dev/null \
     && grep -q "status=ok" "$L20/resume.md" 2>/dev/null; then
  ok "bearer token redacted while a legitimate neighbouring value survives"
else
  no "bearer redaction missing, or it over-redacted the legitimate neighbour too"
fi

# --- Follow-up fixes found by inspecting a real transcript (not fixtures) ---

# Test: a canonical UUID (session/task-id shape, 8-4-4-4-12 lowercase hex) SURVIVES the
# high-entropy net, while a REAL secret sharing the same line is still redacted — both
# directions checked, same rule as the earlier secret tests: a filter that exempted
# everything 32+ chars long (not just the UUID shape) would pass a naive "UUID survives"
# check while quietly stopping catching real secrets too.
SID21="sess-floor-uuid-survives"; L21="$CONTEXT_LEDGER_ROOT/$SID21"; mkdir -p "$L21"
FAKE_TX11="$TMPROOT/fake-uuid.jsonl"
cat > "$FAKE_TX11" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_U1","name":"Bash","input":{"command":"echo $SESS; printenv AUTH_TOKEN","description":"Show session id and a token"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_U1","content":"SESS=dd1c98d8-4002-4a4e-b59a-375d2144d9fa AUTH_TOKEN=abcdefghij0123456789ABCDEFGHIJ01"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID21" "$FAKE_TX11" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "SESS=dd1c98d8-4002-4a4e-b59a-375d2144d9fa" "$L21/resume.md" 2>/dev/null \
   && ! grep -q "abcdefghij0123456789ABCDEFGHIJ01" "$L21/resume.md" 2>/dev/null; then
  ok "a canonical UUID survives the entropy net while a real secret on the same line is still redacted"
else
  no "UUID was wrongly redacted, or the real secret next to it survived unredacted"
fi

# Test: a plain kebab-case project-directory slug (all letters/hyphens, no digit — the
# exact shape a real transcript showed being swallowed by the un-gated entropy net)
# survives, while a bare digit-bearing high-entropy blob with NO recognizable secret prefix
# (so only the generic net, not sk-/ghp_/etc., could catch it) is still redacted — proving
# the digit-gate didn't just turn the net off altogether.
SID22="sess-floor-slug-survives"; L22="$CONTEXT_LEDGER_ROOT/$SID22"; mkdir -p "$L22"
FAKE_TX12="$TMPROOT/fake-slug.jsonl"
cat > "$FAKE_TX12" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_G1","name":"Bash","input":{"command":"cd /Users/williamtower/projects/OCRecipes","description":"Change into the project directory"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_G1","content":"-Users-williamtower-projects-OCRecipes a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID22" "$FAKE_TX12" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q -- "-Users-williamtower-projects-OCRecipes" "$L22/resume.md" 2>/dev/null \
   && ! grep -q "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6" "$L22/resume.md" 2>/dev/null; then
  ok "a plain kebab-case path slug survives the net while a bare digit-bearing blob is still redacted"
else
  no "path slug was wrongly redacted, or the bare high-entropy blob survived unredacted"
fi

# Test: a tool_result ending in the Bash tool's own "Session cwd remains" trailer shows the
# REAL preceding output line, not the trailer, as the result tail.
SID23="sess-floor-skip-cwd-remains"; L23="$CONTEXT_LEDGER_ROOT/$SID23"; mkdir -p "$L23"
FAKE_TX13="$TMPROOT/fake-cwdremains.jsonl"
cat > "$FAKE_TX13" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_W1","name":"Bash","input":{"command":"npm run test:run &","description":"Kick off tests in the background"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_W1","content":"Command running in background with ID: bfo53uvv6.\nSession cwd remains /Users/williamtower/projects/OCRecipes; directory changes made by the backgrounded command do not apply to subsequent commands."}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID23" "$FAKE_TX13" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Kick off tests in the background ← npm run test:run & → Command running in background with ID: bfo53uvv6." "$L23/resume.md" 2>/dev/null \
   && ! grep -q "Session cwd remains" "$L23/resume.md" 2>/dev/null; then
  ok "result tail skips the 'Session cwd remains' trailer and shows the real preceding line"
else
  no "result tail showed the harness trailer instead of the real preceding output line"
fi

# Test: same skip, for the "Shell cwd was reset to" trailer — a DIFFERENT wrapper string,
# confirming the skip isn't hardcoded to only the background-command variant above.
SID24="sess-floor-skip-cwd-reset"; L24="$CONTEXT_LEDGER_ROOT/$SID24"; mkdir -p "$L24"
FAKE_TX14="$TMPROOT/fake-cwdreset.jsonl"
cat > "$FAKE_TX14" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_W2","name":"Bash","input":{"command":"cd /tmp && ls","description":"List a scratch directory"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_W2","content":"scratch-file-one.txt\nscratch-file-two.txt\nShell cwd was reset to /Users/williamtower/projects/OCRecipes"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID24" "$FAKE_TX14" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "List a scratch directory ← cd /tmp && ls → scratch-file-two.txt" "$L24/resume.md" 2>/dev/null \
   && ! grep -q "Shell cwd was reset to" "$L24/resume.md" 2>/dev/null; then
  ok "result tail skips the 'Shell cwd was reset to' trailer and shows the real preceding line"
else
  no "result tail showed the harness trailer instead of the real preceding output line"
fi

# Test: if EVERY line is a wrapper trailer (nothing real left after skipping), the row
# still degrades to one of the two EXISTING placeholders rather than erroring or going
# blank — specifically "(empty)", since a tool_result DID match this id (the join succeeded
# — the row shows the real command, not an unrelated one); it simply had nothing but
# wrapper text once filtered, the same outcome as a command whose real stdout was empty.
# "(no result)" stays reserved for the structurally different case (no tool_result matched
# the id at all), covered separately above.
SID25="sess-floor-skip-all-wrapper"; L25="$CONTEXT_LEDGER_ROOT/$SID25"; mkdir -p "$L25"
FAKE_TX15="$TMPROOT/fake-allwrapper.jsonl"
cat > "$FAKE_TX15" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_W3","name":"Bash","input":{"command":"cd /tmp","description":"Only a cd, nothing else"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_W3","content":"Shell cwd was reset to /Users/williamtower/projects/OCRecipes"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID25" "$FAKE_TX15" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "Only a cd, nothing else ← cd /tmp → (empty)" "$L25/resume.md" 2>/dev/null; then
  ok "a result made ENTIRELY of wrapper lines degrades to (empty), not blank or an error"
else
  no "an all-wrapper result did not degrade to the (empty) placeholder"
fi

# --- Follow-up: the entropy net was also redacting bare git commit SHAs ---

# Test: a bare 40-char SHA-1 in a result line SURVIVES the entropy net, while a real secret
# on the SAME line is still redacted — both directions, same rule as every prior secret
# test: a filter that exempted everything (not just the SHA shape) would pass a naive
# "SHA survives" check while quietly letting real secrets through too.
SID26="sess-floor-sha1-survives"; L26="$CONTEXT_LEDGER_ROOT/$SID26"; mkdir -p "$L26"
FAKE_TX16="$TMPROOT/fake-sha1.jsonl"
cat > "$FAKE_TX16" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_SHA1","name":"Bash","input":{"command":"git log --format=%H -1; printenv API_KEY","description":"Show the full commit SHA and a token"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_SHA1","content":"commit f80a9a1d847ed098f292b96d77eefa3a745a3c06 confirmed API_KEY=abcdefghij0123456789ABCDEFGHIJ01"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID26" "$FAKE_TX16" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "f80a9a1d847ed098f292b96d77eefa3a745a3c06" "$L26/resume.md" 2>/dev/null \
   && ! grep -q "abcdefghij0123456789ABCDEFGHIJ01" "$L26/resume.md" 2>/dev/null; then
  ok "a bare 40-char SHA-1 survives the entropy net while a real secret on the same line is still redacted"
else
  no "the SHA-1 was wrongly redacted, or the real secret next to it survived unredacted"
fi

# Test: a bare 64-char run is now REDACTED — the 64-hex (SHA-256) exemption was
# deliberately REMOVED (user decision): 64 hex chars is exactly the shape
# `openssl rand -hex 32` produces (a webhook-signing secret / JWT_SECRET-style value), and
# this repo's own commit hashes are all 40 chars (SHA-1), so exempting 64 bought nothing
# here while carrying real risk. Asserting the change (not just "still exempt") matters:
# a stale test left over from when 64 WAS exempt would silently mask exactly this removal.
SID27="sess-floor-sha256-now-redacted"; L27="$CONTEXT_LEDGER_ROOT/$SID27"; mkdir -p "$L27"
FAKE_TX17="$TMPROOT/fake-sha256.jsonl"
cat > "$FAKE_TX17" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_SHA256","name":"Bash","input":{"command":"docker inspect --format='{{.Id}}' myimage","description":"Show the image digest"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_SHA256","content":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 (sha256 digest)"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID27" "$FAKE_TX17" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if ! grep -q "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" "$L27/resume.md" 2>/dev/null \
   && grep -q "redacted" "$L27/resume.md" 2>/dev/null; then
  ok "a bare 64-char run is now redacted — the 64-hex exemption was intentionally removed"
else
  no "a bare 64-char run unexpectedly survived — the 64-hex exemption removal regressed"
fi

# Test: a short SHA (12 chars, the common `git log --oneline` form) needs no exemption at
# all — confirm it survives because it is already under the net's 32-char floor, rather
# than assume it.
SID28="sess-floor-short-sha-survives"; L28="$CONTEXT_LEDGER_ROOT/$SID28"; mkdir -p "$L28"
FAKE_TX18="$TMPROOT/fake-shortsha.jsonl"
cat > "$FAKE_TX18" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_SHORTSHA","name":"Bash","input":{"command":"git log --oneline -1","description":"Show the short commit SHA"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_SHORTSHA","content":"f80a9a1d847e docs: fix the thing"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID28" "$FAKE_TX18" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "f80a9a1d847e docs: fix the thing" "$L28/resume.md" 2>/dev/null; then
  ok "a short (12-char) SHA survives untouched — already under the net's 32-char floor"
else
  no "a short SHA was unexpectedly altered"
fi

# Regression check: the UUID-survives and slug-survives cases from the prior round are
# re-run here explicitly (not just relied on from earlier in this file) so a change to the
# shared PROTECT_SENTINEL/entropy_net machinery that broke one of them while fixing SHAs
# cannot slip through unnoticed. Kept short (well under format_floor's own 60-char display
# clamp, unrelated to redaction) so a truncated-display false failure can't be confused with
# an actual regression — the earlier SHA-256 test tripped on exactly that distinction.
SID29="sess-floor-uuid-and-slug-still-survive"; L29="$CONTEXT_LEDGER_ROOT/$SID29"; mkdir -p "$L29"
FAKE_TX19="$TMPROOT/fake-uuid-slug-regress.jsonl"
cat > "$FAKE_TX19" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_REG1","name":"Bash","input":{"command":"echo $SESS $PWD","description":"Show session id and project path"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_REG1","content":"-Users-jdoe-widget dd1c98d8-4002-4a4e-b59a-375d2144d9fa"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID29" "$FAKE_TX19" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
if grep -q "dd1c98d8-4002-4a4e-b59a-375d2144d9fa" "$L29/resume.md" 2>/dev/null \
   && grep -q -- "-Users-jdoe-widget" "$L29/resume.md" 2>/dev/null; then
  ok "UUID and kebab-case slug both still survive after the SHA exemption was added"
else
  no "adding the SHA exemption regressed the UUID or slug exemption"
fi

# --- CRITICAL regression (round 4): sentinel-protection ran BEFORE the named-secret-prefix
# rules, so a real secret that IS or CONTAINS an exempted 40-hex shape got fragmented before
# its prefix rule ever saw it — the prefix rule then matched only a truncated remainder (or
# nothing), leaving a "[redacted]" marker sitting next to the LEAKED rest of the real
# secret. Worse than no filter: the marker reads as "handled". These are the cross-product
# cases the earlier per-dimension tests never covered (every "redacted" fixture used a
# value with non-hex characters; every "canonical shape survives" fixture used a bare hex
# run with no secret prefix) — exactly the input class that broke.
#
# Checking only "the full 40-char string is absent" is ITSELF a decorative assertion here —
# caught while writing this: under the exact regression being guarded against, only the
# FIRST 10 of 40 chars get consumed into "[redacted]", leaving a 30-char SUFFIX of the
# secret intact. That 30-char suffix is never equal to the full 40-char string, so a
# "full string absent" check passes against it just as easily as against a real fix —
# manually confirmed by re-running the exact leak from the CRITICAL report through this
# stage in isolation before fixing the test. assert_fully_redacted instead checks each of
# the four disjoint 10-char chunks of the secret individually (so no partial-consumption
# boundary can hide a surviving piece) AND that exactly one "[redacted]" marker appears —
# "a marker appeared somewhere" alone is what made the original leak look safe.
assert_fully_redacted() {
  row="$1"
  for chunk in "a1b2c3d4e5" "f6a1b2c3d4" "e5f6a1b2c3" "d4e5f678ab"; do
    if printf '%s' "$row" | grep -q -- "$chunk"; then
      return 1
    fi
  done
  [ "$(printf '%s' "$row" | grep -o '\[redacted\]' | wc -l | tr -d ' ')" = "1" ]
}

# Test: sk- prefix immediately followed by exactly 40 hex chars -> the WHOLE token
# (prefix + hex) must be gone, and exactly one [redacted] marker must appear on the row.
SID30="sess-crossproduct-sk-40hex"; L30="$CONTEXT_LEDGER_ROOT/$SID30"; mkdir -p "$L30"
FAKE_TX20="$TMPROOT/fake-crossproduct-sk.jsonl"
cat > "$FAKE_TX20" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_XP1","name":"Bash","input":{"command":"curl -sH \"X-Api-Key: $KEY\" https://api.example.com","description":"Cross-product: sk- plus exactly 40 hex"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_XP1","content":"X-Api-Key: sk-a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f678ab"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID30" "$FAKE_TX20" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
ROW30=$(grep "Cross-product: sk-" "$L30/resume.md" 2>/dev/null)
if assert_fully_redacted "$ROW30"; then
  ok "sk- + exactly 40 hex: the full token is gone (all four chunks) and exactly one [redacted] marker appears"
else
  no "sk- + exactly 40 hex leaked part of the token, or did not produce exactly one marker: [$ROW30]"
fi

# Test: ghp_ prefix immediately followed by exactly 40 hex chars -> fully redacted.
SID31="sess-crossproduct-ghp-40hex"; L31="$CONTEXT_LEDGER_ROOT/$SID31"; mkdir -p "$L31"
FAKE_TX21="$TMPROOT/fake-crossproduct-ghp.jsonl"
cat > "$FAKE_TX21" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_XP2","name":"Bash","input":{"command":"printenv GH_TOKEN","description":"Cross-product: ghp_ plus exactly 40 hex"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_XP2","content":"ghp_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f678ab"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID31" "$FAKE_TX21" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
ROW31=$(grep "Cross-product: ghp_" "$L31/resume.md" 2>/dev/null)
if assert_fully_redacted "$ROW31"; then
  ok "ghp_ + exactly 40 hex: the full token is gone (all four chunks) and exactly one [redacted] marker appears"
else
  no "ghp_ + exactly 40 hex leaked part of the token, or did not produce exactly one marker: [$ROW31]"
fi

# Test: "Bearer " immediately followed by exactly 40 hex chars -> fully redacted.
SID32="sess-crossproduct-bearer-40hex"; L32="$CONTEXT_LEDGER_ROOT/$SID32"; mkdir -p "$L32"
FAKE_TX22="$TMPROOT/fake-crossproduct-bearer.jsonl"
cat > "$FAKE_TX22" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_XP3","name":"Bash","input":{"command":"curl -sI https://api.example.com/health","description":"Cross-product: Bearer plus exactly 40 hex"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_XP3","content":"Authorization: Bearer a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f678ab"}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SID32" "$FAKE_TX22" \
  | bash "$PRECOMPACT" >/dev/null 2>&1
ROW32=$(grep "Cross-product: Bearer" "$L32/resume.md" 2>/dev/null)
if assert_fully_redacted "$ROW32"; then
  ok "Bearer + exactly 40 hex: the full token is gone (all four chunks) and exactly one [redacted] marker appears"
else
  no "Bearer + exactly 40 hex leaked part of the token, or did not produce exactly one marker: [$ROW32]"
fi

# Pin the assertion TOTAL, matching every sibling hook suite in this repo
# (test-cmd-detect.sh, test-guard-outward-cli.sh, test-merge-review-guard.sh,
# test-review-stamp-path.sh, test-review-stamp-writer.sh all carry one). Without it a
# SKIPPED assertion — a `command not found` mid-loop, an early exit in a helper, a
# truncated file — subtracts silently and the suite still prints a clean pass/0 fail.
#
# Re-derive this from a clean run when adding or removing a case; never hand-increment
# it. Same caveat as the siblings: this catches a MISSING assertion, not one that never
# ran because the process died before reaching it.

# --- Task 7: the ledger path must be OURS before it is read or written ------------------
# This block exists because the suite passed 69/69 while carrying ZERO symlink, ownership
# or permission assertions — green against a hook that would read an attacker's file
# straight into additionalContext. A clean total is not evidence about a threat the suite
# never asks about.
SYMROOT=$(mktemp -d)
read_ctx() {  # $1=root $2=sid -> additionalContext, or empty
  jq -n --arg s "$2" '{hook_event_name:"SessionStart", source:"compact", session_id:$s}' \
    | CONTEXT_LEDGER_ROOT="$1" bash "$HOOKS_DIR/session-resume-ledger.sh" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null
}

# CONTROL first, and it is load-bearing: every negative below is "no output", which a
# totally broken reader also produces. This proves the reader still reads what it should.
mkdir -p "$SYMROOT/legit"; printf 'LEGIT-MARKER\n' > "$SYMROOT/legit/resume.md"
[ "$(read_ctx "$SYMROOT" legit)" = "LEGIT-MARKER" ] \
  && ok "a ledger we own is still read (control for the refusals below)" \
  || no "control failed: legitimate ledger not read — the refusals below prove nothing"

# The DIRECTORY is the symlink. `-L` on the file inside would be FALSE here (it is a real
# file at the resolved target), so a file-only check passes and the whole directory
# belongs to someone else. This is why the directory is checked first.
SYMTARGET=$(mktemp -d); printf 'PLANTED-DIR-SYMLINK\n' > "$SYMTARGET/resume.md"
ln -s "$SYMTARGET" "$SYMROOT/dirlink"
[ -z "$(read_ctx "$SYMROOT" dirlink)" ] \
  && ok "a symlinked ledger DIRECTORY writes nothing into additionalContext" \
  || no "symlinked ledger directory still reached additionalContext"

# The FILE is the symlink, inside a directory we really own.
mkdir -p "$SYMROOT/filelink"; ln -s "$SYMTARGET/resume.md" "$SYMROOT/filelink/resume.md"
[ -z "$(read_ctx "$SYMROOT" filelink)" ] \
  && ok "a symlinked resume.md writes nothing into additionalContext" \
  || no "symlinked resume.md still reached additionalContext"

# Read-side clamp. The writer's own cap bounds what THIS repo produces and says nothing
# about what it consumes: pre-fix, a 200 KB plant reached additionalContext in full, and
# a 3 MB one emitted zero while exiting 0 (jq --arg hit ARG_MAX) — an accidental OS limit
# that fails silently rather than degrading.
mkdir -p "$SYMROOT/big"; head -c 200000 /dev/zero | tr '\0' 'A' > "$SYMROOT/big/resume.md"
BIGLEN=$(read_ctx "$SYMROOT" big | wc -c | tr -d '[:space:]')
[ "${BIGLEN:-0}" -le 8200 ] \
  && ok "an oversized resume.md is clamped on read (got $BIGLEN bytes)" \
  || no "read-side clamp missing: emitted $BIGLEN bytes"

# EXFILTRATION, the other direction of the same defect: `mkdir -p` succeeds on an existing
# symlink, so without a guard the writers deposit this session's digest inside the
# attacker's directory.
#
# BOTH ROWS BELOW USED TO PASS WITHOUT REACHING A GUARD, which is the failure mode this
# whole block is about: `[ ! -e target ]` is satisfied just as cleanly by a hook that
# exited early as by one the guard refused, so a vacuous row is indistinguishable from a
# working one. Proven by deletion at the time -- with BOTH context_ledger_path_ok lines
# stripped from the writers, both rows stayed green. Each now carries the one input that
# makes the hook actually arrive at its guard, and those inputs are load-bearing:
#   precompact  needs a NON-EMPTY tier. With transcript_path:/dev/null the floor is empty
#               and curated.md absent, so `[ -z "$CURATED" ] && [ -z "$FLOOR" ] -> exit 0`
#               fires ABOVE the guard. Seeding curated.md at the symlink TARGET is what
#               gets past it -- and it must be removed again before the next row, or the
#               seed file itself trips that row's `[ ! -e .../curated.md ]` check.
#   ledger-note reads its sid from the AMBIENT CLAUDE_CODE_SESSION_ID only, never from an
#               argument. Unset (every CI runner) it exits 1 before creating anything; set
#               to this session's own uuid it writes to $EXFROOT/<that-uuid>/ and never
#               touches the plant. `exfil` SPECIFICALLY is what aims it at the symlink;
#               any other value leaves the row vacuous in a new way.
EXFROOT=$(mktemp -d); EXFTARGET=$(mktemp -d)
ln -s "$EXFTARGET" "$EXFROOT/exfil"
printf 'VERIFIED | seed | cmd\n' > "$EXFTARGET/curated.md"
jq -n '{hook_event_name:"PreCompact", session_id:"exfil", transcript_path:"/dev/null"}' \
  | CONTEXT_LEDGER_ROOT="$EXFROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ ! -e "$EXFTARGET/resume.md" ] \
  && ok "the digest writer refuses a symlinked ledger directory" \
  || no "the digest writer deposited into a symlinked directory"
rm -f "$EXFTARGET/curated.md"
CLAUDE_CODE_SESSION_ID=exfil CONTEXT_LEDGER_ROOT="$EXFROOT" \
  bash "$HOOKS_DIR/ledger-note.sh" VERIFIED c e >/dev/null 2>&1
[ ! -e "$EXFTARGET/curated.md" ] \
  && ok "ledger-note refuses a symlinked ledger directory" \
  || no "ledger-note deposited into a symlinked directory"

# The temp file is the one the writer creates FIRST, so it needs its own guard and its own
# row. The fixture makes the DIRECTORY and the final resume.md both legitimate -- a real
# directory we own, and no resume.md at all, which the guard accepts as absent -- so the
# only check that can produce a refusal here is the resume.md.tmp one. Without it the
# digest writes through the link and `mv` renames the link into place.
# NOT named TMPROOT. That is the suite-global hermetic root created at the top of this
# file, and the EXIT trap is single-quoted -- it expands at exit, so reassigning the name
# here made the trap delete THIS fixture and leak the real root instead. Measured before
# the rename: trap removed a different path than it created and left 67 files behind on
# every run, local and CI. Nothing read a wrong path (CONTEXT_LEDGER_ROOT is exported from
# the original value at the top, and every $TMPROOT fixture above is long since consumed),
# so it leaked rather than corrupted -- which is exactly why it stayed invisible at 79/0.
# THE CURATED LEAF. The directory guard tests the DIRECTORY and says nothing about this
# file, and for four review passes a comment claiming otherwise stood here. Measured
# before the fix: a genuine, non-symlink, we-own-it ledger directory at 0700 with a symlink
# planted ONLY at curated.md passed every other guard, the digest was written, and the
# reader emitted the LINKED file's contents into additionalContext. That is attacker-
# authored text reaching model input through the tier that bypasses redact_secrets.
#
# THREE ROWS, because one would not distinguish "refused" from "broken". The control proves
# the reader still reads a legitimate curated.md; the refusal proves the plant does not
# reach additionalContext; and the third proves the refusal empties only THAT TIER rather
# than killing the digest, which is the difference between a guard and a denial of service.
# THE TRANSCRIPT LEAF. Until 2026-09-15 it was the one path this file read with no check
# of any kind, which made it strictly weaker than the ledger leaves: at curated.md an
# attacker-OWNED file is refused by `-O`, while here an attacker-owned file was read, and
# its contents reach additionalContext through the mechanical floor. redact_secrets and
# entropy_net scrub secret SHAPES, not instructions, so a planted directive survives.
#
# FOUR ROWS, and the fourth is the one that keeps the guard honest about its own limits.
TXROOT=$(mktemp -d); TXHOME=$(mktemp -d); TXATT=$(mktemp -d)
tx_write() { printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo %s","description":"%s"}}]}}\n' "$2" "$2" > "$1"; }

# CONTROL: a legitimate glob-found transcript is still read. Every row below is "the plant
# did not appear", which a totally broken reader also produces.
mkdir -p "$TXROOT/legit" "$TXHOME/.claude/projects/real"
tx_write "$TXHOME/.claude/projects/real/legit.jsonl" LEGIT-TX
jq -n '{hook_event_name:"PreCompact", session_id:"legit", transcript_path:""}' \
  | HOME="$TXHOME" CONTEXT_LEDGER_ROOT="$TXROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ "$(read_ctx "$TXROOT" legit | grep -c 'LEGIT-TX')" -ge 1 ] \
  && ok "CONTROL: a legitimate glob-found transcript is still read into the floor" \
  || no "control failed: the legitimate transcript was not read — the refusals prove nothing"

# REFUSAL: a symlink at the glob target must not reach additionalContext.
TXHOME2=$(mktemp -d); mkdir -p "$TXROOT/sym" "$TXHOME2/.claude/projects/real"
tx_write "$TXATT/attacker.jsonl" PLANTED-TX
ln -s "$TXATT/attacker.jsonl" "$TXHOME2/.claude/projects/real/sym.jsonl"
jq -n '{hook_event_name:"PreCompact", session_id:"sym", transcript_path:""}' \
  | HOME="$TXHOME2" CONTEXT_LEDGER_ROOT="$TXROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ "$(read_ctx "$TXROOT" sym | grep -c 'PLANTED-TX')" -eq 0 ] \
  && ok "a symlinked transcript is refused and never reaches additionalContext" \
  || no "a symlinked transcript leaked into additionalContext"

# SCOPE: refusing the transcript must empty the FLOOR only, leaving the curated tier.
TXHOME3=$(mktemp -d); mkdir -p "$TXROOT/scope" "$TXHOME3/.claude/projects/real"
ln -s "$TXATT/attacker.jsonl" "$TXHOME3/.claude/projects/real/scope.jsonl"
printf 'VERIFIED | tx-scope-row | cmd\n' > "$TXROOT/scope/curated.md"
jq -n '{hook_event_name:"PreCompact", session_id:"scope", transcript_path:""}' \
  | HOME="$TXHOME3" CONTEXT_LEDGER_ROOT="$TXROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
TXSCOPE=$(read_ctx "$TXROOT" scope)
{ [ "$(printf '%s' "$TXSCOPE" | grep -c 'tx-scope-row')" -ge 1 ] \
  && [ "$(printf '%s' "$TXSCOPE" | grep -c 'PLANTED-TX')" -eq 0 ]; } \
  && ok "refusing the transcript empties the floor only — the curated tier still writes" \
  || no "refusing the transcript dropped the curated tier too (denial, not a guard)"

# THE LIMIT, asserted rather than only described. Ownership cannot refuse a SAME-UID plain
# file, and the glob is `*/`, so any sibling project dir competes on mtime. This row pins
# that the residual is real and unclosed, so nobody reads the three rows above as covering
# it. If the glob is ever narrowed to this project's own directory, this row reddens and
# forces the comment to be updated with it.
TXHOME4=$(mktemp -d); mkdir -p "$TXROOT/mtime" "$TXHOME4/.claude/projects/real" "$TXHOME4/.claude/projects/evil"
tx_write "$TXHOME4/.claude/projects/real/mtime.jsonl" LEGIT-TX
tx_write "$TXHOME4/.claude/projects/evil/mtime.jsonl" PLANTED-TX
touch "$TXHOME4/.claude/projects/evil/mtime.jsonl"
jq -n '{hook_event_name:"PreCompact", session_id:"mtime", transcript_path:""}' \
  | HOME="$TXHOME4" CONTEXT_LEDGER_ROOT="$TXROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ "$(read_ctx "$TXROOT" mtime | grep -c 'PLANTED-TX')" -ge 1 ] \
  && ok "KNOWN RESIDUAL: a same-uid sibling transcript still wins the mtime race (ownership cannot see it)" \
  || no "the same-uid mtime residual changed — re-measure and update the comment at the transcript guard"

# FILE MODE, not just directory mode. The umask subshells cover only what they enclose, and
# an earlier revision enclosed only the mkdir while claiming every file was ours alone.
MODEROOT=$(mktemp -d)
( umask 022; CLAUDE_CODE_SESSION_ID=modesid CONTEXT_LEDGER_ROOT="$MODEROOT" \
    bash "$HOOKS_DIR/ledger-note.sh" VERIFIED c e >/dev/null 2>&1 )
CURMODE=$(ls -l "$MODEROOT/modesid/curated.md" 2>/dev/null | awk '{print $1}')
case "$CURMODE" in
  -rw-------*) ok "curated.md is created 0600 even under a permissive caller umask" ;;
  *) no "curated.md mode is [$CURMODE] under umask 022, expected -rw-------" ;;
esac

CURROOT=$(mktemp -d); CURTGT=$(mktemp -d)
mkdir -p "$CURROOT/legit"; chmod 700 "$CURROOT/legit"
printf 'VERIFIED | curated-control | cmd\n' > "$CURROOT/legit/curated.md"
jq -n '{hook_event_name:"PreCompact", session_id:"legit", transcript_path:"/dev/null"}' \
  | CONTEXT_LEDGER_ROOT="$CURROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ "$(read_ctx "$CURROOT" legit | grep -c 'curated-control')" -ge 1 ] \
  && ok "CONTROL: a legitimate curated.md is still read into the digest" \
  || no "control failed: a legitimate curated.md was not read — the refusal below proves nothing"

mkdir -p "$CURROOT/plant"; chmod 700 "$CURROOT/plant"
printf 'VERIFIED | CURATED-PLANT | cmd\n' > "$CURTGT/attacker.md"
ln -s "$CURTGT/attacker.md" "$CURROOT/plant/curated.md"
jq -n '{hook_event_name:"PreCompact", session_id:"plant", transcript_path:"/dev/null"}' \
  | CONTEXT_LEDGER_ROOT="$CURROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ "$(read_ctx "$CURROOT" plant | grep -c 'CURATED-PLANT')" -eq 0 ] \
  && ok "a symlinked curated.md is refused and never reaches additionalContext" \
  || no "a symlinked curated.md leaked into additionalContext"

# The refusal must empty ONLY the curated tier. With a real transcript the mechanical floor
# has content, so a digest must still be written -- otherwise a planted file would be a
# denial of the whole ledger rather than a refusal of one tier.
mkdir -p "$CURROOT/floor"; chmod 700 "$CURROOT/floor"
ln -s "$CURTGT/attacker.md" "$CURROOT/floor/curated.md"
jq -n --arg t "$FAKE_TX" '{hook_event_name:"PreCompact", session_id:"floor", transcript_path:$t}' \
  | CONTEXT_LEDGER_ROOT="$CURROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
CURFLOOR=$(read_ctx "$CURROOT" floor)
{ [ -n "$CURFLOOR" ] && [ "$(printf '%s' "$CURFLOOR" | grep -c 'CURATED-PLANT')" -eq 0 ]; } \
  && ok "refusing curated.md empties that tier only — the mechanical floor still writes" \
  || no "refusing curated.md dropped the whole digest (denial of the ledger, not a guard)"

# ledger-note's own side of the same leaf. It already refuses; this pins that rather than
# leaving the two writers asymmetric with only one of them asserted.
mkdir -p "$CURROOT/note"; chmod 700 "$CURROOT/note"
ln -s "$CURTGT/attacker.md" "$CURROOT/note/curated.md"
CLAUDE_CODE_SESSION_ID=note CONTEXT_LEDGER_ROOT="$CURROOT" \
  bash "$HOOKS_DIR/ledger-note.sh" VERIFIED c e >/dev/null 2>&1
[ "$(grep -c 'VERIFIED | c | e' "$CURTGT/attacker.md" 2>/dev/null)" -eq 0 ] \
  && ok "ledger-note refuses a symlinked curated.md and appends nothing through it" \
  || no "ledger-note appended through a symlinked curated.md"

TMPFIXROOT=$(mktemp -d); TMPTARGET=$(mktemp -d)
mkdir -p "$TMPFIXROOT/tmpsid"
printf 'VERIFIED | seed | cmd\n' > "$TMPFIXROOT/tmpsid/curated.md"
ln -s "$TMPTARGET/stolen.md" "$TMPFIXROOT/tmpsid/resume.md.tmp"
jq -n '{hook_event_name:"PreCompact", session_id:"tmpsid", transcript_path:"/dev/null"}' \
  | CONTEXT_LEDGER_ROOT="$TMPFIXROOT" bash "$HOOKS_DIR/precompact-ledger.sh" >/dev/null 2>&1
[ ! -e "$TMPTARGET/stolen.md" ] \
  && ok "the digest writer refuses a symlinked resume.md.tmp" \
  || no "the digest writer wrote through a symlinked resume.md.tmp"

# Restrictive creation. curated.md is the entry point that bypasses redact_secrets, so its
# mode is the one that matters most.
# Same ambient-sid trap as the exfiltration row above, and here it was not merely vacuous
# but RED on every GitHub runner: with CLAUDE_CODE_SESSION_ID unset the hook exits 1, the
# glob matches nothing, PERMDIR is the empty string and the case falls to `no`. Measured
# under `env -u CLAUDE_CODE_SESSION_ID`: "ledger directory mode is [], expected drwx------".
# The path is pinned LITERALLY rather than globbed for the same reason -- a glob that
# matches nothing and a directory with the wrong mode both arrive here as "", and only one
# of them is a real failure. context_ledger_dir's CONTEXT_LEDGER_ROOT branch composes
# "$ROOT/$sid" verbatim, so `permsid` is exactly the directory name to expect.
PERMROOT=$(mktemp -d)
CLAUDE_CODE_SESSION_ID=permsid CONTEXT_LEDGER_ROOT="$PERMROOT" \
  bash "$HOOKS_DIR/ledger-note.sh" VERIFIED c e >/dev/null 2>&1
PERMDIR=$(ls -ld "$PERMROOT/permsid" 2>/dev/null | awk '{print $1}')
case "$PERMDIR" in
  drwx------*) ok "ledger directory is created mode 0700" ;;
  *) no "ledger directory mode is [$PERMDIR], expected drwx------" ;;
esac

rm -f "$SYMROOT/dirlink" "$SYMROOT/filelink/resume.md" 2>/dev/null
rm -f "$EXFROOT/exfil" "$TMPFIXROOT/tmpsid/resume.md.tmp" 2>/dev/null

# THE TWO PRECOMPACT DIRECTORY GUARDS, asserted POSITIONALLY because no behavioural row
# can tell them apart. Both evaluate the same predicate on the same $LEDGER_DIR with
# nothing mutating it in between, so dropping either one alone leaves the suite at 79/0 and
# only dropping BOTH reddens "the digest writer deposited into a symlinked directory" --
# measured. That makes each look like dead code to a per-guard mutation sweep, and the
# repo's own standard is that a measurement written in a comment is not a guard. These two
# rows ARE the guard: delete either check and exactly one row reddens. Source-scanning
# assertions have precedent in this suite family -- test-assert-needle-dash.sh greps the
# source of every test-*.sh and guards the population size the same way.
#
# CEILING, so these rows are not read as more than they are: they assert POSITION, not
# REACHABILITY. Measured -- wrapping the hoisted guard in `if false; then ... fi` leaves it
# matching at the right line number and the suite stays green. The realistic version of that
# is not a literal `if false` but a guard drifting inside a conditional branch during a
# refactor. The behavioural row still covers both-guards-gone, so the residual is bounded to
# "present and correctly placed, but not necessarily executed".
PCL="$HOOKS_DIR/precompact-ledger.sh"
guard_line=$(grep -n '^context_ledger_path_ok "\$LEDGER_DIR" || exit 0$' "$PCL" | cut -d: -f1 | head -1)
# ANCHORED TO THE CODE LINE, not to the substring. The unanchored form matched COMMENTS
# too, which made row 2 silently vacuous: measured, with the write-time guard deleted AND
# one ordinary comment mentioning $LEDGER_DIR/curated.md placed between the reads and the
# mkdir, the suite stayed at 83/0 with both positional rows green while nothing guarded the
# directory at write time. The anchored pattern matches exactly one line, so head-vs-tail
# stops mattering, and if that read is ever refactored the variable goes empty and the
# `[ -n "$read_line" ]` test below reddens the row instead of greening it.
# ANCHOR UPDATED 2026-09-15 when the leaf gained its own guard and the read line became
# `if context_ledger_path_ok ... && [ -r ... ]`. Both rows correctly went RED on the old
# anchor the moment that line changed -- which is the behaviour they were given a round
# earlier, and the reason updating the anchor is a deliberate act rather than a silent one.
read_line=$(grep -n '^if context_ledger_path_ok "\$LEDGER_DIR/curated.md"' "$PCL" | cut -d: -f1 | head -1)
mkdir_line=$(grep -n '^(umask 077; mkdir -p "\$LEDGER_DIR")' "$PCL" | cut -d: -f1 | head -1)
last_guard=$(grep -n '^context_ledger_path_ok "\$LEDGER_DIR" || exit 0$' "$PCL" | cut -d: -f1 | tail -1)
if [ -n "$guard_line" ] && [ -n "$read_line" ] && [ "$guard_line" -lt "$read_line" ]; then
  ok "precompact checks the ledger directory BEFORE reading curated.md"
else
  no "no directory check precedes the curated.md read (guard=$guard_line read=$read_line)"
fi
# `[ -n "$read_line" ]` here, NOT `${read_line:-0}`. The default was the asymmetry: row 1
# tests presence, so an anchor MISS reddens it, while row 2 substituted 0 and its "after the
# tier reads" half became `-gt 0`, trivially true. Measured -- reformat the read line to
# brace style AND delete the write-time guard, and only row 1 fired while row 2 reported
# green over an unguarded write. Both rows now fail on a miss, which is the only safe
# direction for an assertion whose whole job is to notice an absence.
if [ -n "$last_guard" ] && [ -n "$mkdir_line" ] && [ -n "$read_line" ] \
   && [ "$last_guard" -lt "$mkdir_line" ] && [ "$last_guard" -gt "$read_line" ]; then
  ok "precompact re-checks the ledger directory at WRITE time, after the tier reads"
else
  no "no write-time directory check between the reads and mkdir (last=$last_guard mkdir=$mkdir_line)"
fi

# --- Sectioned floor: BLOCKED / UNRESOLVED FAILURES / STATE CHANGES / RECENT COMMANDS ---
# "Last 12 commands" surfaced bookkeeping: a real 2026-09-25 ledger held 12 PR-merge rows and
# none of the session's 18 guard/permission denials, its commits, or its failures. Each kind
# now gets its own section, so filler can only ever evict RECENT rows.
# sect <header-prefix> <file>: the rows under one section header, up to the next blank line.
sect() { awk -v h="$1" 'index($0,h)==1{f=1;next} /^[[:space:]]*$/{f=0} f' "$2" 2>/dev/null; }

SIDS="sess-sections"; LS="$CONTEXT_LEDGER_ROOT/$SIDS"; mkdir -p "$LS"
TXS="$TMPROOT/sections.jsonl"
cat > "$TXS" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_B1","name":"Bash","input":{"command":"eas build --platform ios","description":"Start an EAS build"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_B1","is_error":true,"content":"PreToolUse:Bash hook error: [guard-outward-cli] eas is outward-facing"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_B2","name":"Bash","input":{"command":"rm -rf build","description":"Remove build dir"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_B2","is_error":true,"content":"Permission to use Bash with command rm -rf build has been denied."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_B3","name":"Bash","input":{"command":"gh api user","description":"Check the token owner"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_B3","is_error":true,"content":"PreToolUse:Bash hook error: saw GITHUB_TOKEN=ghp_FAKEaaaaaaaaaaaaaaaaaaaaaaaa1 in args"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_B4","name":"Bash","input":{"command":"git push --force","description":"Force-push the branch"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_B4","is_error":true,"content":"The user doesn't want to proceed with this tool use. The tool use was rejected."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_E1","name":"Edit","input":{"file_path":"/repo/server/denied-edit-sentinel.ts","old_string":"a","new_string":"b"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_E1","is_error":true,"content":"PreToolUse:Edit hook error: Worktree contract: edit outside the declared worktree"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_E2","name":"Edit","input":{"file_path":"/repo/client/success-edit-sentinel.ts","old_string":"a","new_string":"b"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_E2","content":"The file has been updated successfully."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_F1","name":"Bash","input":{"command":"npm run lint -- fixed-later-sentinel","description":"Lint before the fix"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_F1","is_error":true,"content":"Exit code 1\nlint error in foo.ts"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_F2","name":"Bash","input":{"command":"npm run build-still-broken-sentinel","description":"Build still broken"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_F2","is_error":true,"content":"Exit code 2\nerror TS2322: still broken"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_F3","name":"Bash","input":{"command":"curl -s localhost/odd-failure-sentinel","description":"Odd-shaped failure"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_F3","is_error":true,"content":"---\nodd failure tail"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_H1","name":"Bash","input":{"command":"python3 - <<'PY'\nprint('heredoc-one')\nraise SystemExit(1)\nPY","description":"Heredoc one fails"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_H1","is_error":true,"content":"Exit code 1\nheredoc-one failed"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_H2","name":"Bash","input":{"command":"python3 - <<'PY'\nprint('heredoc-two')\nPY","description":"Heredoc two succeeds"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_H2","content":"heredoc-two"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_F1B","name":"Bash","input":{"command":"npm run lint -- fixed-later-sentinel","description":"Lint after the fix"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_F1B","content":"lint clean"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_C1","name":"Bash","input":{"command":"git commit -F /tmp/msg.txt","description":"Commit the fix"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_C1","content":"[feat/x abc1234] fix the thing"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_C2","name":"Bash","input":{"command":"cd repo\ngit push -u origin feat/x","description":"Push branch multi-line"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_C2","content":"branch 'feat/x' set up to track 'origin/feat/x'."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_C3","name":"Bash","input":{"command":"ALLOW_OUTWARD_CLI=1 gh pr merge 1093 --squash","description":"Merge PR 1093"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_C3","content":""}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_M1","name":"Bash","input":{"command":"/usr/bin/git merge-tree --write-tree main feat/x && git merge-base main feat/x","description":"Probe mergeability read-only"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_M1","content":"abc123"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_P1","name":"mcp__github__merge_pull_request","input":{"owner":"o","repo":"r","pullNumber":1093}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_P1","is_error":true,"content":"PreToolUse:mcp__github__merge_pull_request hook error: merge-review-guard: no review record"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_P2","name":"mcp__github__create_pull_request","input":{"owner":"o","repo":"r","title":"t"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_P2","is_error":true,"content":"Permission to use mcp__github__create_pull_request has been denied."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_T1","name":"Bash","input":{"command":"git tag v1.2.0","description":"Tag the release"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_T1","content":""}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_T2","name":"Bash","input":{"command":"git tag -l 'v*'","description":"List release tags"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_T2","content":"v1.1.0"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_T3","name":"Bash","input":{"command":"git tag","description":"Show all tags"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_T3","content":"v1.1.0"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_T4","name":"Bash","input":{"command":"git tag -af v1.2.0 -m 'release'","description":"Force annotate tag combined flags"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_T4","content":""}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_T5","name":"Bash","input":{"command":"git tag --delete v0.9.0","description":"Delete old tag long flag"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_T5","content":"Deleted tag 'v0.9.0'"}]}}
EOF
i=1
while [ $i -le 15 ]; do
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_Q%02d","name":"Bash","input":{"command":"echo filler-%02d","description":"Filler %02d"}}]}}\n' "$i" "$i" "$i" >> "$TXS"
  printf '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_Q%02d","content":"filler-%02d"}]}}\n' "$i" "$i" >> "$TXS"
  i=$((i+1))
done
# A successful Edit and MCP call AFTER the fillers: placed before them, RECENT's own cap would evict them
# and "absent from every section" would pass even if successful edits were kept as rows.
cat >> "$TXS" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_E3","name":"Write","input":{"file_path":"/repo/client/success-edit-sentinel-late.ts","content":"x"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_E3","content":"File created successfully."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_P3","name":"mcp__github__pull_request_read","input":{"method":"get","pullNumber":7777}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_P3","content":"mcp-read-success-sentinel"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_P4","name":"mcp__infra__set_variables","input":{"password":"Hunter2PasswordXyz20","owner":"o"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_P4","is_error":true,"content":"Permission to use mcp__infra__set_variables has been denied."}]}}
EOF
printf '{"session_id":"%s","transcript_path":"%s"}' "$SIDS" "$TXS" | bash "$PRECOMPACT" >/dev/null 2>&1
RS="$LS/resume.md"
BLK=$(sect "BLOCKED" "$RS"); UNR=$(sect "UNRESOLVED FAILURES" "$RS")
STC=$(sect "STATE CHANGES" "$RS"); RCT=$(sect "RECENT COMMANDS" "$RS")

grep -q "eas build --platform ios.*guard-outward-cli\] eas is outward-facing" <<< "$BLK" \
  && ok "BLOCKED carries a guard denial with its full reason (past the 60-char result width)" \
  || no "guard denial missing from BLOCKED: [$BLK]"
grep -q "rm -rf build.*Permission to use Bash" <<< "$BLK" \
  && ok "BLOCKED carries a permission denial" \
  || no "permission denial missing from BLOCKED"
grep -q "denied-edit-sentinel.ts.*Worktree contract" <<< "$BLK" \
  && ok "BLOCKED carries a denied Edit (file path + reason)" \
  || no "denied Edit missing from BLOCKED"
grep -q "git push --force.*doesn't want to proceed" <<< "$BLK" \
  && ok "BLOCKED carries a tool use the user rejected" \
  || no "user-rejected tool use missing from BLOCKED"
if ! grep -q "ghp_FAKEaaaaaaaaaaaaaaaaaaaaaaaa1" "$RS" 2>/dev/null \
   && grep -q 'GITHUB_TOKEN=\[redacted\]' <<< "$BLK"; then
  ok "a secret inside a denial reason is redacted, the row kept"
else
  no "denial-reason secret leaked, or the row was dropped"
fi
grep -q "success-edit-sentinel" "$RS" 2>/dev/null \
  && no "a SUCCESSFUL Edit leaked into the digest (native compaction already lists edits)" \
  || ok "a successful Edit appears in no section"
grep -q "build-still-broken-sentinel" <<< "$UNR" \
  && ok "UNRESOLVED carries a command that failed and was never re-run" \
  || no "still-failing command missing from UNRESOLVED: [$UNR]"
grep -q "odd-failure-sentinel" <<< "$UNR" \
  && ok "UNRESOLVED keys on is_error, not the 'Exit code' wording" \
  || no "an is_error result without 'Exit code' was not classed as a failure"
grep -q "fixed-later-sentinel" <<< "$UNR" \
  && no "a failure re-run SUCCESSFULLY later still shows as unresolved" \
  || ok "a failure fixed by a later successful re-run is not unresolved"
grep -q "Heredoc one fails" <<< "$UNR" \
  && ok "a failed heredoc stays unresolved when a DIFFERENT heredoc later succeeds (full-command key)" \
  || no "a different heredoc's success resolved the failed one (first-line keying)"
grep -q "Commit the fix ← git commit" <<< "$STC" \
  && ok "STATE carries a git commit" \
  || no "git commit missing from STATE: [$STC]"
grep -q "Push branch multi-line" <<< "$STC" \
  && ok "STATE catches git push on line 2 of a multi-line command" \
  || no "a line-2 git push was not classed as a state change"
grep -q "Merge PR 1093 ← ALLOW_OUTWARD_CLI=1 gh pr merge" <<< "$STC" \
  && ok "STATE carries an env-prefixed gh pr merge" \
  || no "env-prefixed gh pr merge missing from STATE"
# `\b` after a verb matched `git merge-tree`/`git merge-base` (a word boundary sits before the
# hyphen) — a real 2026-09-25 digest listed a read-only merge-tree probe as a state change.
grep -q "Probe mergeability read-only" <<< "$STC" \
  && no "read-only git merge-tree/merge-base classed as a state change" \
  || ok "git merge-tree / merge-base are not state changes (verb must end at whitespace)"
# MCP tools: this repo prefers mcp__github__* for PR work and wires merge-review-guard onto
# them, so a denied MCP merge is exactly the call a resumed session would retry.
grep -q "mcp__github__merge_pull_request.*merge-review-guard: no review record" <<< "$BLK" \
  && ok "BLOCKED carries a guard-denied MCP tool call" \
  || no "guard-denied MCP call missing from BLOCKED: [$BLK]"
grep -q "Permission to use mcp__github__create_pull_request" <<< "$BLK" \
  && ok "BLOCKED carries a permission-refused MCP tool call" \
  || no "permission-refused MCP call missing from BLOCKED"
grep -q "mcp-read-success-sentinel\|7777" "$RS" 2>/dev/null \
  && no "a SUCCESSFUL MCP call leaked into the digest" \
  || ok "a successful MCP call appears in no section"
grep -q "Tag the release ← git tag v1.2.0" <<< "$STC" \
  && ok "STATE carries git tag <name>" \
  || no "git tag <name> missing from STATE"
grep -q "Force annotate tag combined flags" <<< "$STC" && grep -q "Delete old tag long flag" <<< "$STC" \
  && ok "STATE carries git tag with combined short flags (-af) and a long flag (--delete)" \
  || no "combined-flag or long-flag git tag missing from STATE: [$STC]"
# A denied non-Bash call shows its input KEYS, never values: redaction keys on NAME=value and
# 32+-char digit runs, and a JSON "password":"<20 chars>" matches neither (measured on #1104).
if ! grep -q "Hunter2PasswordXyz20" "$RS" 2>/dev/null \
   && grep -q "mcp__infra__set_variables.*password" <<< "$BLK"; then
  ok "a denied MCP call shows its input keys, not a short secret value"
else
  no "a denied MCP call leaked its input value, or its row is missing: [$BLK]"
fi
if grep -q "List release tags\|Show all tags" <<< "$STC"; then
  no "read-only git tag / git tag -l classed as a state change"
else
  ok "read-only git tag and git tag -l are not state changes"
fi
rct_n=$(printf '%s\n' "$RCT" | grep -c "Filler")
rct_set=$(grep -o "Filler [0-9][0-9]" <<< "$RCT" | tr '\n' ' ')
if [ "$rct_n" -eq 8 ] && [ "$rct_set" = "Filler 08 Filler 09 Filler 10 Filler 11 Filler 12 Filler 13 Filler 14 Filler 15 " ]; then
  ok "RECENT keeps the newest 8 fillers; filler evicts only RECENT rows ($rct_n rows)"
else
  no "RECENT cap/recency wrong ($rct_n filler rows): [$RCT]"
fi

# --- Standing instruction: a SessionStart hook tells EVERY session how to write a note ---
INSTR="$HOOKS_DIR/session-ledger-instruction.sh"
for src in startup resume compact clear; do
  iout=$(printf '{"session_id":"x","source":"%s"}' "$src" | bash "$INSTR" 2>/dev/null)
  ev=$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$iout" 2>/dev/null)
  ictx=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$iout" 2>/dev/null)
  if [ "$ev" = "SessionStart" ] && grep -q 'bash .claude/hooks/ledger-note.sh VERIFIED' <<< "$ictx"; then
    ok "instruction hook emits the ledger-note instruction for source=$src"
  else
    no "instruction hook silent or malformed for source=$src: [$iout]"
  fi
done
SETTINGS="$HOOKS_DIR/../settings.json"
if jq -e '[.hooks.SessionStart[].hooks[].command] | any(test("session-ledger-instruction\\.sh"))' "$SETTINGS" >/dev/null 2>&1; then
  ok "settings.json registers the instruction hook on SessionStart"
else
  no "instruction hook not registered on SessionStart"
fi
# The allow rule and the instruction must spell the command identically: permission rules
# prefix-match the UNEXPANDED string, so a drift in either reintroduces the prompt.
ictx=$(printf '{"source":"startup"}' | bash "$INSTR" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
if jq -e '.permissions.allow | index("Bash(bash .claude/hooks/ledger-note.sh *)")' "$SETTINGS" >/dev/null 2>&1 \
   && grep -q '`bash .claude/hooks/ledger-note.sh ' <<< "$ictx"; then
  ok "allow rule and instruction text use the same literal ledger-note command"
else
  no "allow rule missing, or the instruction spells the command differently"
fi

# --- Cap: every section full + curated must fit, trimming RECENT first ---
# Curated is 10 rows (~1.2 KB), not the 2 KB window: with BLOCKED at its real cap of 8, a full
# window left no room for any STATE row, and "newest STATE kept" could not be observed.
LEDGER_CAP=6144
SIDX="sess-sections-cap"; LX="$CONTEXT_LEDGER_ROOT/$SIDX"; mkdir -p "$LX"
: > "$LX/curated.md"
i=0
while [ $i -lt 10 ]; do
  printf 'VERIFIED | claim about subsystem behavior number %03d confirmed by direct measurement | inspect-subsystem-%03d.sh --check\n' "$i" "$i" >> "$LX/curated.md"
  i=$((i+1))
done
TXX="$TMPROOT/sections-cap.jsonl"; : > "$TXX"
emit() { # emit <id> <desc> <cmd> <is_error:true|false> <content>
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"%s","name":"Bash","input":{"command":"%s","description":"%s"}}]}}\n' "$1" "$3" "$2" >> "$TXX"
  printf '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"%s","is_error":%s,"content":"%s"}]}}\n' "$1" "$4" "$5" >> "$TXX"
}
PAD="padding-padding-padding-padding-padding-padding-padding-padding-padding-padding"
i=1; while [ $i -le 8 ]; do emit "b$i" "blocked-row-$i $PAD" "blocked-cmd-$i $PAD $PAD" true "PreToolUse:Bash hook error: blocked-reason-$i $PAD"; i=$((i+1)); done
i=1; while [ $i -le 5 ]; do emit "f$i" "failed-row-$i $PAD" "failed-cmd-$i $PAD $PAD" true "Exit code 1\\nfailed-tail-$i $PAD"; i=$((i+1)); done
i=1; while [ $i -le 8 ]; do emit "s$i" "state-row-$i $PAD" "git commit -m state-$i $PAD $PAD" false "state-out-$i $PAD"; i=$((i+1)); done
i=1; while [ $i -le 8 ]; do emit "r$i" "recent-row-$i $PAD" "echo recent-cmd-$i $PAD $PAD" false "recent-out-$i $PAD"; i=$((i+1)); done
printf '{"session_id":"%s","transcript_path":"%s"}' "$SIDX" "$TXX" | bash "$PRECOMPACT" >/dev/null 2>&1
sizeX=$(wc -c < "$LX/resume.md" 2>/dev/null | tr -d '[:space:]'); sizeX=${sizeX:-999999}
echo "INFO: sectioned cap fixture — resume.md=${sizeX} bytes (cap $LEDGER_CAP)"
[ "$sizeX" -le "$LEDGER_CAP" ] \
  && ok "sectioned digest fits the ${LEDGER_CAP}-byte cap with every section full ($sizeX bytes)" \
  || no "sectioned digest over cap ($sizeX bytes)"
if ! grep -q "recent-row-" "$LX/resume.md" && grep -q "state-row-8 " "$LX/resume.md" \
   && ! grep -q "state-row-1 " "$LX/resume.md"; then
  ok "trim order: RECENT emptied before STATE lost its oldest row (newest STATE kept)"
else
  no "trim order wrong between RECENT and STATE"
fi
bf_n=$(grep -cE "blocked-row-[1-8] |failed-row-[1-5] " "$LX/resume.md")
if [ "$bf_n" -eq 13 ] && grep -q "number 009" "$LX/resume.md"; then
  ok "BLOCKED and FAILED rows and the newest curated row survive while STATE is trimmed"
else
  no "trim reached BLOCKED/FAILED/curated too early ($bf_n of 13 kept)"
fi

EXPECTED_TOTAL=123
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL — an assertion was skipped, or the total changed without updating this pin"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
