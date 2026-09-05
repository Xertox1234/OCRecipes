#!/usr/bin/env bash
# Reproduction + regression corpus for guard-outward-cli.sh.
#
# SAFETY: no outward-facing CLI is ever executed. Every construction is passed
# to the hook as a JSON *string*; the hook reads text and prints a decision.
#
# The three P0 todos this serves each record that their reproduction fixtures
# "lived in a session scratchpad and are NOT durable". This file is the
# replacement: regenerate the matrix by running it.
#
# Usage: bash .claude/hooks/repro-outward-cli-corpus.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard-outward-cli.sh"

# ---- degraded-path fixtures (same shape as test-guard-outward-cli.sh) -------
NOJQ_BIN=$(mktemp -d)
for b in bash cat grep; do ln -s "$(command -v "$b")" "$NOJQ_BIN/$b"; done
NOLIB_DIR=$(mktemp -d); cp "$HOOK" "$NOLIB_DIR/guard-outward-cli.sh"
NOAWK_BIN=$(mktemp -d)
for b in bash cat grep sed jq wc tr head env dirname; do
  ln -s "$(command -v "$b")" "$NOAWK_BIN/$b" 2>/dev/null
done
trap 'rm -rf "$NOJQ_BIN" "$NOLIB_DIR" "$NOAWK_BIN"' EXIT

envelope() { jq -cn --arg cmd "$1" '{tool_name:"Bash",tool_input:{command:$cmd}}'; }

decide() {  # $1=mode $2=command -> DENY|ALLOW
  local mode="$1" env_json out
  env_json=$(envelope "$2")
  case "$mode" in
    precise) out=$(printf '%s' "$env_json" | bash "$HOOK" 2>/dev/null) ;;
    nojq)    out=$(printf '%s' "$env_json" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null) ;;
    nolib)   out=$(printf '%s' "$env_json" | bash "$NOLIB_DIR/guard-outward-cli.sh" 2>/dev/null) ;;
    noawk)   out=$(printf '%s' "$env_json" | env PATH="$NOAWK_BIN" "$NOAWK_BIN/bash" "$HOOK" 2>/dev/null) ;;
  esac
  grep -q '"permissionDecision":[[:space:]]*"deny"' <<< "$out" && echo DENY || echo ALLOW
}

reason() {  # $1=command -> deny reason fingerprint (attribution matters: a
            # deny is not evidence the INTENDED check fired -- see spec 2.1)
  local o; o=$(printf '%s' "$(envelope "$1")" | bash "$HOOK" 2>/dev/null)
  grep -q permissionDecision <<< "$o" || { printf '%s' '(allowed)'; return; }
  tr '\n' ' ' <<< "$o" | sed -E 's/.*guard-outward-cli: //; s/ Bypass:.*//' | cut -c1-72
}

# ---- axes ------------------------------------------------------------------
# A row is: ID @@ EXPECTED @@ COMMAND. EXPECTED is what the guard SHOULD say
# once this plan is complete; the matrix's job is to show which are not there
# yet. Generated rows come first, deliberate co-occurrence rows after.

ROWS=()
add() { ROWS+=("$1 @@ $2 @@ $3"); }

# axis: verb family -> a literal, known-denying invocation of each
FAM_IDS=(easupd easbld npmpub railup ghmerge ghcomment ghapi)
FAM_CMDS=(
  'eas update --branch preview'
  'eas build --platform ios --auto-submit'
  'npm publish'
  'railway up'
  'gh pr merge 42'
  'gh pr comment 5 --body hi --repo other/org'
  'gh api repos/o/r -X POST'
)
# axis: glue mechanism applied to the VERB position of each family
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}
  add "lit-$id"    DENY "$cmd"
  add "sufx-$id"   DENY "$(sed -E 's/^([a-z]+ [a-z:]+)/\1>\/dev\/null/' <<< "$cmd")"
  add "pref-$id"   DENY "2>/dev/null $cmd"
  add "vsub-$id"   DENY "$(sed -E 's/^([a-z]+ [a-z:]+)/\1$()/' <<< "$cmd")"
  add "vvar-$id"   DENY "$(sed -E 's/^([a-z]+ [a-z:]+)/\1${UNSET}/' <<< "$cmd")"
done

# axis: flag-boundary donation (C1) -- families with NO masking guard, so the
# assertion is anchored to the C1 mechanism and not to an unrelated branch.
add c1-submit-lit    DENY  'eas build --platform ios --auto-submit'
add c1-submit-colon  DENY  'eas build --platform ios ${x:---auto-submit}'
add c1-submit-bare   DENY  'eas build --platform ios ${x---auto-submit}'
add c1-submit-plus   DENY  'eas build --platform ios ${x:+--auto-submit}'
add c1-repo-lit      DENY  'gh pr comment 5 --body hi --repo other/org'
add c1-repo-colon    DENY  'gh pr comment 5 --body hi ${x:---repo} other/org'
add c1-repo-short    DENY  'gh pr comment 5 --body hi ${x:--R} other/org'
add c1-create-colon  DENY  'gh pr create --title t --body b ${x:---repo} other/org'
add c1-threedash     ALLOW 'gh pr merge 42 --auto ${x:----admin}'

