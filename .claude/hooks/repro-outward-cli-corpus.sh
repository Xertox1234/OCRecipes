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

reason() {  # $1=mode $2=command -> deny reason fingerprint (attribution
            # matters: a deny is not evidence the INTENDED check fired -- see
            # spec 2.1 -- and that is just as true on a degraded path as on
            # precise, so this takes the same mode axis decide() does.
  local mode="$1" cmd="$2" env_json o
  env_json=$(envelope "$cmd")
  case "$mode" in
    precise) o=$(printf '%s' "$env_json" | bash "$HOOK" 2>/dev/null) ;;
    nojq)    o=$(printf '%s' "$env_json" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null) ;;
    nolib)   o=$(printf '%s' "$env_json" | bash "$NOLIB_DIR/guard-outward-cli.sh" 2>/dev/null) ;;
    noawk)   o=$(printf '%s' "$env_json" | env PATH="$NOAWK_BIN" "$NOAWK_BIN/bash" "$HOOK" 2>/dev/null) ;;
  esac
  grep -q permissionDecision <<< "$o" || { printf '%s' '(allowed)'; return; }
  tr '\n' ' ' <<< "$o" | sed -E 's/.*guard-outward-cli: //; s/ Bypass:.*//' | cut -c1-72
}

# ---- axes ------------------------------------------------------------------
# A row is: ID @@ EXPECTED @@ COMMAND. EXPECTED is what the guard SHOULD say
# once this plan is complete; the matrix's job is to show which are not there
# yet. Generated rows come first, deliberate co-occurrence rows after.

ROWS=()
add() { ROWS+=("$1 @@ $2 @@ $3"); }

# axis: verb family -> a literal, known-denying invocation of each. The
# VERB_PREFIX is the literal text up to and including the verb word -- for
# most families that is "<tool> <verb>", but gh's families put a namespace
# word ('pr') BEFORE the verb, so the verb prefix is 3 words, not 2. A fixed
# 2-word capture here silently glues onto the namespace instead of the verb
# for exactly those two families -- this is what FAM_NS_* below exists to
# name and keep, rather than let it mislabel a sufx-*/vsub-*/vvar-* row.
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
FAM_VERB_PREFIX=(
  'eas update'
  'eas build'
  'npm publish'
  'railway up'
  'gh pr merge'
  'gh pr comment'
  'gh api'
)
# axis: glue mechanism applied to the VERB position of each family
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}; vp=${FAM_VERB_PREFIX[$i]}
  add "lit-$id"    DENY "$cmd"
  add "sufx-$id"   DENY "$(sed -E "s/^(${vp})/\1>\/dev\/null/" <<< "$cmd")"
  add "pref-$id"   DENY "2>/dev/null $cmd"
  add "vsub-$id"   DENY "$(sed -E "s/^(${vp})/\1\$()/" <<< "$cmd")"
  add "vvar-$id"   DENY "$(sed -E "s/^(${vp})/\1\${UNSET}/" <<< "$cmd")"
done

# axis: NAMESPACE-glued construction -- a real, DISTINCT mechanism from the
# verb-glue above, kept under its own IDs rather than discarded (or worse,
# left silently mislabelling sufx-ghmerge/vsub-ghmerge/vvar-ghmerge and their
# ghcomment counterparts, which is what the fixed 2-word capture used to do).
# Only families with a namespace word between tool and verb (gh's 'pr') have
# this axis; the others have nothing between tool and verb to glue onto.
# EXPECTED=DENY on its own merits, not copied from the verb-glued row: under
# real bash word-splitting, 'gh pr>/dev/null merge 42' tokenizes to argv
# (gh, pr, merge, 42) with stdout redirected -- it genuinely still merges.
FAM_NS_IDS=(ghmerge ghcomment)
FAM_NS_CMDS=(
  'gh pr merge 42'
  'gh pr comment 5 --body hi --repo other/org'
)
FAM_NS_PREFIX=('gh pr' 'gh pr')
for i in "${!FAM_NS_IDS[@]}"; do
  id=${FAM_NS_IDS[$i]}; cmd=${FAM_NS_CMDS[$i]}; np=${FAM_NS_PREFIX[$i]}
  add "nssufx-$id" DENY "$(sed -E "s/^(${np})/\1>\/dev\/null/" <<< "$cmd")"
  add "nsvsub-$id" DENY "$(sed -E "s/^(${np})/\1\$()/" <<< "$cmd")"
  add "nsvvar-$id" DENY "$(sed -E "s/^(${np})/\1\${UNSET}/" <<< "$cmd")"
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

