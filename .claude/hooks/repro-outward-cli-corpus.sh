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

# axis: INTERIOR REDIRECT (2026-09-07 -- the P0 tracked as
# outward-cli-guard-interior-redirect-defeats-every-family, now closed).
# A redirect BETWEEN two required-adjacent words. Generated across families x
# {glued, spaced-output, spaced-fd} at the TOOL->next-word slot, and again at the
# NAMESPACE->verb slot for every family whose verb is two words after the tool.
#
# ITS OWN FAMILY LIST, deliberately NOT appended to FAM_IDS. The gap was measured
# across TEN families, four of which (gh release, gh repo, railway variable,
# railway service) FAM_IDS does not carry. Adding them there would multiply every
# OTHER axis by four unrelated families at once and flood the before/after per-ID
# diff with movement this change did not cause -- the exact thing NOTE6's
# "attributed by ID, not by subtracting totals" rule exists to keep readable.
#
# EXPECTED=DENY on its own merits, not copied from the lit-* row: bash tokenizes a
# redirect out of argv WHEREVER it sits, so every construction below builds argv
# IDENTICAL to its spaced baseline. Verified by EXECUTION under PATH-shadowed
# argv-printing stubs writing to a sentinel FILE -- a stub reporting on STDOUT
# reads "not invoked" for every row here, because these constructions redirect
# stdout to /dev/null.
#
# THE DEGRADED PATHS ARE NOT ALL CLEAN, and that is a DISCLOSURE, not a regression
# -- same shape as the varithsep-* rows above. crude_smells_outward's [^a-zA-Z]+
# separator absorbs a letter-FREE redirect (2>&1) but NOT a letter-bearing one
# (>/dev/null -- the `dev` breaks the class), and it was deliberately not widened:
# it runs on the no-jq and no-lib paths, which reach it BEFORE/WITHOUT the lib
# source, so interpolating $_CMD_REDIR there would expand to the empty string.
# Recorded in the guard's DOCUMENTED RESIDUALS rather than papered over.
#
# intrnsglue-ghmerge / intrnsglue-ghcomment intentionally duplicate the commands
# of nssufx-ghmerge / nssufx-ghcomment. The overlap is kept rather than special-
# cased: NOTE6 requires new dimensions to be GENERATED, and a hand-carved hole in
# a cross product is how the tool position came to be missing in the first place.
INTR_FAM_IDS=(easupd easbld npmpub railup ghmerge ghcomment ghapi ghrelease ghrepo railvar railsvc)
INTR_FAM_CMDS=(
  'eas update --branch preview'
  'eas build --platform ios --auto-submit'
  'npm publish'
  'railway up'
  'gh pr merge 42'
  'gh pr comment 5 --body hi --repo other/org'
  'gh api repos/o/r -X POST'
  'gh release create v1.0'
  'gh repo delete o/r'
  'railway variable set K=V'
  'railway service delete svc'
)
INTR_FAM_TOOL=(eas eas npm railway gh gh gh gh gh railway railway)
# Empty where the verb sits directly after the tool word (no namespace slot).
INTR_FAM_NS=('' '' '' '' 'gh pr' 'gh pr' '' 'gh release' 'gh repo' 'railway variable' 'railway service')
INTR_SPELL_IDS=(glue sp fd)
INTR_SPELL_SEDS=('\1>\/dev\/null' '\1 >\/dev\/null' '\1 2>\&1')
for i in "${!INTR_FAM_IDS[@]}"; do
  id=${INTR_FAM_IDS[$i]}; cmd=${INTR_FAM_CMDS[$i]}
  tw=${INTR_FAM_TOOL[$i]}; np=${INTR_FAM_NS[$i]}
  for j in "${!INTR_SPELL_IDS[@]}"; do
    sp=${INTR_SPELL_IDS[$j]}; rp=${INTR_SPELL_SEDS[$j]}
    add "intrtool$sp-$id" DENY "$(sed -E "s/^(${tw})/${rp}/" <<< "$cmd")"
    [ -n "$np" ] && add "intrns$sp-$id" DENY "$(sed -E "s/^(${np})/${rp}/" <<< "$cmd")"
  done
done

