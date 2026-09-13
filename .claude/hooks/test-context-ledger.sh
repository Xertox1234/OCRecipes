#!/usr/bin/env bash
# Tests for the context-ledger hooks — run from project root.
# Hermetic: CONTEXT_LEDGER_ROOT redirects all state into a temp dir, so a run never
# touches a real session's ledger.
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

TMPROOT=$(mktemp -d) || exit 1
export CONTEXT_LEDGER_ROOT="$TMPROOT/ledger"
trap 'rm -rf "$TMPROOT"' EXIT

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
# hardcoded reference to this exact string can't drift silently. Unset in a subshell so
# the hermetic CONTEXT_LEDGER_ROOT export above is untouched for every other case.
out=$( unset CONTEXT_LEDGER_ROOT; context_ledger_dir "abc-123" 2>/dev/null )
if [ "$out" = "/tmp/ocrecipes-context-ledger-abc-123" ]; then
  ok "production default path pinned"
else
  no "production default path drifted: [$out]"
fi

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

# Test 10: digest over the cap -> stays within 4KB, newest curated entries survive.
# The pressure MUST come from a large curated.md, not a large transcript: the floor is
# already bounded (12 lines, commands clipped to 100 chars), so a big transcript cannot
# breach the cap and such a test would pass against an unenforced cap. See ledger Ruling 1.
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
if [ "$size" -le 4096 ] && grep -q "sentinel-curated-row" "$L10/resume.md" 2>/dev/null; then
  ok "digest respects the 4KB cap and keeps the newest curated entry ($size bytes)"
else
  no "cap violated or newest curated entry dropped (size=$size)"
fi
# The oldest filler must have been dropped — otherwise nothing was actually bounded.
if grep -q "filler claim number 0 " "$L10/resume.md" 2>/dev/null; then
  no "curated tier was NOT bounded — oldest entry still present"
else
  ok "curated tier bounded: oldest entries dropped"
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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