# axis: C1 grammar widening (coordinator ruling, 2026-09-05) -- every other
# bash PARAM shape that can legally precede :-/bare - and still expand to
# attacker text, not just the plain NAME the first C1 pass covered.
# _OUT_FLAG_LEAD's own definition enumerates covered/excluded forms by
# grammar; each DENY row here is one covered form's two-dash case, paired
# with an ALLOW row for that same form's three-dash remainder.
add c1g-pos1-lit     DENY  'gh pr comment 5 --body hi ${1:---repo} other/org'
add c1g-pos1-3dash   ALLOW 'gh pr comment 5 --body hi ${1:----repo} other/org'
add c1g-pos10-lit    DENY  'gh pr comment 5 --body hi ${10:---repo} other/org'
add c1g-ind-lit      DENY  'gh pr comment 5 --body hi ${!v:---repo} other/org'
add c1g-ind-3dash    ALLOW 'gh pr comment 5 --body hi ${!v:----repo} other/org'
add c1g-inddig-lit   DENY  'eas build --platform ios ${!1:---auto-submit}'
add c1g-arrelem-lit  DENY  'gh pr comment 5 --body hi ${a[0]:---repo} other/org'
add c1g-arrelem-3dash ALLOW 'gh pr comment 5 --body hi ${a[0]:----repo} other/org'
add c1g-arrat-lit    DENY  'eas build --platform ios ${a[@]:---auto-submit}'
add c1g-arrstar-lit  DENY  'gh pr comment 5 --body hi ${a[*]:---repo} other/org'
add c1g-bangkeys-lit DENY  'eas build --platform ios ${!a[@]:---auto-submit}'
add c1g-allargs-lit  DENY  'gh pr comment 5 --body hi ${@:---repo} other/org'
add c1g-allargs-3dash ALLOW 'gh pr comment 5 --body hi ${@:----repo} other/org'
add c1g-allargstar   DENY  'eas build --platform ios ${*:---auto-submit}'
add c1g-barebang-lit DENY  'gh pr comment 5 --body hi ${!:---repo} other/org'
add c1g-barebang-3dash ALLOW 'gh pr comment 5 --body hi ${!:----repo} other/org'
# Excluded forms -- must stay ALLOW, per _OUT_FLAG_LEAD's own comment.
add c1g-excl-status  ALLOW 'gh pr comment 5 --body hi ${?:---repo} other/org'
add c1g-excl-length  ALLOW 'gh pr comment 5 --body hi ${#x:---repo} other/org'

# axis: gh api method value (C2)
add c2-lit           DENY  'gh api repos/o/r -X POST'
add c2-expand        DENY  'gh api repos/o/r -X ${x:-POST}'
add c2-dynamic       DENY  'gh api repos/o/r -X $METHOD'
add c2-glued         DENY  'gh api repos/o/r -X${x:-POST}'
add c2-readonly      ALLOW 'gh api repos/o/r'
add c2-dynpath       ALLOW 'gh api repos/$OWNER/$REPO'
# DESIGN CHOICE (guard-outward-cli.sh's own GH_API_CLAUSE= comment has the
# full reasoning): the predicate keys on "a $ ANYWHERE in
# GH_API_CLAUSE once a method flag is present", not "a $ inside the method
# VALUE specifically" — matching this file's own `gh pr merge` CLAUSE
# precedent (the co-mask-c1 row above) for the identical allow/deny shape.
# Accepted over-denial: a real literal GET with an unrelated $ elsewhere in
# the same clause also denies.
add c2-tension       DENY  'gh api repos/o/r -X GET -f note=$SOMETHING'
# False-positive corpus: read-only/benign gh api idioms that must survive the
# new co-occurrence gate untouched (none carry a -X/--method flag, so the new
# check's flag-presence gate excludes them regardless of the $ elsewhere).
add c2-fp-user       ALLOW 'gh api /user'
add c2-fp-paginate   ALLOW 'gh api --paginate repos/o/r/issues'
add c2-fp-jq         ALLOW 'gh api repos/o/r --jq ".[] | .name"'
add c2-fp-getf       ALLOW 'gh api repos/o/r -X GET -f name=value'
add c2-fp-header     ALLOW 'gh api repos/o/r -H "Accept: application/vnd.github+json"'
add c2-fp-methodology ALLOW 'gh api repos/o/r -f notes=$X --methodology=custom'