# axis: TOOL position -- the binary NAME itself split by a vanishing construct.
# ADDED 2026-09-06 (security review of PR #926). THIS AXIS'S ABSENCE IS WHY THE
# REVIEW FOUND FOUR CRITICALS AND THIS FILE FOUND NONE. Every glue axis above
# varies the MECHANISM while holding the POSITION fixed at the verb (or, for
# gh, the namespace). A corpus that varies one axis reproduces the blind spot
# that chose the axis: `e${UNSET}as update --branch preview` -- an OTA publish
# to real users -- was ALLOWED on all four execution paths the entire time, and
# no row here could see it. Confirmed empirically: adding the C1 FIX alone moved
# this file's counts not at all (rows=125 gaps=3 before and after), because
# nothing in it exercised the position the fix repairs.
#
# ONLY VANISHING mechanisms belong at this position, and that is a semantic
# claim, not an oversight. A redirect glued INSIDE a name does not rejoin it:
# real bash tokenizes `e>/dev/null as update` as the command `e` with argument
# `as`, which never invokes `eas`, so DENY would be the wrong expectation. The
# interior-redirect question is a different mechanism with its own todo (see
# NOTE6).
#
# MECHANISM AXIS WIDENED 2026-09-06 (security RE-review of the C1 fix). The
# first version of this axis iterated exactly three mechanisms -- `$()`,
# `${UNSET}`, backtick-pair -- all single-level, and all of which the fix's own
# crude span scanner happens to parse correctly. That is 708edd2d's own critique
# ("a corpus that varies one axis reproduces the blind spot that chose the
# axis") applied one level up: the POSITION axis was added while the MECHANISM
# axis stayed fixed, and the corpus reported rows=163 gaps=3 with the suite at
# 438/0 while `e$(: $(:))as update --branch preview` -- an OTA publish -- was a
# live ALLOW on all four paths. The mechanisms below are chosen to break a
# first-closer scan specifically: a NESTED span, and two spans whose body
# QUOTES a closer character.
# WIDENED AGAIN 2026-09-06 (round-3 review). The previous widening added the
# nested and single-type-quoted-closer mechanisms, and BOTH reviewers then found
# spellings it still could not see — the mechanism axis was the blind spot one
# more level up. Three added here, each defeating a different assumption the
# prefilter used to make:
#   vmixq   quote of one type nested inside the other. Both quote counts come out
#           EVEN while the closer is genuinely inside quotes, which is what broke
#           the "odd count means ambiguous" test.
#   vbareparen  a bare `(` subshell. Carries NO sigil digraph, so no
#           digraph-based enumeration can see it at all.
#   vcasearm    a `case` arm's `)`. Same property, different grammar.
# The last two were ALSO defeated by lib/cmd-detect.sh's own scanner (measured at
# the time: `cmd_words_vanished 'e$( (:) )as update'` -> `e )as update`). THEY
# HAVE SINCE DIVERGED, and the split is the point rather than an inconsistency:
#   vbareparen  CLOSED 2026-09-06 by a per-level paren counter in both shared
#               scanners. These rows now report `ok`.
#   vcasearm    STILL OPEN. That `)` has no matching opener, so no depth
#               arithmetic can reach it, and the obvious keyword tracker is a
#               deny->ALLOW regression generator. Tracked at
#               todos/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
#               Deliberately left as a visible gap: it keeps pointing at a live
#               bypass.
# vcomment: a `(` inside a shell COMMENT. Inert to bash (a comment runs to
# end-of-line), so the substitution's real closer is the `)` on the NEXT line --
# but a paren-counting scanner counts it and the level never closes. This
# mechanism was a live DENY->ALLOW regression that this corpus could not see,
# because every row was single-line and a comment needs a newline to terminate
# (the row parser is newline-safe as of the same change). ADDED 2026-09-06.
TOOL_MECHS=('$()' '${UNSET}' '``' '$(: $(:))' '$(: "x)y")' "\$(: 'a)b')" \
            "\$(: '\"' \"a)b\" )" '$( (:) )' '$(case x in a) : ;; esac)' \
            "\$(: # (
)" '$((:)|(:))')
TOOL_MIDS=(vsub vvar vbt vnest vdqclose vsqclose vmixq vbareparen vcasearm vcomment varithsep)
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}
  for m in "${!TOOL_MECHS[@]}"; do
    # Parameter expansion, not sed: these mechanisms contain `$`, `(`, `)` and
    # quotes, every one of which would need escaping in a sed program. The
    # replacement expands to a VALUE and is not re-scanned, so the sigils stay
    # literal.
    first=${cmd:0:1}; restc=${cmd:1}
    add "tool${TOOL_MIDS[$m]}-$id" DENY "${first}${TOOL_MECHS[$m]}${restc}"
  done
done
# axis: ROUND-4 MECHANISMS (2026-09-06). Four spellings that split a token, none
# of which the fast path's `${` / `$(` / backtick decline can see, generated
# across BOTH glue positions so the position axis is not held fixed -- holding it
# fixed is what hid the TOOL-position class for three rounds.
#
# The two mechanism SHAPES are different and the generator treats them as such:
#   INSERTED  an empty expansion placed BETWEEN two characters. These are the
#             SPECIAL parameters, each one character long, so unlike an ordinary
#             `$name` they terminate against a following letter instead of
#             absorbing it -- `e$!as` really is `e` + `$!` + `as`.
#               r4spec  `$!`   last background pid; empty in a fresh shell
#               r4dig   `$1`   positional; empty with no args
#   RESPELLED a character replaced by another spelling OF ITSELF, so the token
#             is split without inserting anything:
#               r4ansic  `$'\x64'`  ANSI-C quoting
#               r4brange `{d..d}`   brace RANGE -- carries NO `$` and NO
#                        backtick ANYWHERE, which is why no sigil-keyed
#                        enumeration at the fast path can ever be complete.
#                        Note this is a RANGE sharing a token with the binary
#                        or verb, NOT the already-documented `merge{1..3}`
#                        form that follows an intact verb (that one DENIES).
#
# 56 ROWS (4 mechanisms x 2 positions x 7 families), ALL EXPECTED-DENY. They are real,
# reproduced bypasses, pre-existing (they allow on `main` too), and deliberately
# NOT closed in this PR -- see the guard's DOCUMENTED RESIDUALS entries. The rows
# exist so the gap is measured on every run instead of living in a review
# transcript. Verb-position rows additionally INVERT this file's usual asymmetry:
# precise ALLOWs while all three degraded paths DENY.
R4_INS_MECHS=('$!' '$1');       R4_INS_IDS=(r4spec r4dig)
R4_RSP_IDS=(r4ansic r4brange)
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}; vp=${FAM_VERB_PREFIX[$i]}
  # split point 1: TOOL position, immediately after the binary's first char.
  # split point 2: VERB position, at the midpoint of the verb's LAST word --
  # mid-word, not appended after the verb the way vsub-/vvar- do it.
  lw=${vp##* }; lead=${vp%"$lw"}; h=$(( ${#lw} / 2 ))
  vhead="${lead}${lw:0:$h}"; vtail="${lw:$h}"; vrest=${cmd#"$vp"}
  for m in "${!R4_INS_MECHS[@]}"; do
    mech=${R4_INS_MECHS[$m]}; mid=${R4_INS_IDS[$m]}
    add "$mid-tool-$id" DENY "${cmd:0:1}${mech}${cmd:1}"
    add "$mid-verb-$id" DENY "${vhead}${mech}${vtail}${vrest}"
  done
  for m in "${!R4_RSP_IDS[@]}"; do
    mid=${R4_RSP_IDS[$m]}
    for pos in tool verb; do
      if [ "$pos" = tool ]; then c=${cmd:0:1}; pre=''; post=${cmd:1}
      else c=${vtail:0:1}; pre="$vhead"; post="${vtail:1}${vrest}"; fi
      case "$mid" in
        r4ansic)  sp="\$'\\x$(printf '%02x' "'$c")'" ;;
        r4brange) sp="{$c..$c}" ;;
      esac
      add "$mid-$pos-$id" DENY "${pre}${sp}${post}"
    done
  done