# axis: gh api method value (C2)
add c2-lit           DENY  'gh api repos/o/r -X POST'
add c2-expand        DENY  'gh api repos/o/r -X ${x:-POST}'
add c2-dynamic       DENY  'gh api repos/o/r -X $METHOD'
add c2-readonly      ALLOW 'gh api repos/o/r'
add c2-dynpath       ALLOW 'gh api repos/$OWNER/$REPO'

# axis: mid-token sigil (no boundary exists; only the vanished rendering reaches these)
add mid-backtick     DENY  'gh pr me``rge 42'
add mid-sub          DENY  'gh pr me$()rge 42'
add mid-var          DENY  'gh pr me${UNSET}rge 42'
add mid-eas          DENY  'eas up${UNSET}date --branch preview'

# axis: verb synthesis (verb text never appears literally)
add syn-default      DENY  'gh pr ${v:-merge} 42'
add syn-nocolon      DENY  'gh pr ${v-merge} 42'
add syn-indirect     DENY  'gh pr ${!ind} 42'
add syn-cmdsub       DENY  'gh pr $(printf merge) 42'
add syn-binary       DENY  '${e:-eas} update --branch preview'

# CO-OCCURRENCE rows -- constructed deliberately. A cross product picks ONE
# value per axis, so a guard that fires only when two mechanisms co-occur is
# never reached and passes by AGREEING with the expected result.
add co-pref-sufx     DENY  '2>/dev/null eas update>/dev/null'
add co-sigil-c1      DENY  'eas bu${UNSET}ild --platform ios ${x:---auto-submit}'
add co-mask-c1       DENY  'gh pr merge 42 --auto ${x:---admin}'   # see NOTE below
add co-two-api       DENY  'gh api repos/o/r && gh api -X PUT repos/o/r/pulls/1/merge'
add co-nested-brace  ALLOW 'echo ${a:-${b}}'

# FALSE-POSITIVE controls -- everyday idioms that MUST stay allowed. A control
# that stays green under mutation is not a control; these are re-checked after
# every widening.
add fp-mkdir         ALLOW 'mkdir -p dir/{a,b,c}'
add fp-cpbak         ALLOW 'cp file.txt{,.bak}'
add fp-eslint        ALLOW 'eslint --fix client/src/*.{ts,tsx}'
add fp-forloop       ALLOW 'for i in {1..3}; do echo $i; done'
add fp-redir         ALLOW 'grep -r foo . >/dev/null 2>&1'
add fp-var           ALLOW 'echo ${HOME:-/tmp}'
add fp-ghread        ALLOW 'gh pr view 42'
add fp-ghlist        ALLOW 'gh pr list --limit 5'
add fp-easread       ALLOW 'eas update:list --branch preview'
add fp-npmrun        ALLOW 'npm run build'
add fp-mention       ALLOW 'git commit -m "chore: mentions eas update and gh pr merge"'
add fp-quotedall     ALLOW 'echo "gh pr merge 42"'
add fp-automerge     ALLOW 'gh pr merge 42 --auto'

printf '%-18s | %-6s | %-7s | %-6s | %-6s | %-6s | %s\n' \
  ID EXPECT PRECISE NOJQ NOLIB NOAWK NOTE
printf '%s\n' '-------------------+--------+---------+--------+--------+--------+------'

GAPS=0
for row in "${ROWS[@]}"; do
  id=$( awk -F' @@ ' '{print $1}' <<< "$row")
  exp=$(awk -F' @@ ' '{print $2}' <<< "$row")
  cmd=$(awk -F' @@ ' '{print $3}' <<< "$row")
  p=$(decide precise "$cmd"); j=$(decide nojq "$cmd")
  l=$(decide nolib "$cmd");   a=$(decide noawk "$cmd")
  if [ "$p" = "$exp" ]; then note='ok'; else note="GAP (want $exp)"; GAPS=$((GAPS+1)); fi
  printf '%-18s | %-6s | %-7s | %-6s | %-6s | %-6s | %s\n' "$id" "$exp" "$p" "$j" "$l" "$a" "$note"
done

echo ""
echo "rows=${#ROWS[@]}  precise-path gaps=$GAPS"
echo ""
echo "=== deny-reason attribution (which check actually fired) ==="
for row in "${ROWS[@]}"; do
  id=$( awk -F' @@ ' '{print $1}' <<< "$row")
  cmd=$(awk -F' @@ ' '{print $3}' <<< "$row")
  [ "$(decide precise "$cmd")" = "DENY" ] || continue
  printf '%-18s : %s\n' "$id" "$(reason "$cmd")"
done

# NOTE on co-mask-c1: on the pre-fix tree this row DENIES, but for an unrelated
# reason -- any `$` in the merge clause makes --auto unverifiable at :928, so
# the --admin check at :965 never runs. Controls proving this:
#   gh pr merge 42 --auto $UNRELATED   -> same reason
#   gh pr merge 42 --auto ${x:-hello}  -> same reason
# Read this row's ATTRIBUTION line, never its verdict alone.