# axis: gh api literal method + redirect boundary (found while closing C2 via
# this task's own mandated finding-A co-occurrence test; a SEPARATE mechanism
# from C2 itself — the value here is fully literal, no `$` involved). The
# mutating-method check's trailing value boundary was hardcoded to
# `([[:space:]]|$)`, so a literal method glued directly to a trailing
# redirect never matched (the char after "POST" is `>`, neither whitespace
# nor end-of-string) even though real bash still tokenizes POST as its own
# complete argv word. Confirmed a live, silent ALLOW on the pre-Task-5 tree
# (9c9ba75b). Fixed by reusing `${_OUT_POS_SUFFIX}` — the same closer class
# finding A already gave the VERB's own trailing boundary — for the VALUE's
# trailing boundary too.
add ghapi-redir-trail DENY 'gh api repos/o/r -X POST>/dev/null'

# Structural-trap proof (task-5): this block ALLOWS by default, so an EMPTY
# GH_API_CLAUSE would fall through undenied. That path is unreachable only
# because GH_API_RE and the clause cut share one anchor
# (`${_OUT_POS_PREFIX}gh[[:space:]]+api${_OUT_POS_SUFFIX}`) -- proven with the
# brace-glued verb that DID produce an empty clause before the round-2 fix.
# Both DENY, attributed to two different checks (see the attribution section
# below) -- proof the clause is non-empty, not that "empty denies".
add c2-empty-proof-expand DENY 'gh api{,x} -X ${x:-POST}'
add c2-empty-proof-lit    DENY 'gh api{,x} -X POST'

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
add co-redir-mask    DENY  'gh pr merge 42 --auto >anyfile ${x:---admin}'   # redirect + $-sigil co-occurrence; see NOTE2 below
add co-pref-multi    DENY  'gh pr merge 42 --auto ; 2>/dev/null gh pr merge 7'   # leading redirect + multi-occurrence; see NOTE3
add co-pref-dollar   DENY  '2>$LOGFILE gh pr merge 42 --auto'   # leading redirect carrying a $ + real --auto; see NOTE3
add co-two-api       DENY  'gh api repos/o/r && gh api -X PUT repos/o/r/pulls/1/merge'
add co-nested-brace  ALLOW 'echo ${a:-${b}}'
add co-ind-pref      DENY  '2>/dev/null eas build --platform ios ${!v:---auto-submit}'   # C1-grammar-widening x finding B
add co-pos-create    DENY  'gh pr create --title t --body b ${1:---repo} other/org'   # C1-grammar-widening on the create path specifically
add co-c2-predB      DENY  '2>/dev/null gh api repos/o/r -X ${x:-POST}'   # C2 x finding B: leading redirect + unreadable method
add co-c2-predA      DENY  'gh api repos/o/r -X ${x:-POST}>/dev/null'   # C2 x finding A: trailing glued redirect + unreadable method
add co-two-api-c2    DENY  'gh api repos/o/r && gh api repos/o/r -X ${x:-POST}'   # two occurrences, second carries an unreadable method — the pre-existing >1-occurrence ambiguity check fires first

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
add fp-ghcreate      ALLOW 'gh pr create --title x --body y'   # this repo's own sanctioned PR-creation shape (no --repo)
add fp-ghcreate-pref ALLOW '2>/dev/null gh pr create --title x --body y'   # same, + leading redirect (finding B axis); see NOTE4