done

# axis: BARE-PAREN / CASE-ARM at the VERB and FLAG positions (2026-09-06,
# cmd-detect-bare-paren todo). The TOOL position already carries both mechanisms
# via TOOL_MECHS above; holding the POSITION axis fixed is the blind spot that
# hid the tool-position class for three rounds, so the same two mechanisms are
# generated at the other two positions rather than hand-listed at one.
#
# The two mechanisms differ in what closes them, and the split is the point:
#   vbareparen  a bare `(` subshell -- CLOSED by the per-level paren counter now
#               in lib/cmd-detect.sh's two scanners. Expected `ok`.
#   vcasearm    a `case` arm's `)` -- an unmatched closer with NO opener, which
#               no depth arithmetic can reach. Still a GAP by design; see NOTE6
#               and todos/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
# varithsep / varithdecoy: added 2026-09-07 because this corpus was BLIND to the
# entire class the arithmetic-arm removal closes. Running all 308 rows across
# main / pre-fix / post-fix gave `head_DENY - base_DENY = {}` — no losses, but no
# GAINS either, so the differential came back clean while a hand-built
# construction found a CRITICAL. A corpus that cannot see a change's security
# gain cannot testify to it.
#   varithsep    `$((:)|(:))` -- a command SUBSTITUTION bash executes, which the
#                deleted verbatim-copy arm preserved. Seventeen sibling
#                separator spellings behave identically; one stands for the axis.
#   varithdecoy  `$(sq)\c(sq)` before the split. The `\c` arm consumed the CLOSING
#                quote, so state 3 never exited and every later byte was mangled
#                — a DENY->ALLOW regression this PR introduced and then fixed.
#                The decoy is a PREFIX, so this row also pins that the corruption
#                does not travel forward.
SPAN2_MECHS=('$( (:) )' '$(case x in a) : ;; esac)' "\$(: # (
)" '$((:)|(:))')
SPAN2_IDS=(vbareparen vcasearm vcomment varithsep)
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}; vp=${FAM_VERB_PREFIX[$i]}
  lw=${vp##* }; lead=${vp%"$lw"}; h=$(( ${#lw} / 2 ))
  vhead="${lead}${lw:0:$h}"; vtail="${lw:$h}"; vrest=${cmd#"$vp"}
  for m in "${!SPAN2_MECHS[@]}"; do
    add "verb${SPAN2_IDS[$m]}-$id" DENY "${vhead}${SPAN2_MECHS[$m]}${vtail}${vrest}"
  done
done

# The span cap must not be a decision boundary. Before the fix this had a sharp
# edge: 199 leading empty spans DENIED and 200 ALLOWED, because the scanner's
# fixed 200-iteration limit was reached and the needle never reformed. Pinned
# on BOTH sides of that old edge, plus well past it.
_capline() { local i=0 p=""; while [ $i -lt "$1" ]; do p="$p\${z}"; i=$((i+1)); done; printf '%s%s' "$p" "$2"; }
add cap-199-ghmerge DENY "$(_capline 199 'g${x}h pr merge 42')"
add cap-200-ghmerge DENY "$(_capline 200 'g${x}h pr merge 42')"
add cap-250-ghmerge DENY "$(_capline 250 'g${x}h pr merge 42')"
add cap-250-easupd  DENY "$(_capline 250 'e${x}as update --branch preview')"

# CLOSER-AFTER-THE-VERB axis (2026-09-06, round 3). Every span row above places
# the gated verb at the END of the command, so nothing exercised a closer
# appearing AFTER it — and that position is exactly what defeated the greedy
# rendering the round-3 repair removed (greedy deleted from the first opener to
# the LAST closer, so a trailing `(echo done)` swallowed the verb). Held fixed,
# it was invisible; varied, it is one line. Paired with its own control, since
# the whole point is that only the trailing subshell differs.
add trailclose-easupd DENY 'e$(: $(:))as update --branch preview && (echo done)'
add trailclose-ctl    DENY 'e$(: $(:))as update --branch preview && echo done'
add trailclose-ghmrg  DENY 'g$(: $(:))h pr merge 42 && (echo done)'

# axis: FLAG position -- a flag NAME the guard keys on, split by a vanishing
# construct. ADDED 2026-09-06 with the tool axis and for the same reason: the
# review's findings C3 and C4 both live here and no row covered the position.
# Each entry names the flag and where to cut it; the cut point is inside the
# flag's own letters, so the two halves can only rejoin by DELETING the span --
# which is exactly what the consumers had to be taught to look at.
# `gh pr merge --admin` gets its own family: --admin is absent from the ghmerge
# base command above (that row exists to exercise the --auto carve-out), and
# --admin is the grant-adjacent one -- with no deny, the carve-out proceeds on
# an administrator merge that bypasses branch protection.
FAM_FLAG_IDS=(easbld ghcomment ghapi ghadmin)
FAM_FLAG_CMDS=(
  'eas build --platform ios --auto-submit'
  'gh pr comment 5 --body hi --repo other/org'
  'gh api repos/o/r -X POST'
  'gh pr merge 42 --auto --admin'
)
FAM_FLAG_LHS=('--auto-su' '--re' '-'  '--ad')
FAM_FLAG_RHS=('bmit'      'po'   'X'  'min')
for i in "${!FAM_FLAG_IDS[@]}"; do
  id=${FAM_FLAG_IDS[$i]}; cmd=${FAM_FLAG_CMDS[$i]}
  lhs=${FAM_FLAG_LHS[$i]}; rhs=${FAM_FLAG_RHS[$i]}
  # Parameter expansion, not sed: the flag text contains `-` and the
  # replacements contain `$`/backticks, both of which need escaping in a sed
  # program and neither of which does here. A `$new` in the replacement position
  # expands to its VALUE and is not re-scanned, so the sigils stay literal.
  for m in '$()' '${UNSET}' '``'; do
    case "$m" in '$()') mid=vsub ;; '${UNSET}') mid=vvar ;; *) mid=vbt ;; esac
    new="${lhs}${m}${rhs}"
    add "flag${mid}-$id" DENY "${cmd/${lhs}${rhs}/$new}"
  done
  # SPAN2 (bare paren / case arm) at this same FLAG position -- the second half
  # of the axis whose verb-position half is generated above, kept here because
  # FAM_FLAG_* is not defined until this point in the file.
  for m in "${!SPAN2_MECHS[@]}"; do
    new="${lhs}${SPAN2_MECHS[$m]}${rhs}"
    add "flag${SPAN2_IDS[$m]}-$id" DENY "${cmd/${lhs}${rhs}/$new}"
  done
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
add c1-threedash     DENY  'gh pr merge 42 --auto ${x:----admin}'   # masked, not a C1 over-denial; see NOTE5

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
# full reasoning): the predicate keys on "a $ or backtick ANYWHERE in
# GH_API_CLAUSE once a method flag is present", not "a $ or backtick inside
# the method VALUE specifically" — matching this file's own `gh pr merge`
# CLAUSE precedent (row co-mask-c1 in this same file) for the identical
# allow/deny shape. Accepted over-denial: a real literal GET with an
# unrelated $ elsewhere in the same clause also denies.
add c2-tension       DENY  'gh api repos/o/r -X GET -f note=$SOMETHING'
# A second unreadable-value SPELLING (found by constructing the legacy
# command-substitution form). Observation, not an enforced property: the C2
# axis's own preceding deny rows (c2-lit, c2-expand, c2-dynamic, c2-glued,
# c2-tension) all happen to carry a literal `$` character, so without this
# row the C2 corpus would only ever pin the implementation detail ("contains
# a dollar sign") rather than the ruled MECHANISM ("not literal text"). This
# row alone carries no `$` at all. Confirmed
# a live, silent ALLOW before the fix's own backtick widening: WORDS_DEEP
# keeps a NON-empty backtick pair's literal text intact (a DIFFERENT
# mechanism from the mid-backtick row's EMPTY pair, which vanishes and fuses
# the surrounding text instead).
add c2-backtick      DENY  'gh api repos/o/r -X `printf POST`'
# False-positive corpus: read-only/benign gh api idioms that must survive the
# new co-occurrence gate untouched (none carry a -X/--method flag, so the new
# check's flag-presence gate excludes them regardless of the $ or backtick
# elsewhere).
add c2-fp-user       ALLOW 'gh api /user'
add c2-fp-paginate   ALLOW 'gh api --paginate repos/o/r/issues'
add c2-fp-jq         ALLOW 'gh api repos/o/r --jq ".[] | .name"'
add c2-fp-getf       ALLOW 'gh api repos/o/r -X GET -f name=value'
add c2-fp-header     ALLOW 'gh api repos/o/r -H "Accept: application/vnd.github+json"'
add c2-fp-methodology ALLOW 'gh api repos/o/r -f notes=$X --methodology=custom'
add c2-fp-backtick   ALLOW 'gh api repos/o/r --jq ".[] | .name" -f note=see `code` here'
add c2-tension-bt    DENY  'gh api repos/o/r -X GET -f note=see `code` here'
# UNHANDLED GAP, CONFIRMED LIVE (guard-outward-cli.sh's own DOCUMENTED
# RESIDUALS header has the full writeup) -- an ANSI-C hex-escape inside
# $'...' evaluates to a literal mutating method in real bash
# (VAL=$'\x50\x4f\x53\x54'; echo "$VAL" prints POST) but this hook's own
# word-splitting renders each \xNN escape as an alphanumeric placeholder,
# leaving neither the literal method text nor a $/backtick sigil in the
# clause -- confirmed a live, silent ALLOW against the real hook. EXPECTED
# is what a future fix should produce; not fixed in this task (the root
# cause is lib/cmd-detect.sh's shared placeholder rendering, off-limits
# here).
add c2-ansic-hex     DENY  'gh api repos/o/r -X $'\''\x50\x4f\x53\x54'\'

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
# ADDED 2026-09-06 (security review of PR #926). The review named the absence of
# a `C2 x vanishing sigil` co-occurrence row as a gap, and that row IS finding
# C2: `gh a${UNSET}pi repos/o/r -X ${METHOD}` was a live ALLOW. It is the exact
# shape this whole CO-OCCURRENCE section exists for -- each half alone DENIES
# (both controls are directly below), and only together did they cancel, because
# the ONE deletion that rejoins `api` for the clause cut also deletes the
# `${METHOD}` sigil the unreadable-method check keys on. No cross product could
# have reached it: it needs the same mechanism at two positions at once.
add co-c2-toolsplit  DENY  'gh a${UNSET}pi repos/o/r -X ${METHOD}'
add co-c2-toolsub    DENY  'gh a${UNSET}pi repos/o/r -X $(printf POST)'
add co-c2-halfA      DENY  'gh api repos/o/r -X ${METHOD}'          # control: unreadable method alone
add co-c2-halfB      DENY  'gh a${UNSET}pi repos/o/r -X POST'       # control: split verb alone
# The narrowing that keeps the span-derived rule from denying every dynamic
# route: a split verb with NO method flag is still a read, and stays allowed.
add fp-c2-noflag     ALLOW 'gh a${UNSET}pi repos/o/r'

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
  # Parameter expansion, NOT awk: awk is line-oriented, so a row whose COMMAND
  # contains a newline had only its first line extracted. That silently excluded
  # every multi-line construction from this corpus -- including a `#` comment
  # inside a substitution, which needs a newline to terminate and which was a
  # live DENY->ALLOW regression no row here could see (2026-09-06 security
  # review). Parameter expansion is newline-safe and needs no subprocess.
  id=${row%% @@ *}; _rest=${row#* @@ }
  exp=${_rest%% @@ *}; cmd=${_rest#* @@ }
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
  id=${row%% @@ *}; _rest=${row#* @@ }; cmd=${_rest#* @@ }
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
#
# NOTE5 on c1-threedash (expectation CORRECTED 2026-09-05,
# outward-CLI-guard-folded-repair, Task 7 pre-flight): this row was filed
# expecting ALLOW as C1's over-matching control -- a three-dash remainder
# (`${x:----admin}`) leaves real argv carrying `---admin`, not `--admin`, so
# no administrator override actually happens and C1's fix must not deny it.
# The mechanism reasoning is right; the FAMILY is wrong. It sits on `gh pr
# merge`, the one family where a pre-existing coarse guard (`grep -qF '$'` on
# the merge clause => --auto unverifiable) denies EVERY `$`-bearing clause
# before the `--admin` boundary check ever runs. ALLOW is therefore
# unreachable here without weakening that guard, which we do not want.
# Attribution measured live 2026-09-05, same technique as spec 2.1 -- these
# three produce the IDENTICAL deny reason, and two of them contain no flag at
# all, so the deny cannot be C1's:
#   gh pr merge 42 --auto ${x:----admin}  -> "without a REAL --auto flag"
#   gh pr merge 42 --auto ${x:-hello}     -> "without a REAL --auto flag"  [control]
#   gh pr merge 42 --auto $HOME           -> "without a REAL --auto flag"  [control]
# while the same three-dash shape on the two UNMASKED families correctly
# ALLOWs (`eas build ... ${x:----auto-submit}`, `gh pr comment ...
# ${x:----repo} other/org`), which is where C1's real over-matching controls
# live: the five green c1g-*-3dash rows. This row is retained, flipped to
# DENY, as a PIN on the masking guard itself: if `:928` is ever narrowed this
# row flips to ALLOW and reappears as a gap, which is the correct signal that
# the `--admin` boundary check has started to matter. Read its ATTRIBUTION
# line, never its verdict alone -- same rule as co-mask-c1.
#
# NOTE6 -- THE THREE ROWS THAT ARE STILL GAPS, AND WHY THEY STAY GAPS
# (2026-09-06, outward-CLI-guard-folded-repair, Tasks 7-9 complete).
#
# READ THIS FIRST (added 2026-09-06, security review of PR #926). "gaps=3" is a
# statement about THE ROWS IN THIS FILE, never about the guard. A corpus can
# only report on the axes it varies, and this one's original glue axis varied
# the sigil MECHANISM while holding the POSITION fixed at the verb. The review
# generated 272 rows from 5 glue POSITIONS x 7 mechanisms and found 105 branch
# ALLOWs, four of them CRITICAL — including `e${UNSET}as update --branch
# preview`, an OTA publish to real users, allowed on all four execution paths.
# This file reported gaps=3 throughout, and adding the fix for that CRITICAL
# alone changed its counts not at all.
#
# Two consequences, both binding on whoever reads this next:
#   1. The tool- and flag-position axes now exist above. Any NEW dimension
#      (a position, a mechanism, a path) must be added as a GENERATED axis, not
#      as hand-listed rows — hand-listing is what silently fixed the position.
#   2. A sentence of the form "this class is closed", anywhere in this
#      repository, may not cite this file unless the class's own dimensions are
#      dimensions this file generates. The wording corrected at
#      guard-outward-cli.sh's WORDS_VANISHED assignment failed exactly that test.
#
# GAP INVENTORY, 2026-09-06 after the cmd-detect bare-paren + vanishing-allow-list
# change. `rows=326  precise-path gaps=33  all-path gaps=120` WAS the correct
# expected output of this file.
#
# SUPERSEDED 2026-09-07 by the interior-redirect absorber (_OUT_SEP). The CURRENT
# correct output is `rows=377  precise-path gaps=31  all-path gaps=154`.
# Attributed BY ID against the pre-change tree, one corpus against two
# implementations, never by subtracting totals:
#
#   precise-path dirty  84 -> 31   53 CLOSED, **0 OPENED**
#   all-path dirty     171 -> 154  17 CLOSED, **0 newly dirty**
#
# The 53: the 51 NEW intrtool-*/intrns-* rows (which allowed on the pre-change
# tree, hence the 84 denominator) plus the 2 pre-existing nssufx-* rows. The 33
# unrelated pre-existing gaps went to 31 for exactly that reason and no other.
#
# ALL-PATH MOVED LESS THAN PRECISE, AND THAT IS THE DISCLOSURE, NOT A MISS: the
# degraded mirror (crude_smells_outward) was deliberately NOT widened, so its
# [^a-zA-Z]+ separator still absorbs a letter-FREE redirect (2>&1) and still
# misses a letter-bearing one (>/dev/null). Widening it is not a one-line change
# deferred out of laziness -- that function runs on the no-jq and no-lib paths,
# which reach it BEFORE/WITHOUT the lib source, so interpolating $_CMD_REDIR
# there would expand to the EMPTY STRING: no error, suite green, and the
# separator silently reduced to nothing. Recorded in the guard's DOCUMENTED
# RESIDUALS.
#
# THE 18 varithsep-* ROWS ARE NEW (2026-09-07) AND SEVEN OF THEM ARE
# PRECISE-CLEAN / DEGRADED-DIRTY, which is why all-path went 113 -> 120 while
# precise-path stayed at 33. That +7 is a DISCLOSURE, not a regression: the rows
# did not exist before, the precise path denies all 18, and the degraded mirror
# (_out_crude_vanish) was deliberately NOT widened in this change — a scope
# decision recorded rather than absorbed.
#
# They exist because this corpus was BLIND to the security gain of the same
# change. Run across main / pre-fix / post-fix, all 308 previous rows gave
# `head_DENY - base_DENY = {}`: no losses, and no GAINS either. The differential
# came back clean while a hand-built construction found a CRITICAL. A corpus that
# cannot see a change's gain cannot testify to it, and "0 opened" from such a
# corpus is a weaker statement than it looks.
#
# THE 18 vcomment-* ROWS ARE `ok` ON BOTH SIDES, and they are here because of what
# they caught while the change was in flight. A `(` inside a shell COMMENT is
# inert to bash, but the bare-paren counter counted it, so the substitution level
# never closed and the rendering came back EMPTY -- a DENY->ALLOW regression on a
# real OTA publish, on a branch where this corpus reported 60 clean closures and
# zero problems. It could not see it: every row was single-line, and a comment
# needs a newline to terminate. The row parser is newline-safe now, and the
# mechanism is generated at all three positions.
#
# THAT SENTENCE ORIGINALLY ENDED "so the blind spot cannot reopen." RETRACTED
# 2026-09-07: it reopened one review round later, by COMPOSING two mechanisms this
# file already generates separately. `e$( (: # (` newline `) )as update` defeats
# BOTH halves of the union and ALLOWs on every path, and no row here can see it,
# because every TOOL_MECHS/SPAN2_MECHS entry is ONE mechanism. That is the same
# root cause as the single-line blindness above, one level up: a corpus that
# varies mechanisms one at a time cannot see a defect that needs two at once.
# Tracked at
# todos/archive/P1-2026-09-07-outward-cli-guard-threat-model-decision.md
# The fix was to UNION the paren-counting rendering with a paren-blind one rather
# than substitute it -- which is this file's own governing rule, applied one layer
# down.
#
# HISTORY OF THE NUMBER, so nobody reads a movement as a regression: it was 3
# while the corpus was blind to the tool and flag POSITIONS, went UP to 73 when
# those axes were added (the corpus finally SEEING classes, not the guard getting
# worse), and is now 33 because 60 rows were genuinely closed.
#
# ATTRIBUTED BY ID, NOT BY SUBTRACTING TOTALS. The current corpus was run against
# BOTH the pre-change hook+lib (b01fcff2) and the current one — one question
# against two implementations, which is the only like-for-like form; comparing an
# old corpus's count against a new corpus's count compares two different
# questions. Per-ID `comm` of the two dirty sets:
#
#   precise-path gaps  93 -> 33   60 CLOSED, **0 OPENED**
#   all-path gaps     145 -> 113  32 CLOSED, **0 newly dirty**
#
# The zero on BOTH "opened" axes is the check that matters, and it is a per-ID
# set difference, not a total. A summary count cannot express a row getting
# strictly worse (docs/solutions/code-quality/summary-count-cannot-express-a-row-
# getting-strictly-worse-2026-09-06.md), and an earlier revision of this note was
# corrected for exactly that arithmetic.
#
# THE 60 CLOSED, counted BY ID (21 + 21 + 17 + 1 = 60):
#   21  r4spec-/r4dig-/r4ansic-VERB-* (7 families each) — the special parameters
#       and the ANSI-C respelling at the verb position. cmd_words_vanished now
#       deletes `$!`, `$@`, `$*` and `$1`..`$9` and DECODES ANSI-C escapes.
#   21  the same three mechanisms at the TOOL position. These needed BOTH halves:
#       the lib fix AND guard-outward-cli.sh's STAGE 3 decline set, which keyed
#       on `${`/`$(`/backtick and so cheap-exited before the rendering was ever
#       computed. A lib-only change could not have moved them.
#   17  the bare-paren mechanism, from the per-level paren counter now in BOTH
#       shared scanners: toolvbareparen-* (7), verbvbareparen-* (7, new axis
#       below) and flagvbareparen-* (3, new axis below).
#
#       THREE, not four, and the fourth is an attribution lesson rather than an
#       off-by-one: flagvbareparen-ghadmin was ALREADY denying before this change,
#       from the "gh pr merge without a REAL --auto" rule, because the construct
#       breaks the `--auto` spelling in its base command. It reports `ok` on both
#       sides and so is not a closure. A verdict is not evidence the intended
#       check fired.
#    1  c2-ansic-hex, as a SIDE EFFECT of the ANSI-C decoding rather than by a
#       change aimed at it: the vanished rendering now reduces
#       `-X $'\x50\x4f\x53\x54'` to a literal `-X POST`, which the
#       mutating-method branch matches. Its own entry below is updated.
#       Confirmed by ID in the before/after diff, not predicted in advance.
#
# FULL ATTRIBUTION of the remaining precise-path gaps. Was 14 + 17 + 2 = 33;
# the `2` bucket closed on 2026-09-07, so it is now 14 + 17 = 31. Each has an
# OPEN todo — none is a defect this change introduced, and every one allows on
# `main` too:
#
#   14  r4brange-tool-* and r4brange-verb-*. A brace RANGE carries no `$` and no
#       backtick anywhere, so no sigil-keyed decline can see it and no deleting
#       rendering can reach it. Needs a narrow guard-side deny. Tracked at
#       todos/P2-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md
#
#   17  toolvcasearm-* (7), verbvcasearm-* (7), flagvcasearm-* (3 of 4). A `case`
#       arm's `)` has NO matching opener, so the paren counter that closed the
#       bare-paren rows cannot reach it, and the obvious `case`/`esac` keyword
#       tracker is a deny->ALLOW regression generator (`e$(echo case)as update`
#       DENIES today and would render EMPTY under it). Deliberately deferred with
#       its reasoning, not overlooked. Tracked at
#       todos/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
#
#       flagvcasearm-ghadmin is the FOURTH flag row and reports `ok` — READ ITS
#       ATTRIBUTION, NOT ITS VERDICT. It denies from a different check entirely:
#       the construct breaks the `--auto` spelling in `gh pr merge 42 --auto
#       --admin`, so the "no REAL --auto" rule fires. Same rule as co-mask-c1.
#
#    0  (was 2) nssufx-ghmerge and nssufx-ghcomment — an INTERIOR redirect, a
#       different mechanism with its own entry below and its own todo. CLOSED
#       2026-09-07 by `_OUT_SEP`, together with the 51 generated intrtool-*/
#       intrns-* rows added in the same change. The bucket is kept at zero rather
#       than deleted: the entry below records what the two rows could NOT see.
#
# SUPERSEDED INVENTORY, KEPT FOR ITS ARITHMETIC LESSON ONLY (round 4, gaps=73).
# The counts below describe the tree BEFORE the bare-paren + vanishing-allow-list
# change and are NOT the expected output of this file any more; the current
# inventory is the one above. It is kept because the correction recorded in it is
# the reason this note insists on per-ID diffs:
#
#   A COUNT HIDES ROWS THAT GOT WORSE WITHOUT CROSSING THE THRESHOLD. In the
#   round-3 delta, toolvmixq-*, toolvbareparen-* and toolvcasearm-* were ALREADY
#   all-path-dirty on both sides, so they could not appear in the "22 newly
#   dirty" figure — yet each went from ONE failing degraded path (noawk) to
#   THREE. An earlier revision said "29 rows newly degraded-dirty ... 4
#   mechanisms", which double-counted toolvmixq-* as new when it was
#   pre-existing, and 47 + 29 = 76 never equalled the 69 printed two lines above
#   it. Only running THIS corpus against both hooks and diffing the per-ID dirty
#   sets found that; subtracting the two totals never could.
#
# Round 4 added 56 rows and 56 gaps (17 -> 73 precise, 69 -> 125 all-path), the
# r4spec-/r4dig-/r4ansic-/r4brange- rows (4 mechanisms x 2 glue positions x 7
# families). Their asymmetries at that time are worth keeping too, because the
# verb-position one INVERTS this file's usual direction and that is a per-check
# property, not an invariant:
#
#   r4*-tool-*     (28 rows)  ALLOW on ALL FOUR paths — a total detection
#                             failure at the binary-name position. 21 of these
#                             are now closed; r4brange-tool-* remains.
#   r4spec/r4dig/r4ansic-verb-*
#                  (21 rows)  precise ALLOW, all three degraded DENY — the
#                             precise path was the WEAK one, so "degraded fails
#                             closed" is not a safe default. All 21 now closed.
#   r4brange-verb-*  (7 rows) ALLOW on all four — the ONLY verb-position
#                             mechanism that also defeats the degraded paths,
#                             because that mirror keys on `$`/backtick and a
#                             brace range contains neither. Still open.
#
# Each remaining row is a REAL, reachable bypass out of the folded repair's Scope
# Contract — the list below is exhaustive OF THIS FILE'S ROWS, which is not the
# same as exhaustive of the guard. Their expectations are
# deliberately left at DENY: flipping a reachable-but-unfixed row to match
# current behaviour would encode "this bypass is fine" into the fixture and
# retire the only thing still pointing at it. Contrast c1-threedash (NOTE5),
# which was flipped precisely because its ALLOW was UNREACHABLE BY DESIGN --
# a masking guard will always deny it. Unreachable-by-design gets corrected;
# reachable-but-unfixed stays a visible gap.
#
#   nssufx-ghmerge / nssufx-ghcomment -- CLOSED 2026-09-07 by `_OUT_SEP`, the
#     one interior absorber this entry called for. Both rows now report `ok` on
#     the precise path. The entry is kept in full, because its warning below
#     ("THESE TWO ROWS SEVERELY UNDER-REPRESENT THE GAP") was CORRECT and is the
#     reason the fix generated 51 rows across ELEVEN families instead of
#     satisfying itself with flipping these two: the same mechanism defeated
#     gh release, gh repo, railway variable and railway service, none of which
#     FAM_IDS carries. A corpus that had only these two rows would have gone
#     fully green on a change that closed a fifth of the real blast radius.
#     ORIGINAL ENTRY, retained:
#     nssufx-ghmerge / nssufx-ghcomment -- UNHANDLED, OUT OF SCOPE.
#     `gh pr>/dev/null merge 42` glues a redirect where the anchors require
#     whitespace between two words. Real bash tokenizes this to argv
#     (gh, pr, merge, 42) with stdout redirected, so it genuinely merges.
#     Neither mechanism in this repair reaches it: the vanished rendering
#     leaves it untouched (a redirect is NOT a provably-empty expansion, and
#     must not be treated as one), and finding A's closer-class widening
#     covers the verb's own boundary, not an INTERIOR redirect. Closing it
#     needs ONE interior absorber applied uniformly -- which the Scope
#     Contract ("widen existing boundary character classes; reuse the shared
#     lib's existing _CMD_REDIR; no new parsing layer") does not authorise.
#     This axis was already labelled "a real, DISTINCT mechanism" by this
#     file's own FAM_NS_* comment above.
#
#     *** THESE TWO ROWS SEVERELY UNDER-REPRESENT THE GAP. DO NOT READ THE
#     GAP COUNT AS ITS SIZE. *** Measured across families 2026-09-06: the
#     same glue defeats EVERY gated family, including the single-word-verb
#     ones via the TOOL->VERB position, which no row here covers:
#       eas>/dev/null update --branch preview   -> ALLOW  (OTA publish)
#       npm>/dev/null publish                   -> ALLOW
#       railway>/dev/null up                    -> ALLOW
#       gh>/dev/null api repos/o/r -X POST      -> ALLOW
#       gh release>/dev/null create v1.0        -> ALLOW
#       gh repo>/dev/null delete o/r            -> ALLOW
#       railway variable>/dev/null set K=V      -> ALLOW
#       railway service>/dev/null delete svc    -> ALLOW
#     Every spaced baseline DENIES, so each is a total detection failure.
#     An earlier version of this note scoped the gap to a `gh` NAMESPACE word
#     before a multi-word verb; that was written before the cross-family
#     measurement and understated it. Rows for the families above belong here
#     and are deliberately left for the tracking todo's own change, so this
#     PR's quoted gap count stays a like-for-like before/after:
#     todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md
#
#   c2-ansic-hex -- CLOSED 2026-09-06, and it needed exactly the decoder the
#     previous revision of this entry said the Scope Contract forbade.
#     `gh api repos/o/r -X $'\x50\x4f\x53\x54'` supplies POST as ANSI-C hex.
#     Measured cause at the time: cmd_words rendered it `-X xx50xx4fxx53xx54`,
#     so the `$` was CONSUMED -- C2's "method value is not literal text" branch
#     reads for a surviving `$`/backtick and found none, while the
#     literal-method branch found no POST either. cmd_words_vanished now DECODES
#     ANSI-C escapes, so the clause cut sees a literal `-X POST` and the
#     mutating-method branch matches. Decoded in the VANISHED rendering and not
#     in cmd_words specifically because that rendering is deny-shaped-consumers
#     only, so a decoder there can never manufacture a flag that GRANTS a
#     carve-out. This row was NOT the target of that change and is recorded as a
#     side effect confirmed by the per-ID before/after diff.
#
# Do not "fix" any of these by editing this file. Fix the guard, or leave the
# gap visible.