printf '%-18s | %-6s | %-7s | %-6s | %-6s | %-6s | %s\n' \
  ID EXPECT PRECISE NOJQ NOLIB NOAWK NOTE
printf '%s\n' '-------------------+--------+---------+--------+--------+--------+------'

GAPS=0
ALLGAPS=0
IDS=(); EXPS=(); CMDS=(); PS=(); JS=(); LS=(); AS=()
for row in "${ROWS[@]}"; do
  id=$( awk -F' @@ ' '{print $1}' <<< "$row")
  exp=$(awk -F' @@ ' '{print $2}' <<< "$row")
  cmd=$(awk -F' @@ ' '{print $3}' <<< "$row")
  p=$(decide precise "$cmd"); j=$(decide nojq "$cmd")
  l=$(decide nolib "$cmd");   a=$(decide noawk "$cmd")
  if [ "$p" = "$exp" ]; then note='ok'; else note="GAP (want $exp)"; GAPS=$((GAPS+1)); fi
  if [ "$p" != "$exp" ] || [ "$j" != "$exp" ] || [ "$l" != "$exp" ] || [ "$a" != "$exp" ]; then
    ALLGAPS=$((ALLGAPS+1))
  fi
  IDS+=("$id"); EXPS+=("$exp"); CMDS+=("$cmd"); PS+=("$p"); JS+=("$j"); LS+=("$l"); AS+=("$a")
  printf '%-18s | %-6s | %-7s | %-6s | %-6s | %-6s | %s\n' "$id" "$exp" "$p" "$j" "$l" "$a" "$note"
done

echo ""
echo "rows=${#ROWS[@]}  precise-path gaps=$GAPS  all-path gaps=$ALLGAPS"
echo ""
echo "=== precise-clean, degraded-dirty (hidden from precise-path gaps; invisible in a summary count) ==="
HIDDEN=0
for i in "${!IDS[@]}"; do
  id=${IDS[$i]}; exp=${EXPS[$i]}; cmd=${CMDS[$i]}; p=${PS[$i]}; j=${JS[$i]}; l=${LS[$i]}; a=${AS[$i]}
  if [ "$p" = "$exp" ] && { [ "$j" != "$exp" ] || [ "$l" != "$exp" ] || [ "$a" != "$exp" ]; }; then
    printf '%-18s : want %-5s  precise=%-5s nojq=%-5s nolib=%-5s noawk=%-5s\n' "$id" "$exp" "$p" "$j" "$l" "$a"
    # attribution on the degraded columns too -- a DENY there is no more
    # evidence the intended check fired than a DENY on precise is.
    [ "$j" = DENY ] && printf '%-18s   nojq  reason: %s\n'  '' "$(reason nojq "$cmd")"
    [ "$l" = DENY ] && printf '%-18s   nolib reason: %s\n'  '' "$(reason nolib "$cmd")"
    [ "$a" = DENY ] && printf '%-18s   noawk reason: %s\n'  '' "$(reason noawk "$cmd")"
    HIDDEN=$((HIDDEN+1))
  fi
done
[ "$HIDDEN" -eq 0 ] && echo "(none)"
echo ""
echo "=== deny-reason attribution (which check actually fired) ==="
for row in "${ROWS[@]}"; do
  id=$( awk -F' @@ ' '{print $1}' <<< "$row")
  cmd=$(awk -F' @@ ' '{print $3}' <<< "$row")
  [ "$(decide precise "$cmd")" = "DENY" ] || continue
  printf '%-18s : %s\n' "$id" "$(reason precise "$cmd")"
done

# NOTE on co-mask-c1: on the pre-fix tree this row DENIES, but for an unrelated
# reason -- any `$` in the merge clause makes --auto unverifiable at :928, so
# the --admin check at :965 never runs. Controls proving this:
#   gh pr merge 42 --auto $UNRELATED   -> same reason
#   gh pr merge 42 --auto ${x:-hello}  -> same reason
# Read this row's ATTRIBUTION line, never its verdict alone.
#
# NOTE2 on co-redir-mask (added 2026-09-05, outward-CLI-guard-folded-repair,
# finding A ROUND 2): this is the exact CRITICAL construction a security
# review caught -- the redirect axis (finding A) and the `$`-sigil axis
# (co-mask-c1's masking mechanism) were each tested ALONE and never
# COMBINED, so the guard that fires only on their intersection was never
# reached by any earlier row. On ROUND 1's tree (both branches of
# _OUT_POS_SUFFIX_MERGE_CLAUSE widened with `<`/`>`), this row SILENTLY
# ALLOWED: branch 1 truncated the CLAUSE capture at the `>` in `>anyfile`,
# so `${x:---admin}` -- and the literal `$` the co-mask-c1 unverifiability
# guard at :928 keys on -- never reached $CLAUSE at all, and the check saw
# a clean, fully-verified `--auto` with nothing after it. Real bash argv
# once the redirect is stripped is `gh pr merge 42 --auto --admin`, a
# genuine administrator-override merge -- this was a live bypass, not a
# theoretical one. ROUND 2 reverted branch 1's `<`/`>` addition (keeping it
# on branch 2, a genuinely different closer-position role) specifically to
# close this. DENIES correctly on the shipped tree; same ATTRIBUTION
# caveat as co-mask-c1 applies -- read the reason, not just the verdict.
#
# NOTE3 on co-pref-multi and co-pref-dollar (added 2026-09-05,
# outward-CLI-guard-folded-repair, finding B): the leading-redirect axis
# crossed with two OTHER mechanisms this file already exercises alone.
#   co-pref-multi: pre-fix, the second `gh pr merge` occurrence's leading
#   `2>/dev/null` hid it from the occurrence count entirely -- the count saw
#   only the FIRST (real `--auto`) occurrence and ALLOWED, while real bash
#   runs the SECOND `gh pr merge 7` (no --auto at all) unconditionally. A
#   live bypass, closed by the same _OUT_POS_PREFIX fix that closes the
#   simple leading-redirect cases -- post-fix the count is 2 and the
#   ambiguous-occurrence DENY fires.
#   co-pref-dollar: NOT a bypass -- a NEW accepted over-denial. Because the
#   absorbed leading redirect is now part of the `gh pr merge` CLAUSE capture
#   (CLAUSE= keys off `${_OUT_POS_PREFIX}gh...`, and the prefix match now
#   starts at the redirect, not at `gh`), a `$` inside that redirect
#   (`2>$LOGFILE`) trips the pre-existing "any `$` in CLAUSE is unverifiable"
#   guard and denies a real, uncorrupted `--auto`. Same documented
#   over-broad-in-the-safe-direction behavior as co-mask-c1's own `$VAR`
#   mention, now also reachable via the prefix -- deny direction, never a
#   bypass. Read the ATTRIBUTION line: it reads identically to a real missing
#   `--auto`, which is the disclosure-worthy part.
#
# NOTE4 on fp-ghcreate / fp-ghcreate-pref (added 2026-09-05,
# outward-CLI-guard-folded-repair, finding B): `gh pr create`/`gh pr comment`
# are the OTHER "clause decides an ALLOW" family this file's own CAVEAT warns
# about (the `--repo`/`-R` carve-out in `gh_pr_clause_has_repo`), and neither
# had an `fp-` control before this task even though `pref-ghcomment` already
# exercised the DENY side (a `--repo`-bearing clause). `gh_pr_clause_has_repo`
# cuts its own clause from literal `gh` in $WORDS_DEEP, not from
# `${_OUT_POS_PREFIX}`, so the newly-absorbed leading redirect should never
# reach that cut -- verified directly (both rows ALLOW, precise and
# degraded), closing the one crossing finding B's own five pinned crossings
# did not cover: the create/comment ALLOW-deciding path with a leading
# redirect present.
