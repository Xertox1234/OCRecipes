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
  # LC_ALL=C is load-bearing on the extraction, not decoration. `cut -c` counts
  # CHARACTERS under a UTF-8 locale on BSD and BYTES under C, and GNU coreutils
  # makes its own choice again -- so the truncation point of any reason string
  # containing a multibyte character depends on the ambient locale of whoever runs
  # this. Three of the 372 pinned reasons contain an em-dash before column 72
  # ("... occurrence — ambiguous ..."), and measured on darwin the same string
  # truncates to 74 bytes under C.UTF-8 and 72 under C. That was cosmetic while
  # nothing compared these strings; it is a WEDGED REQUIRED CHECK now that the pin
  # does, because a dev box and the ubuntu runner would pin different bytes for
  # the same guard. Same failure mode, same remedy, and the same reasoning as the
  # `LC_ALL=C sort` in `_pin_norm` below. Byte semantics can in principle split a
  # future multibyte character mid-sequence; that is deterministic, which is the
  # property a pin needs, and none of the current 17 fingerprints does it.
  # NOTE the scope: this is the corpus's own text handling. The guard itself is
  # invoked with the ambient locale untouched, because its verdicts are what this
  # file measures and must not be perturbed by the harness.
  #
  # Returns the WHOLE reason. The 72-byte truncation used to happen here; it moved
  # to `_fp` so a caller can hold the full string and its fingerprint from ONE
  # guard invocation. That is what makes the collision assertion in the pin free --
  # without it, "are two checks distinguishable at 72 bytes" would need a second
  # pass over every DENY row, and this file's whole argument for being affordable
  # is that it does not take second passes.
  tr '\n' ' ' <<< "$o" | LC_ALL=C sed -E 's/.*guard-outward-cli: //; s/ Bypass:.*//'
}

# The pinned fingerprint of a reason: first 72 BYTES, no trailing whitespace.
# Byte semantics for the reason given above. The rtrim is here rather than at the
# call sites because `cut` lands mid-sentence for 41 of the 372 and leaves a
# trailing space -- invisible in a diff, stripped on save by most editors, and on
# a REQUIRED check that is a red gate with no visible cause.
_fp() { LC_ALL=C cut -c1-72 <<< "$1" | sed 's/[[:space:]]*$//'; }

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

# axis: ROOT-POSITION REPO-RETARGET FLAG (2026-09-13 -- the P0 tracked as
# repo-retarget-flag-in-root-position-defeats-both-merge-guards, CLOSED in two
# steps). These four -R/--repo spellings were step one. They were generated from a
# flag list that looked complete and was not; the ghrootv-* axis below is step two
# and is generated from the tool instead. Read the two together -- this block on its
# own is the shape of the mistake, not the shape of the fix.
# A FLAG between the binary and its namespace. The interior-redirect axis above
# closed the same SLOT for redirects; `_OUT_SEP` never modelled a flag there, so
# `gh -R other/org pr merge 42` matched none of the guard's gh needles and the
# merge block -- which has no `else` -- was skipped whole, taking the repo
# check, the --auto carve-out and the --admin deny with it.
#
# EXPECTED=DENY on its own merits, not copied from the documented-position row:
# cobra strips flags while resolving the subcommand and the `pr` group registers
# -R/--repo via cmdutil.EnableRepoOverride, so this spelling really does retarget
# the call. Measured against the real binary 2026-09-13, read-only, no mutation.
#
# GENERATED from the product of {flag spelling} x {family}, per NOTE6: the four
# spellings are exactly what gh's flag parser accepts, and hand-picking a subset
# is how the tool position came to be missing in the first place.
GH_ROOT_FAM_IDS=(ghmerge ghcomment ghcreate ghapi)
GH_ROOT_FAM_CMDS=(
  'gh pr merge 42'
  'gh pr comment 5 --body hi'
  'gh pr create --title x'
  'gh api repos/o/r -X POST'
)
GH_ROOT_FLAG_IDS=(Rsep reposep repoeq Rglued)
GH_ROOT_FLAGS=('-R other/org' '--repo other/org' '--repo=other/org' '-Rother/org')
for i in "${!GH_ROOT_FAM_IDS[@]}"; do
  for j in "${!GH_ROOT_FLAG_IDS[@]}"; do
    # `#` delimiter, not `/`: every flag value here contains a slash.
    add "ghroot-${GH_ROOT_FLAG_IDS[$j]}-${GH_ROOT_FAM_IDS[$i]}" DENY \
      "$(sed -E "s#^gh #gh ${GH_ROOT_FLAGS[$j]} #" <<< "${GH_ROOT_FAM_CMDS[$i]}")"
  done
done
# The retarget does not have to point ELSEWHERE to matter: naming THIS repository
# still merges a PR here with no review record, and it is the spelling a person
# would reach for innocently. Literal, because it is one specific value rather
# than a new dimension.
add ghroot-selfrepo DENY 'gh -R Xertox1234/OCRecipes pr merge 42 --squash'
# The retarget must beat a REAL --auto, which is the one carve-out in this block.
add ghroot-vs-auto  DENY 'gh -R other/org pr merge 42 --auto'
# FALSE-POSITIVE CONTROLS, same slot, read-only verbs. Without these the 18 rows
# above are a restrictive failure wearing a green tick: a guard that denied every
# root-position flag outright would pass all of them.
add ghrootfp-list ALLOW 'gh -R other/org pr list'
add ghrootfp-view ALLOW 'gh -R other/org pr view 42'
add ghrootfp-get  ALLOW 'gh -R other/org api repos/o/r'

# axis: ROOT-POSITION FLAG THE GRAMMAR DOES NOT NAME (2026-09-13 -- the second and
# final half of the same P0, which this closes).
#
# The four spellings above were generated from a flag list, and the list was the
# defect. `-R`/`--repo` are the flags that MEAN "retarget", but the grammar cares
# only about which flags CONSUME A FOLLOWING TOKEN -- a property of the tool's flag
# table, not of anyone's model of intent. cobra accepts any flag valid for the
# TARGET subcommand in root position, so an unnamed separate-arg flag left its
# VALUE where the namespace belongs and every gh needle went blind again:
#
#     gh -t x pr merge 42 -R other/org   -> ALLOW on BOTH layers, before this change
#
# which is a cross-repository retarget defeating both merge guards -- the P0's own
# headline, in a spelling its own corpus could not reach.
#
# DIMENSION MEMBERS, AND WHERE THEY CAME FROM. Not from this file and not from
# memory: from `man gh-pr-merge` (the man page rather than `gh help`, because the
# help text contains the very command string this repo's guard denies). Every flag
# there rendered as `--flag <PLACEHOLDER>` takes a separate argument -- six of them,
# `-R/--repo` plus the five below. Re-derive rather than trust this list; a first
# pass here grepped `<[a-z-]+>` and silently missed `--match-head-commit <SHA>` on
# the placeholder's CASE, which is this same mistake one level down.
#
# THE LAST TWO MEMBERS ARE NOT GH FLAGS AT ALL, and they are the point. `-Z` and
# `--not-a-real-flag` exist in no version of gh, so they can only pass against a
# grammar that models the PROPERTY. If a future change makes them fail, the fix has
# reverted to an enumeration and the next unnamed flag is live again.
#
# `noarg` is the two-sided member, inside the same generated product rather than
# beside it: `-d/--delete-branch` takes NO value, so the namespace is the very next
# token and the grammar must DECLINE to consume it. A value arm that over-consumed
# would turn this row into a silent ALLOW, and no deny row above could see it.
#
# THE PRODUCT IS FULL, INCLUDING CELLS GH ITSELF WOULD REJECT (`gh -t x api ...`:
# `-t` is not an `api` flag). That is deliberate. The guard cannot know which flags
# a verb defines -- that is the whole reason it models the property -- so a cell gh
# would reject is a harmless over-denial, while carving those cells out by hand is
# exactly the hand-picked subset NOTE6 exists to prevent.
# THE EXPECTED VERDICT IS PER FAMILY, AND EACH IS ON ITS OWN MERITS. The first draft of
# this axis declared DENY for all four families by copying the -R/--repo axis above, and 16
# rows came back as gaps. They were right and the declaration was wrong: those rows deny
# because they carry a RETARGET, and this guard does not gate `gh pr create`/`gh pr comment`
# at all without one (measured: `gh pr create --title x --body y` ALLOWS here; PR creation is
# pr-preflight-guard.sh's stamp gate, which was separately measured to gate every spelling
# below). The corpus header three blocks up says "EXPECTED=DENY on its own merits, not copied
# from the documented-position row" — this is what ignoring that sentence looks like.
#
# So the create/comment families appear TWICE: once bare, expected ALLOW, which is the
# two-sided control proving the widening did not turn ordinary PR creation into a denied
# command; and once carrying a retarget (`R` suffix), expected DENY, which is the cell that
# actually exercises those needles. Without the second, the flag dimension would prove
# nothing for four of the six families.
GH_ROOTV_FAM_IDS=(ghmerge ghcomment ghcreate ghapi ghcommentR ghcreateR)
GH_ROOTV_FAM_CMDS=(
  'gh pr merge 42'
  'gh pr comment 5 --body hi'
  'gh pr create --title x'
  'gh api repos/o/r -X POST'
  'gh pr comment 5 --body hi --repo other/org'
  'gh pr create --title x --repo other/org'
)
GH_ROOTV_FAM_EXPECT=(DENY ALLOW ALLOW DENY DENY DENY)
GH_ROOTV_FLAG_IDS=(subject body authoremail bodyfile matchhead unknownshort unknownlong noarg)
GH_ROOTV_FLAGS=(
  '-t x'
  '-b body'
  '-A a@b.c'
  '-F notes.md'
  '--match-head-commit abc123'
  '-Z somevalue'
  '--not-a-real-flag v'
  '-d'
)
for i in "${!GH_ROOTV_FAM_IDS[@]}"; do
  for j in "${!GH_ROOTV_FLAG_IDS[@]}"; do
    add "ghrootv-${GH_ROOTV_FLAG_IDS[$j]}-${GH_ROOTV_FAM_IDS[$i]}" "${GH_ROOTV_FAM_EXPECT[$i]}" \
      "$(sed -E "s#^gh #gh ${GH_ROOTV_FLAGS[$j]} #" <<< "${GH_ROOTV_FAM_CMDS[$i]}")"
  done
done
# THE HEADLINE SHAPE ITSELF, literal because it is one specific pairing rather than
# a new dimension: an unnamed root flag CARRYING a retarget through. The deny must
# come from the retarget check, not the generic no---auto one -- asserted by reason
# in test-guard-outward-cli.sh, since this corpus records the verdict, not the path.
add ghrootv-retarget DENY 'gh -t x pr merge 42 -R other/org'
add ghrootv-selfrepo DENY 'gh -t x pr merge 42 -R Xertox1234/OCRecipes'
# FALSE-POSITIVE CONTROLS, same slot, read-only verbs. Without these the rows above
# -- one per member of GH_ROOTV_FLAG_IDS x GH_ROOTV_FAM_IDS, plus the two literals --
# are a restrictive failure wearing a green tick: a guard that denied every
# root-position flag outright would pass all of them.
#
# THE COUNT IS NAMED AS A PRODUCT OF THE TWO ARRAYS DIRECTLY ABOVE, not as a literal.
# A literal stood here and said 34, which was correct when this axis crossed 4 families
# and silently wrong the moment ghcommentR/ghcreateR took it to 6 -- in the same commit,
# two paragraphs below the sentence narrating that widening. EXPECTED_ROWS is the pin that
# actually fires; a number in prose is just a claim, and this repo's rule is to compute
# counts from the file rather than retype them. Naming the factors keeps it checkable by
# reading two lines up.

# axis: A CONSUMED VALUE COLLAPSING AN OCCURRENCE COUNT (2026-09-13, round-2 review).
#
# THIS AXIS EXISTS BECAUSE THE CORPUS COULD NOT SEE THE REGRESSION THAT PROMPTED IT, and that
# is the more useful half of the story. The value arm added above closed a real bypass and
# introduced a real regression, and a full run of this file -- 655 rows, four paths each --
# moved by exactly zero rows. Not because the corpus is weak: because no dimension here
# varied "a flag whose VALUE swallows a separator". NOTE6's "a corpus can only report on the
# axes it varies" is not a caveat, it is the failure, observed.
#
# THE MECHANISM. Adding `(...)?` to an arm strictly GROWS the language a needle matches, so on
# every BOOLEAN read it is monotone -- what matched before still matches. An occurrence COUNT
# is not a boolean read and is not monotone: a longer match absorbs text that would otherwise
# have begun a SECOND match. The wide value token excludes only whitespace, so it eats a
# separator and the command after it:
#
#     gh -a api -c x;gh api /a/b
#       main  ->  [gh -a api ] [;gh api ]   COUNT=2  -> ambiguity DENY
#       wide  ->  [gh -a api -c x;gh api ]  COUNT=1  -> silently ALLOWED
#
# `gh api` is the ONLY single-token gh needle in the guard; the two-token families
# (`pr merge`, `pr create|comment`, `release ...`, `repo ...`) are structurally immune,
# because each globals arm carries at most ONE optional value slot -- a needle's FIRST token can
# be eaten as a value (` -a pr` matches) but its SECOND can then neither open a fresh arm nor be
# consumed, so no single match absorbs a whole second occurrence. An earlier draft said "the
# second token is not a dash token and so can never be a flag's value", which is backwards: a
# non-dash token is exactly what qualifies AS a value. That is
# why this axis varies only the api family -- a deliberate scope, not a hand-picked subset,
# and the reason is stated so the next reader can check it rather than trust it.
#
# EXPECTED=DENY on the AMBIGUITY reason, not the method reason. The `-X`/`--method` check is
# not a sufficient compensating control: real `gh` sends POST when `-f` fields are present, so
# the `apicollapse-*-mut` rows below carry no `-X` at all and only the occurrence refusal
# stands between them and an allowed cross-command mutation.
# THE DIMENSION IS COMMAND-POSITION OPENERS, NOT SEPARATORS, and the first version of this
# axis got that wrong in a way worth keeping. It varied exactly `;`, `&` and `|` -- precisely
# the three characters the first fix excluded -- so it could only ever CONFIRM that fix and
# could not see the `(` member, which was live. An axis keyed on the thing the fix happens to
# cover is a tautology with row numbers. The set that matters is _OUT_POS_PREFIX's own anchor
# class, `[;&|(` + backtick + `{!]`: every character at which a SECOND COMMAND MAY BEGIN.
# `<(` and `>(` are listed separately from `(` because they are the spellings that genuinely
# EXECUTE -- `head -c 0 <(touch marker)` creates the marker under bash and zsh alike.
#
# EVERY OPENER IS EXPECTED TO DENY, and the backtick row is the reason this comment exists.
# It was first declared ALLOW, on the strength of a hand probe that reported main=ALLOW. That
# probe was wrong: it built its opener list as '\`' inside shell text, so it measured a
# BACKSLASH-backtick -- an escaped character -- and never tested a backtick at all. This
# corpus caught it immediately (9 rows, one per flag x tail, all GAP want=ALLOW), and a
# re-measurement passing the byte as jq --arg data rather than as shell text settles it:
# a real backtick opener DENIES on main and on this branch alike.
#
# The lesson is not about backticks. A probe that constructs its input THROUGH the shell is
# testing whatever the shell left behind, which for exactly the characters this axis varies
# -- the ones with syntactic meaning -- is not the character you named. Pass such inputs as
# data. The corpus is what caught it, which is the argument for the axis existing at all.
APICOL_FLAG_IDS=(shortc shortt unknown)
APICOL_FLAGS=('-c x' '-t x' '-Z x')
APICOL_OPEN_IDS=(semi amp pipe paren brace bang psubin psubout btick)
APICOL_OPENS=(';' '&' '|' '(' '{' '!' '<(' '>(' '`')
APICOL_OPEN_EXPECT=(DENY DENY DENY DENY DENY DENY DENY DENY DENY)
APICOL_TAIL_IDS=(read mut method)
APICOL_TAILS=('/a/b' '-f a=b /repos/o/r/merges' '-X POST /repos/o/r')
for i in "${!APICOL_FLAG_IDS[@]}"; do
  for j in "${!APICOL_OPEN_IDS[@]}"; do
    for k in "${!APICOL_TAIL_IDS[@]}"; do
      add "apicollapse-${APICOL_FLAG_IDS[$i]}-${APICOL_OPEN_IDS[$j]}-${APICOL_TAIL_IDS[$k]}" \
        "${APICOL_OPEN_EXPECT[$j]}" \
        "gh -a api ${APICOL_FLAGS[$i]}${APICOL_OPENS[$j]}gh api ${APICOL_TAILS[$k]}"
    done
  done
done
# FALSE-POSITIVE CONTROLS. Without these the rows above pass on a guard that denies every
# `gh api` outright, which is the restrictive failure this file exists to catch as well.
add apicolfp-read    ALLOW 'gh api repos/o/r'
add apicolfp-rootflag ALLOW 'gh -t x api repos/o/r'
# PRE-EXISTING and pinned as ALLOW so the rows above are not misread as closing it: a
# SINGLE-command field mutation is allowed on main too. It belongs to
# todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md.
add apicolfp-oneshot ALLOW 'gh api -f a=b /repos/o/r/merges'

add ghrootvfp-list ALLOW 'gh -t x pr list'
add ghrootvfp-view ALLOW 'gh -Z somevalue pr view 42'
add ghrootvfp-get  ALLOW 'gh -t x api repos/o/r'

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
# source, so interpolating $_CMD_REDIR there would reference an UNSET variable
# under the guard's `set -u` -- a hard error that aborts the hook mid-check, not
# a silent empty expansion. (Corrected 2026-09-07; measured. On the no-lib path
# especially this is not hypothetical: the lib really did fail to source, so the
# reference would fire on exactly the run that needs the fallback most.)
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

# axis: DECOY CLAUSE -- a NON-command-position `gh pr <sub>` mention sitting
# BEFORE a real, executing clause on the same line.
#
# THIS AXIS EXISTS BECAUSE ITS ABSENCE HID A CRITICAL. Every row generated above
# is a SINGLE invocation, and the only multi-invocation rows in this file put both
# mentions in COMMAND POSITION -- where the ">1 occurrence is ambiguous" deny
# fires first and the clause cut is never reached. So no row here could exercise
# `gh_pr_clause_has_repo`'s leftmost selection, which is the file's ONLY cut with
# no `${_OUT_POS_PREFIX}` anchor while the counters that gate it ARE anchored.
# A mention that is not in command position adds a clause the counter cannot see,
# `head -1` examines the decoy, and the real clause's --repo/-R goes unexamined:
# unbounded PAT egress to an arbitrary repository. This corpus reported clean
# throughout, and test-guard-outward-cli.sh was 537/0 green, on a branch that had
# converted specific `main` DENYs into ALLOWs.
#
# The lesson, and the reason this is a GENERATED axis rather than three hand rows:
# a corpus that varies WHAT a construction contains cannot see a defect about
# WHICH OF SEVERAL CANDIDATES a check picks. That needs a second occurrence, in a
# position the gating count does not count.
#
# EXPECTED=DENY on its own merits: argv taken from PATH-shadowed argv-printing
# stubs shows the real clause executing with --repo/-R in every row. The `plain`
# spelling (no redirect at all) allowed on `main` too -- the root cause predates
# the interior absorber, which only enlarged the set of decoy spellings.
DECOY_IDS=(ghmerge ghcomment ghcreate)
DECOY_CMDS=(
  'gh pr merge 42 --auto --repo o/r'
  'gh pr comment 5 --body hi --repo other/org'
  'gh pr create --title t --repo o/r'
)
DECOY_MENTION=('gh pr merge' 'gh pr comment' 'gh pr create')
DECOY_SPELL_IDS=(plain glue sp fd)
DECOY_SPELL_SEDS=('\1' '\1>\/dev\/null' '\1 >\/dev\/null' '\1 2>\&1')
for i in "${!DECOY_IDS[@]}"; do
  id=${DECOY_IDS[$i]}; real=${DECOY_CMDS[$i]}; men=${DECOY_MENTION[$i]}
  for j in "${!DECOY_SPELL_IDS[@]}"; do
    sp=${DECOY_SPELL_IDS[$j]}; rp=${DECOY_SPELL_SEDS[$j]}
    add "decoytool$sp-$id" DENY "echo $(sed -E "s/^(gh)/${rp}/" <<< "$men") && $real"
    add "decoyns$sp-$id"   DENY "echo $(sed -E "s/^(gh pr)/${rp}/" <<< "$men") && $real"
  done
done
# False-positive controls for the clause UNION that closes the axis above.
# Scanning every clause instead of the first can only ADD denies, so these are
# the rows that would catch it over-denying -- and they are the exact shapes this
# file once reverted a clause-scoping change for.
add "decoyfp-cpR"   ALLOW 'cp -R src dst && gh pr create --title t'
add "decoyfp-grepR" ALLOW 'grep -R foo . && gh pr comment 5 --body hi'
add "decoyfp-auto"  ALLOW 'gh pr merge 42 --auto'

# axis: FLAG-ADJACENT redirect -- the operator sits next to a FLAG rather than
# between two required-adjacent COMMAND WORDS. ADDED 2026-09-07 (security review
# of PR #931). THIS AXIS'S ABSENCE IS WHY THIS FILE DID NOT MOVE AT ALL WHEN FOUR
# LIVE BYPASSES WERE CLOSED: every interior row above varies the redirect's
# POSITION between two command words, so the whole grid holds "adjacent to a
# flag" fixed at "never". Same failure this file already recorded for the tool
# position and the decoy clause -- a corpus that varies one axis reproduces the
# blind spot that chose the axis.
#
# All 18 generated rows ALLOWED on the pre-change tree with an argv identical to
# their spaced baseline; the npm/yarn ones are OTA publishes to real users.
#
# THE MECHANISM NEEDS A VALUE-TAKING FLAG, which is why FLAGADJ_CMDS uses
# --loglevel/--cwd/-X/--method/--body/--title rather than a boolean: with a
# boolean flag the value sub-group absorbs the redirect as its own optional value
# and the deny still fires. That is a REAL distinction, not a corpus artifact, so
# it gets an ALLOW-expecting control row rather than being silently omitted.
FLAGADJ_IDS=(npmlog yarncwd ghapix ghapimeth ghcomment ghcreate)
FLAGADJ_PRE=(
  'npm --loglevel'
  'yarn --cwd'
  'gh api repos/o/r -X'
  'gh api repos/o/r --method'
  'gh pr comment 5 --body'
  'gh pr create --title'
)
FLAGADJ_POST=(
  'silent run update:preview'
  '. update:production'
  'DELETE'
  'POST'
  'hi --repo other/org'
  't --repo o/r'
)
FLAGADJ_SPELL_IDS=(glue sp fd)
FLAGADJ_SPELL=('>x' ' >/dev/null' ' 2>&1')
for i in "${!FLAGADJ_IDS[@]}"; do
  for j in "${!FLAGADJ_SPELL_IDS[@]}"; do
    add "flagadj${FLAGADJ_SPELL_IDS[$j]}-${FLAGADJ_IDS[$i]}" DENY \
      "${FLAGADJ_PRE[$i]}${FLAGADJ_SPELL[$j]} ${FLAGADJ_POST[$i]}"
  done
done
# The narrowing control: a BOOLEAN flag is not a value-taking one, and this row
# denies on BOTH trees. It is the row that keeps the 18 above attributable to
# value-taking flags rather than to "a redirect somewhere near a flag".
add "flagadjctrl-boolean" DENY 'npm --silent 2>&1 run update:preview'
# Clause-boundary controls for admitting `&[0-9-]` into the two clause bodies: a
# mutating method or a --repo belonging to the NEXT command must never be pulled
# into gh's clause. These go ALLOW on both trees and are what catch the widening
# turning into a bare `&`.
add "flagadjfp-andand"  ALLOW 'gh api repos/o/r && curl -X DELETE http://example.com'
add "flagadjfp-semi"    ALLOW 'gh api repos/o/r ; curl -X DELETE http://example.com'
add "flagadjfp-repo"    ALLOW 'gh pr list && curl --repo o/r'
add "flagadjfp-roredir" ALLOW 'gh api repos/o/r 2>&1'

# axis: FORGED --auto -- a redirect TARGET spelled `--auto` read as a flag.
# (P0-2026-09-07-...-space-separated-redirect-target-forges-auto, fixed 2026-09-12.)
#
# The `--auto` field scan split on WHITESPACE, so `> --auto` was two fields and
# the target compared equal to the flag, GRANTING the carve-out on an --auto that
# never reaches gh: an immediate, unarmed merge. GENERATED as operator x position
# rather than hand-listed, because the original finding enumerated ONE operator's
# positions and missed the rest -- the exact shape NOTE6 exists to prevent. The
# operator list is taken from `_CMD_REDIR`'s own alternations, so the #939 zsh
# families (`>|`, named fds) are covered without re-deriving the grammar here.
#
# The POSITION axis is not decoration: the leading slot reaches the scan through
# _OUT_POS_PREFIX's absorber (the redirect lands INSIDE the CLAUSE capture --
# measured [> --auto gh pr merge 42]), the interior slots through _OUT_SEP, and
# the trailing slot through the clause body. Four different routes to one scan.
# The operator list enumerates `_CMD_REDIR`'s OWN alternations rather than a
# representative sample: input (`<`), plain/append output, the fd-numbered form,
# `&` on either side of the operator, both clobber overrides (`>|`, `>!`), and
# both brace-fd bodies (identifier and all-digit — the family #939's round 4
# added). A review round 2 note pointed out the earlier six-element list claimed
# to be derived from those alternations and was not; widened rather than softened,
# because this file's standing lesson is that a completeness claim has been wrong
# every time it was made.
FAUTO_SPELL_IDS=(gt fd app amp ampl clob bang nfd nfddig in)
FAUTO_SPELL=('>' '2>' '>>' '&>' '>&' '>|' '>!' '{fd}>' '{9}>' '<')
# THE `-trail` SLOT IS NON-DISCRIMINATING FOR FIVE OF THESE TEN OPERATORS, and
# saying so here is cheaper than a reader re-deriving it. Measured 2026-09-13:
# branch 1 of _OUT_POS_SUFFIX_MERGE_CLAUSE excludes `&`, `|` and `{`, so for
# `&>`, `>&`, `>|`, `{fd}>` and `{9}>` the clause is cut BEFORE the scan runs and
# the row denies for that pre-existing reason -- on main too. Mutating
# `norm = strip_redirs($0)` to `norm = $0` leaves all five GREEN, so they are not
# evidence for the redirect-aware scan, whatever the surrounding prose once
# implied by calling the family "inherited free".
#
# They stay: the verdict and its attributed reason are correct, and the pin
# tracks both. What changes is only the claim made ABOUT them. The `-lead`,
# `-tool` and `-ns` slots of those same five operators ARE discriminating --
# _OUT_SEP and _OUT_POS_PREFIX interpolate _CMD_REDIR directly rather than
# through an exclusion class, so the clause arrives intact there.
for j in "${!FAUTO_SPELL_IDS[@]}"; do
  sp=${FAUTO_SPELL_IDS[$j]}; op=${FAUTO_SPELL[$j]}
  add "fauto$sp-trail" DENY "gh pr merge 42 $op --auto"
  add "fauto$sp-lead"  DENY "$op --auto gh pr merge 42"
  add "fauto$sp-tool"  DENY "gh $op --auto pr merge 42"
  add "fauto$sp-ns"    DENY "gh pr $op --auto merge 42"
done
# CO-OCCURRENCE: two forged targets in ONE command. A cross product picks one
# value per axis and can never emit this, which is how a repeat of the same
# construct goes untested while every single-value row passes for its own reason.
add "fauto-cooccur" DENY 'gh > --auto pr > --auto merge 42'
# ATTRIBUTION CONTROL: the GLUED spelling denied before the fix too, but only
# incidentally -- `>--auto` was one awk field that did not compare equal. It must
# still deny, now because the target is RECOGNISED. Paired with fautogt-trail,
# the SPACE is the only variable between the two.
add "fautoctrl-glued" DENY 'gh pr merge 42 >--auto'

# axis: MASKED --auto -- the same cause, opposite direction. The `--auto` is REAL
# and reaches gh, but bash hands it to a value-taking flag as that flag's VALUE,
# so no auto-merge flag survives. GH_MERGE_VALUE_FLAGS exists to catch exactly
# this and missed, because `prev` read the single field `-b>x`, not `-b`.
MAUTO_FLAG_IDS=(b bodyfile t)
MAUTO_FLAG=('-b' '--body-file' '-t')
MAUTO_GLUE_IDS=(glue sp fd)
MAUTO_GLUE=('>x' ' >x' ' 2>x')
for i in "${!MAUTO_FLAG_IDS[@]}"; do
  for j in "${!MAUTO_GLUE_IDS[@]}"; do
    add "mauto${MAUTO_GLUE_IDS[$j]}-${MAUTO_FLAG_IDS[$i]}" DENY \
      "gh pr merge 42 ${MAUTO_FLAG[$i]}${MAUTO_GLUE[$j]} --auto"
  done
done

# JOIN CONTROLS. Deleting a redirect must never FUSE two halves of a word into an
# `--auto` nobody wrote -- the paired over-granting control this change owes for
# touching the file's ONE grant-shaped read. READ THE ATTRIBUTION: these do NOT
# pin the space in `gsub(redir, " ", ...)`. Mutating it to "" leaves the whole
# suite green, measured -- fusion is impossible either way, because _CMD_REDIR's
# target is mandatory and greedy and always eats through to a boundary that
# blocks the join. An EQUIVALENT mutant, written down so nobody chases it.
add "fautojoin-sp"   DENY 'gh pr merge 42 --au>x to'
add "fautojoin-glue" DENY 'gh pr merge 42 --au>xto'
add "fautojoin-off"  DENY 'gh pr merge 42 --a>x uto'

# NEWLY GRANTED -- but only the FIRST of the two rows is. A genuine --auto
# carrying a glued redirect IS an armed automerge in real bash argv, so the
# former deny was an over-denial (the ACCEPTED OVER-DENIAL residual, now
# retired).
#
# MEASURED 2026-09-13, correcting this comment's earlier claim that both rows
# were newly permissive: `fautogrant-amp` is NOT one of them. The clause cut
# excludes `&`, so `--auto&>log` truncates to CLAUSE=[gh pr merge 42 --auto] on
# main and on this branch alike, and main ALREADY grants it (HAS_REAL_AUTO=yes
# on both trees).
#
# `fautogrant-glue` is the only NEWLY permissive decision AMONG THESE TWO ROWS --
# scoped deliberately, because the unscoped version of this sentence was measured
# false a second time on 2026-09-13: the VALUE-FLAG-TARGET axis below flips more
# operators from deny to allow -- five of them carry rows, and the FAMILY IS
# WIDER THAN THE ROWS. Do not restore a global claim here.
add "fautogrant-glue" ALLOW 'gh pr merge 42 --auto>/dev/null'
add "fautogrant-amp"  ALLOW 'gh pr merge 42 --auto&>log'

# VALUE-FLAG-TARGET axis (2026-09-13, security review). The redirect's TARGET is
# the value flag itself, so the redirect CONSUMES the flag and the --auto after
# it survives into argv. ALLOW is therefore correct, and main was over-denying.
#
# MAUTO_GLUE cannot reach this shape: it varies the redirect's SPACING but always
# leaves an inert target word (`x`), so the redirect never eats the flag. This
# axis was missing entirely until the claim that this change made exactly two
# decisions more permissive was measured and found false.
#
# THE FAMILY IS WIDER THAN THE FIVE ALLOW ROWS. Measured 2026-09-13, armed under
# both shells, main-deny/branch-allow, and unrowed: `<>`, `<<<`, `3>`, `0<`,
# `2>>`. `<>` and `<<<` are distinct alternations of `_CMD_REDIR`'s `[<>]+`, not
# spacing variants. These rows are a SAMPLE. Three enumerations in this change
# have been measured wrong; the claim is scoped rather than re-attempted.
#
# `vft-amp` AND `vft-clob` ARE NOT CONTROLS, though an earlier revision said so.
# Measured: (a) no control value -- the clause cut excludes `&` and `|`, so the
# scan never sees `-b --auto` and both rows stay GREEN under a mutant that
# deletes the value-flag check outright; (b) the deny is an OVER-DENIAL, because
# argv is `pr merge 42 --auto` under both shells -- genuinely armed. They are
# pins on the disclosed `--auto>&2` / `--auto>|log` clause-cut over-denial.
# IF EITHER GOES RED after someone widens the cut correctly, that is the INTENDED
# outcome: move the pin to ALLOW, do not chase the guard back.
#
# `vft-vmask` is the row that actually pins the value-flag check: `-b > -x --auto`
# strips the redirect and its dash-target, leaving `-b` ADJACENT to `--auto`, so
# --auto becomes -b's VALUE and the merge is NOT armed. The real guard denies; a
# mutant with the value-flag check deleted ALLOWS it.
#
# `vft-bang` (the `>!` operator) IS SHELL-DIVERGENT, AND THIS ROW PINS THE zsh
# READING DELIBERATELY. Measured both ways with a stub shell function: under zsh
# argv is `pr merge 42 --auto` (genuinely armed, so ALLOW is correct); under BASH
# it is `pr merge 42 -b --auto`, where `-b` eats the flag and this same ALLOW
# would be a FORGERY. Pinned at zsh because zsh is the shell the Bash tool
# actually runs, so that is the verdict that decides real merges.
#
# READ THIS BEFORE TREATING A RED `vft-bang` AS A REGRESSION: if someone later
# makes the guard bash-correct on `>!`, this row going red is the INTENDED
# outcome. Move the pin to DENY; do not change the guard back to keep it green.
# The divergence itself is recorded where the check lives -- see the `>!` entry
# under "WHAT THIS BLOCK DOES NOT SETTLE" in guard-outward-cli.sh.
VFT_IDS=(gt fd app bang in amp clob)
VFT_OPS=('>' '2>' '>>' '>!' '<' '&>' '>|')
VFT_WANT=(ALLOW ALLOW ALLOW ALLOW ALLOW DENY DENY)
for k in "${!VFT_IDS[@]}"; do
  add "vft-${VFT_IDS[$k]}" "${VFT_WANT[$k]}" "gh pr merge 42 ${VFT_OPS[$k]} -b --auto"
done
# Not in the loop: its target is a dash-prefixed NON-flag, which is the whole
# point -- it is the only row here that reaches the value-flag check.
add "vft-vmask" DENY 'gh pr merge 42 -b > -x --auto'
# DIGIT-PREFIX axis, added in review round 2: the forgery the FIRST version of
# this fix introduced. `_CMD_REDIR` opens with an OPTIONAL fd prefix, and a plain
# gsub let a match open on a MID-WORD digit run, eating characters off a real
# argv word. Measured under bash 5.3.15 via a shadowing function on a preserved
# fd: `--auto>x` is argv [--auto] (grant correct) but `--auto2>x` is argv
# [--auto2] — no --auto at all. v1 granted the second. strip_redirs() re-anchors
# such a match at the operator. Removing that is NOT an equivalent mutant: it
# converts these denies into grants, in the file's one grant-shaped read.
add "fautodig-one"   DENY  'gh pr merge 42 --auto2>x'
add "fautodig-multi" DENY  'gh pr merge 42 --auto12>>x'
add "fautodig-zero"  DENY  'gh pr merge 42 --auto007>x'
# ...paired positives, so the re-anchoring cannot be "fixed" into over-denying a
# digit run that genuinely DOES begin a word (a real fd) or a flag value.
add "fautodigfp-lead" ALLOW 'gh pr merge 42 2>x --auto'
add "fautodigfp-sp"   ALLOW 'gh pr merge 42 --auto 2>x'
add "fautodigfp-val"  ALLOW 'gh pr merge 42 -b1>x --auto'
# The OVER-DENIAL face of the same erosion, surfaced by review round 2: a digit
# fused into the VALUE FLAG's own word. `-b2>x` is one word `-b2` — `-b` with the
# attached value `2` — so the later `--auto` reaches gh unmasked and the correct
# verdict is ALLOW. v1 eroded `-b2` to `-b`, matched GH_MERGE_VALUE_FLAGS, and
# denied. The MAUTO_GLUE axis could not see this: it varies the redirect's
# spacing but always leaves the flag word itself digit-free.
add "fautodigfp-b2"   ALLOW 'gh pr merge 42 -b2>x --auto'
add "fautodigfp-bf2"  ALLOW 'gh pr merge 42 --body-file2>x --auto'
add "fautodigfp-t2"   ALLOW 'gh pr merge 42 -t2>x --auto'
# Control: a NON-digit trailing character in the same position. `-bb` is `-b`
# with the attached value `b`, so the --auto is real here too and this ALLOWs on
# both trees — it is the row that shows the three above are about the erosion
# rule, not about "a trailing character near a redirect". The row that pins the
# bare flag still masking its --auto is `mautoglue-b` (`-b>x --auto`, DENY).
add "fautodigctrl-bb" ALLOW 'gh pr merge 42 -bb>x --auto'
# PRE-EXISTING, identical on origin/main and here, so not a regression of this
# change and deliberately pinned at what BOTH trees do. Same clause-cut family
# as fautocut-* but in the granting direction: branch 1 of
# _OUT_POS_SUFFIX_MERGE_CLAUSE excludes `{`/`}`, so the clause truncates to
# `gh pr merge 42 --auto` and the scan sees a clean --auto, while real argv is
# [--auto{fd}] (a {name} fd is only an fd at a word start, exactly as digits
# are). Flipping this row would claim a fix this change does not make.
add "fautobrace-pre" ALLOW 'gh pr merge 42 --auto{fd}>x'
# RESIDUAL, and NOT a scan gap: an operator carrying `&`/`|` after the `>`
# truncates the CLAUSE before the scan runs (branch 1 of
# _OUT_POS_SUFFIX_MERGE_CLAUSE stops at a command separator), leaving a bare `>`
# that _CMD_REDIR cannot match for want of a target. Measured CLAUSE:
# [gh pr merge 42 --auto>]. Widening that cut is the reverted 2026-09-05
# CRITICAL, so the over-denial stays. The SPACED pair attributes it to the CUT.
add "fautocut-fddup"   DENY  'gh pr merge 42 --auto>&2'
add "fautocut-clob"    DENY  'gh pr merge 42 --auto>|log'
add "fautocutsp-fddup" ALLOW 'gh pr merge 42 --auto >&2'
add "fautocutsp-clob"  ALLOW 'gh pr merge 42 --auto >|log'
# OVER-GRANTING CONTROLS. Each new grant must still be stopped by the gates that
# never depended on --auto. These are what make granting the family above safe.
add "fautoog-admin" DENY 'gh pr merge 42 --auto>log --admin'
add "fautoog-repo"  DENY 'gh pr merge 42 --auto>log --repo other/org'
add "fautoog-sigil" DENY 'gh pr merge 42 --auto>anyfile ${x:---admin}'
add "fautoog-multi" DENY 'gh pr merge 42 --auto>log ; gh pr merge 7'

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
#   vcasearm    CLOSED ON THE PRECISE PATH 2026-09-13. The text here read "STILL
#               OPEN ... a live bypass" for a revision after that stopped being
#               true, which is the more dangerous direction for a comment to
#               drift: it invites the next reader to re-fix something already
#               fixed, or to cite a live bypass that is not live.
#               Measured, and pinned two constants below: the seven
#               toolvcasearm-* rows report `p=DENY j=ALLOW l=ALLOW a=ALLOW` and
#               `ok`, and NONE appears in EXPECTED_PRECISE_GAP_IDS.
#               They are still in EXPECTED_ALLPATH_DIRTY_IDS because the three
#               DEGRADED paths allow -- "closed" here means closed on the path
#               that runs, not on all four, and that distinction is exactly why
#               the all-path manifest pins per-path verdicts instead of a count.
#               The mechanism note stands: that `)` has no matching opener, so no
#               depth arithmetic reaches it, and the obvious case/esac keyword
#               tracker is a deny->ALLOW regression generator -- the fix went a
#               different way. Tracked at
#               todos/archive/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
#               NOT the whole case-arm axis: a case arm inside a BARE PAREN
#               SUBSHELL still allows on every path -- measured by
#               toolvcaseparen-*/verbvcaseparen-*/flagvcaseparen-* below (the
#               vcasebrace mechanism is the control that isolates it), see
#               todos/archive/P2-2026-09-14-case-arm-in-bare-paren-subshell-steals-the-paren-credit.md
# vcomment: a `(` inside a shell COMMENT. Inert to bash (a comment runs to
# end-of-line), so the substitution's real closer is the `)` on the NEXT line --
# but a paren-counting scanner counts it and the level never closes. This
# mechanism was a live DENY->ALLOW regression that this corpus could not see,
# because every row was single-line and a comment needs a newline to terminate
# (the row parser is newline-safe as of the same change). ADDED 2026-09-06.
# vcasecomment (added 2026-09-13, post-implementation review of the case-arm
# fix): a case arm COMPOSED with a shell COMMENT that itself contains a `;`
# followed by a decoy `esac` -- the comment is inert to real bash, but the
# scanner has no comment-state tracking (by established design, same as the
# vcomment mechanism above), so the `;` inside it is misread as a real
# separator and the decoy `esac` closes casedepth one arm early. PRE-EXISTING
# (ALLOW on the parent commit too, before the case-arm fix landed) -- see
# guard-outward-cli.sh's DOCUMENTED RESIDUALS entry for the full account.
# vcaseparen / vcasebrace (added 2026-09-14, a SEPARATE composition found in
# the same post-implementation review as vcasecomment, filed as its own todo):
# a case arm wrapped in a BARE-PAREN SUBSHELL. The subshell's own `(` takes the
# paren-depth credit lib/cmd-detect.sh's per-level counter (`parens[d]`)
# tracks; the case arm's own unmatched `)` (its pattern's `a)`) is then read as
# an ordinary paren-closer and spends that credit, so when the subshell's REAL
# closing `)` arrives, `parens[d]==0` AND `casedepth[d]==0` both hold and it is
# misread as the OUTER $(...)'s own closer -- one paren too early. PRE-EXISTING
# (ALLOW on the parent commit and on main too). vcasebrace is the CONTROL that
# isolates the mechanism: swap the subshell for a BRACE GROUP, which does not
# consume `parens[d]`, and the identical live invocation is caught -- measured
# DENY at all three splice positions (tool/verb/flag), including
# flagvcasebrace-ghadmin, which denies for the SAME pre-existing "no REAL
# --auto" reason flagvcasearm-ghadmin/flagvcasecomment-ghadmin already
# document, not because this mechanism is closed there -- read its ATTRIBUTION,
# not its verdict. See guard-outward-cli.sh's DOCUMENTED RESIDUALS entry for
# the full account.
TOOL_MECHS=('$()' '${UNSET}' '``' '$(: $(:))' '$(: "x)y")' "\$(: 'a)b')" \
            "\$(: '\"' \"a)b\" )" '$( (:) )' '$(case x in a) : ;; esac)' \
            "\$(: # (
)" '$((:)|(:))' '$(case x in a) : ;; #x;esac
b) : ;; esac)' '$( ( case x in a) : ;; esac ) )' '$({ case x in a) : ;; esac; })')
TOOL_MIDS=(vsub vvar vbt vnest vdqclose vsqclose vmixq vbareparen vcasearm vcomment varithsep vcasecomment vcaseparen vcasebrace)
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
# reproduced bypasses, pre-existing (they allow on `main` too). The rows exist so
# the gap is measured on every run instead of living in a review transcript.
# Verb-position rows additionally INVERT this file's usual asymmetry: precise
# ALLOWs while all three degraded paths DENY.
#
# UPDATED 2026-09-14: "deliberately NOT closed" no longer describes all 56, and
# hasn't since an earlier PR closed r4spec/r4dig/r4ansic-tool-* (21) and
# r4spec/r4dig/r4ansic-verb-* (21) — see the FULL ATTRIBUTION note above ("60
# CLOSED"). Of the 14 that were still open after that (r4brange-tool-*,
# r4brange-verb-*, 7 each), r4brange-verb-* closed 2026-09-14 too — see the
# "r4brange-verb-* CLOSED 2026-09-14" entry in NOTE6 above for the fix and its
# verification. So of the original 56: 49 now closed, 7 (r4brange-tool-* only)
# remain per the guard's DOCUMENTED RESIDUALS entry.
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

# axis: r4brange-verb DECOY combination (2026-09-14, found by code-reviewer
# construct-and-run during this todo's own review round; fixed same round in
# guard-outward-cli.sh via `_OUT_BR_RANGE_ALREADY_HANDLED`'s command-position
# anchor). The first shipped version of that exclusion was a bare,
# position-unanchored substring search over the WHOLE rendered command, so a
# LITERAL DECOY occurrence of `merge{1..3}`/`create{1..3}`/`comment{1..3}`/
# `api{1..3}` ANYWHERE in the command -- even inside an unrelated `echo`
# argument, nowhere near command position -- cancelled the ENTIRE brace-range
# narrow-deny block for the whole command, silently ALLOWing a genuine
# VERB-position glued construction elsewhere in the same command line. GENERATED
# from the product of {each r4brange-verb family's real construction} x {each
# of the four decoy shapes the exclusion names}, appended via `&&` -- not
# hand-listed, so a fifth decoy shape added to the exclusion later must be
# added here too or this axis silently stops covering it. Every row here
# EXPECTS DENY: the decoy is inert prose (never at gh command position), so
# only the genuine construction's own deny should fire, and this axis exists
# to catch the case where it does NOT.
R4_DECOY_SHAPES=('merge{1..3}' 'create{1..3}' 'comment{1..3}' 'api{1..3}')
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}; vp=${FAM_VERB_PREFIX[$i]}
  lw=${vp##* }; lead=${vp%"$lw"}; h=$(( ${#lw} / 2 ))
  vhead="${lead}${lw:0:$h}"; vtail="${lw:$h}"; vrest=${cmd#"$vp"}
  glued="${vhead}{${vtail:0:1}..${vtail:0:1}}${vtail:1}${vrest}"
  for d in "${!R4_DECOY_SHAPES[@]}"; do
    decoy=${R4_DECOY_SHAPES[$d]}
    add "r4brange-verb-decoy-after-$id-$d"  DENY "${glued} && echo ${decoy}"
    add "r4brange-verb-decoy-before-$id-$d" DENY "echo ${decoy} && ${glued}"
  done
done

# axis: r4brange-verb GENUINE co-occurrence (2026-09-14, found by
# code-reviewer construct-and-run in the SAME todo's review, ROUND 2 --
# dispatch item 2's own instruction to try "a decoy that's ALSO a genuine
# command-position gh construction elsewhere in a multi-clause command").
# The round-1 fix (command-position anchoring) closed the INERT-PROSE decoy
# axis above but shared its defect one level down: `_OUT_BR_RANGE_ALREADY_
# HANDLED` was still a whole-command existence check, independent of WHICH
# occurrence tripped a trigger arm and WHICH occurrence satisfies the
# exclusion. So a REAL, independently-ALLOWED gh construction sharing the
# excluded shape (bare `gh api{X..Y}` with no mutating flag; bare `gh pr
# create{X..Y}`/`gh pr comment{X..Y}` with no `--repo`) -- not decoy prose,
# a genuinely benign co-occurring command -- silenced an UNRELATED dangerous
# glued construction elsewhere in the same command line. Confirmed live
# before the round-2 fix: `eas up{d..d}ate --branch preview && gh api{1..3}`
# fully ALLOWED. Fixed by making the exclusion per-OCCURRENCE (`grep -oE`
# extraction, testing each match independently) instead of a second
# whole-command existence check. GENERATED from the product of {each
# r4brange-verb family} x {each genuine benign gh shape the exclusion names}
# x {before,after} -- not hand-listed, same reason as the decoy axis above.
# Every row EXPECTS DENY: the co-occurring gh construction is genuinely
# benign on its own merits (no -X/--repo), so only the glued construction's
# own deny should fire, and this axis exists to catch the case where it does
# NOT.
R4_GENUINE_SHAPES=('api{1..3}' 'pr create{1..3}' 'pr comment{1..3}')
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}; vp=${FAM_VERB_PREFIX[$i]}
  lw=${vp##* }; lead=${vp%"$lw"}; h=$(( ${#lw} / 2 ))
  vhead="${lead}${lw:0:$h}"; vtail="${lw:$h}"; vrest=${cmd#"$vp"}
  glued="${vhead}{${vtail:0:1}..${vtail:0:1}}${vtail:1}${vrest}"
  for g in "${!R4_GENUINE_SHAPES[@]}"; do
    genuine="gh ${R4_GENUINE_SHAPES[$g]}"
    add "r4brange-verb-genuine-after-$id-$g"  DENY "${glued} && ${genuine}"
    add "r4brange-verb-genuine-before-$id-$g" DENY "${genuine} && ${glued}"
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
#               no depth arithmetic can reach. "Still a GAP by design" stood here
#               after the fix landed and was flatly wrong AT THESE TWO POSITIONS,
#               not merely stale: verbvcasearm-* (7) and
#               flagvcasearm-easbld/ghapi/ghcomment (3) CLOSED 2026-09-13 and are
#               absent from BOTH manifests -- they deny on all four paths, so
#               they are a gap nowhere. Only the TOOL position still allows on
#               the three degraded paths (toolvcasearm-*; see the entry above it
#               and EXPECTED_ALLPATH_DIRTY_IDS).
#               flagvcasearm-ghadmin is the FOURTH flag row and reports `ok`
#               WITHOUT being a closure: it denies from the pre-existing "no REAL
#               --auto" rule. NOT because the construct breaks the `--auto`
#               spelling -- this axis splices into --admin (FAM_FLAG_LHS `--ad`
#               + RHS `min`), so --auto is byte-intact. A literal `$`, or an
#               UNQUOTED `(`, anywhere in the merge CLAUSE masks --auto, so
#               HAS_REAL_AUTO=no
#               and that rule fires before the --admin check ever runs.
#               NOT BACKTICK, and an earlier revision of this sentence said
#               backtick because it transcribed that test's character class
#               instead of running the shapes. (Cited by FRAGMENT, not by line:
#               grep guard-outward-cli.sh for `sits mid-clause and would still
#               mask`, which is unique on every branch and verified to resolve.
#               A line number here was wrong twice already -- it is measured on
#               whichever branch you happen to be standing in, and the sibling
#               brace-range branch numbers this file differently.) CLAUSE is
#               built from a rendering in which backtick spans have ALREADY
#               vanished, so a backtick never reaches that grep. Measured, one
#               clause each, --auto real in every row:
#                 `--squash $x`         DENY "without a REAL --auto"
#                 `--squash (x`         DENY "without a REAL --auto"
#                 `--squash \`echo hi\``  ALLOW   <- backtick does NOT mask
#                 `--squash` (control)  ALLOW
#               AND THE TWO SIGILS ARE NOT SYMMETRIC UNDER QUOTING, which three
#               revisions of this sentence missed for the same reason each time:
#               every measured set contained only UNQUOTED sigils, so none of
#               them could see the exception.
#                 `--body "closes (#41)"` ALLOW    quoted `(` does NOT mask
#                 `--body 'closes (41)'`  ALLOW
#                 `--body 'costs $5'`     DENY     quoted `$` still masks
#                 `--body "costs $5"`     DENY
#               The guard documents the paren exception where it is implemented:
#               $CLAUSE is cut from $WORDS, whose neutral() rewrites a QUOTED
#               separator to the letter `x`. Search guard-outward-cli.sh for
#               `QUOTED paren cannot reach here` -- WITHOUT a leading "A", which
#               sits on the previous line: a citation must be a fragment short
#               enough to survive a comment wrap, and this one was verified to
#               resolve before being written.
#               The --admin rows cannot settle this, because --admin denies
#               either way. guard-outward-cli.sh's ATTRIBUTION RESIDUAL note states the rule
#               correctly and is the wording to reuse. Read its
#               ATTRIBUTION, not its verdict -- same lesson as
#               flagvbareparen-ghadmin and co-mask-c1.
#               todos/archive/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
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
)" '$((:)|(:))' '$(case x in a) : ;; #x;esac
b) : ;; esac)' '$( ( case x in a) : ;; esac ) )' '$({ case x in a) : ;; esac; })')
SPAN2_IDS=(vbareparen vcasearm vcomment varithsep vcasecomment vcaseparen vcasebrace)
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

# axis: zsh CLOBBER-OVERRIDE redirect modifiers (2026-09-10, security review of
# PR #939). The clause tail class enumerated the `&`-bearing redirect operators
# and stopped. zsh's clobber-override spellings (`>|`, `>>|`, `&>|`, `&>>|`,
# `N>|`) END with `|`, which `[^;&|]` excludes and which no alternative
# admitted -- so the clause was cut AT the `|`, the method / `--repo` flag was
# never reached, and both checks fell through to allow-by-default. Measured
# SILENT ALLOW on all of these before the fix, against a `&>`-spelled control
# that denied; zsh executes each with argv byte-identical to that control, so
# this reached arbitrary REST mutation and cross-repo PAT egress.
#
# THE `!` ROWS ARE REGRESSION PINS, NOT FIXES. `>!` is zsh's exact synonym for
# `>|` and it denied BEFORE this change too -- but only incidentally, because
# `[^;&|]` accepts `!` as an ordinary character -- and it still does, so these
# rows are a WEAKER pin than an earlier draft of this comment claimed. Swapping
# the new alternative for `_CMD_REDIR`'s grammar leaves them GREEN (measured);
# `_CMD_REDIR`'s target class accepts `!` too. They red only when BOTH branches
# are narrowed together -- `[|!]`->`[|]` and `[^;&|]`->`[^;&|!]`.
#
# AND NOTE WHAT WAS MISSING: before today this corpus had ZERO rows containing
# `&>` or `>|` at all -- the 2026-09-07 admission of the `&`-bearing family was
# pinned only in test-guard-outward-cli.sh, never here, in the REQUIRED check.
# The `-both-` rows below close that gap in the same pass, so a revert of
# either admission now trips the required check rather than a local test.
add c9-clob-api        DENY 'gh api repos/o/r -X >|out DELETE'
add c9-clobapp-api     DENY 'gh api repos/o/r -X >>|out DELETE'
add c9-clobboth-api    DENY 'gh api repos/o/r -X &>|out DELETE'
add c9-clobbothapp-api DENY 'gh api repos/o/r -X &>>|out DELETE'
add c9-clobfd-api      DENY 'gh api repos/o/r -X 2>|out DELETE'
add c9-clob-comment    DENY 'gh pr comment 5 --body hi >|out --repo other/org'
add c9-clob-create     DENY 'gh pr create --title t >|out --repo other/org'
add c9-clob-merge      DENY 'gh pr merge 42 --auto >|out --repo other/org'
add c9-bang-api        DENY 'gh api repos/o/r -X >!out DELETE'
add c9-bangboth-api    DENY 'gh api repos/o/r -X &>!out DELETE'
add c9-bang-comment    DENY 'gh pr comment 5 --body hi >!out --repo other/org'
add c9-both-api        DENY 'gh api repos/o/r &>out -X DELETE'
add c9-bothapp-api     DENY 'gh api repos/o/r &>>out -X DELETE'
add c9-both-comment    DENY 'gh pr comment 5 --body hi &>out --repo other/org'

# axis: the `&`-AFTER half of the clobber family, and zsh NAMED file descriptors
# (2026-09-11, security review of the c9 fix above). See test-guard-outward-cli.sh
# for the full derivation. Two grammars had to move together: the tail class
# (`&` may now follow the operator, not only precede it) and `_CMD_REDIR`, whose
# trailing class `[&|]?` could not express `>&|` and whose fd prefix `([0-9]*|&)`
# could not express `{name}`. Widening either alone leaves these ALLOWED --
# measured, in a rig, before the fix was written.
add c9-after-api        DENY 'gh api repos/o/r -X >&|out DELETE'
add c9-afterapp-api     DENY 'gh api repos/o/r -X >>&|out DELETE'
add c9-afterfd-api      DENY 'gh api repos/o/r -X 2>&|out DELETE'
add c9-afterfd1-api     DENY 'gh api repos/o/r -X 1>&|out DELETE'
add c9-afterfdapp-api   DENY 'gh api repos/o/r -X 2>>&|out DELETE'
add c9-after-comment    DENY 'gh pr comment 5 --body hi >&|out --repo other/org'
add c9-after-create     DENY 'gh pr create --title t >&|out --repo other/org'
add c9-after-merge      DENY 'gh pr merge 42 --auto >&|out --repo other/org'
add c9-nfd-api          DENY 'gh api repos/o/r -X {n}>out DELETE'
add c9-nfdapp-api       DENY 'gh api repos/o/r -X {n}>>out DELETE'
add c9-nfdclob-api      DENY 'gh api repos/o/r -X {n}>|out DELETE'
add c9-nfdboth-api      DENY 'gh api repos/o/r -X {fd}&>out DELETE'
# CONTROL, and it must stay ALLOW: with no redirect operator, `-X` genuinely
# binds `{n}`, so DELETE is a positional arg and not the method. If the named-fd
# admission is ever written too greedily this row flips and says so.
add c9-nfd-bind         ALLOW 'gh api repos/o/r -X {n} DELETE'

# axis: NAMED-FD PREFIX ACROSS WHITESPACE (2026-09-11, round-3 security review).
# The `{name}` admission added hours earlier required the brace to be GLUED to
# the operator. zsh does not: unlike a NUMERIC fd, a `{name}` prefix binds
# across spaces and tabs, so one space defeated the whole admission -- on ALL
# FOUR paths, for EVERY gated binary, because `_CMD_REDIR` is shared by
# `_OUT_SEP`, `_OUT_POS_PREFIX` and `_CMD_POS_PREFIX`. `eas {n} >/dev/null
# update --branch production` executes the OTA publish this guard exists to
# prevent, with argv byte-identical to the denying control.
#
# FIFTH CONSECUTIVE HALF-CLOSED FAMILY, and this one was half-closed by the
# commit that introduced it. The `[[:space:]]*` belongs INSIDE the `{name}`
# alternative ONLY -- hoisting it so a numeric prefix also crosses whitespace
# makes `-X 3 >zz DELETE` deny, where `-X` genuinely binds `3`. Row
# c9-numfd-bind pins that boundary.
add c9-ws-eas           DENY 'eas {n} >/dev/null update --branch production --message ship'
add c9-ws-easamp        DENY 'eas {x} &>/tmp/l update --branch production --message ship'
add c9-ws-easclob       DENY 'eas {q} >|/tmp/l update --branch production --message ship'
add c9-ws-npm           DENY 'npm {n} >/dev/null publish'
add c9-ws-railway       DENY 'railway {n} >/dev/null up'
add c9-ws-railwayvar    DENY 'railway {n} >/dev/null variables set FOO=bar'
add c9-ws-ghadmin       DENY 'gh {a} >/dev/null pr merge 42 --admin'
add c9-ws-ghcomment     DENY 'gh pr {n} >/dev/null comment 5 --body hi --repo other/org'
add c9-ws-ghapi         DENY 'gh {n} >/dev/null api repos/o/r -X DELETE'
add c9-ws-method        DENY 'gh api repos/o/r -X {n} >out DELETE'
# CONTROL: a NUMERIC fd prefix does NOT bind across whitespace in zsh, so here
# `-X` really does bind `3` and DELETE is positional. Must stay ALLOW -- this is
# the row that fails if the whitespace tolerance is ever hoisted out of the
# `{name}` alternative.
add c9-numfd-bind       ALLOW 'gh api repos/o/r -X 3 >zz DELETE'

# axis: ALL-DIGIT BRACE fd bodies (2026-09-12, round-4 security review). The
# `{name}` class admitted above was `[A-Za-z_][A-Za-z0-9_]*` -- zsh ALSO accepts
# a pure-digit body (`{9}`, `{99}`, `{0}`) as an fd binding, so every shape the
# rows above pin ALLOWED again with one character changed, and this time on the
# PRECISE path too, not only the degraded mirror. Strictly worse than the
# adjacency bug it was fixing. SIXTH consecutive half-closed family; the third
# introduced by this PR's own commits.
#
# WITHOUT THESE ROWS THE REQUIRED CHECK CANNOT SEE THE DIFFERENCE: every brace
# row above uses an alphabetic body, so the corpus passed byte-identical both
# before and after the fix. A clean zero over a population of zero.
add c9-dig-eas          DENY 'eas {1} >/dev/null update --branch production --message ship'
add c9-dig-easamp       DENY 'eas {2} &>/tmp/l update --branch production --message ship'
add c9-dig-easclob      DENY 'eas {3} >|/tmp/l update --branch production --message ship'
add c9-dig-npm          DENY 'npm {4} >/dev/null publish'
add c9-dig-railway      DENY 'railway {5} >/dev/null up'
add c9-dig-railwayvar   DENY 'railway {6} >/dev/null variables set FOO=bar'
add c9-dig-ghadmin      DENY 'gh {7} >/dev/null pr merge 42 --admin'
add c9-dig-ghcomment    DENY 'gh pr {8} >/dev/null comment 5 --body hi --repo other/org'
add c9-dig-ghapi        DENY 'gh {9} >/dev/null api repos/o/r -X DELETE'
add c9-dig-method       DENY 'gh api repos/o/r -X {10} >out DELETE'
# The DEGRADED family, pinned for the first time. NO BRACE IS INVOLVED -- these
# are the plainest possible spelling, and they degrade for a reason that has
# nothing to do with fd prefixes (see the corrected note at the all-path pin).
add c9-crude-eas        DENY 'eas 2>/dev/null update --branch production --message ship'
add c9-crude-ghadmin    DENY 'gh 2>/dev/null pr merge 42 --admin'

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
# axis: DENY-SITE COVERAGE (added 2026-09-08, security review of this PR).
#
# The attribution pin can only notice a row moving between checks. It is blind to
# a deny site that NO row is attributed to: there is no row to move, so the site
# can be deleted and every one of the pin's checks stays green. That was not
# hypothetical -- the review neutered three sites in a temp guard and the corpus
# reported exit 0 with ZERO diff lines in both the verdict table and the
# attribution list, while these flipped DENY -> ALLOW:
#     eas update:delete 8f2a1c
#     eas update:republish --branch production
#     eas channel:edit production --branch hotfix
#     eas branch:delete production
#     gh pr create --fill && gh pr create --repo other/org --title x
# The first four mutate what OTA update real users receive -- the 2026-08-16
# incident class this guard exists for. The fifth is verbatim the second-clause
# --repo egress guard-outward-cli.sh records as a found-and-fixed vulnerability.
#
# GENERATED from the guard's OWN alternations, not hand-picked: NOTE6 requires new
# dimensions to be generated, and a hand-carved subset is how the tool position
# came to be missing. Its own small list rather than an addition to FAM_IDS, for
# the reason INTR_FAM_IDS states above -- these families do not belong on every
# other axis, and adding them there would flood the per-ID diff with movement this
# change did not cause.
#
# The ALLOW rows are the carve-out controls each deny message names as unaffected.
# They are not decoration: the colon alternations are the only thing separating
# `eas update:delete` from `eas update:list`, so a widening that swallowed the
# read-only forms would be a false-positive deny on a routine command, and without
# these rows nothing here would see it.
SITE_UPD_VERBS=(delete edit republish revert-update-rollout roll-back-to-embedded rollback)
for v in "${SITE_UPD_VERBS[@]}"; do add "siteupd-$v" DENY "eas update:$v 8f2a1c"; done
SITE_CB_VERBS=(create edit delete rename)
for n in channel branch; do
  for v in "${SITE_CB_VERBS[@]}"; do add "site$n-$v" DENY "eas $n:$v production"; done
done
add sitedup-ghcreate  DENY 'gh pr create --fill && gh pr create --repo other/org --title x'
add sitedup-ghcomment DENY 'gh pr comment 5 --body hi && gh pr comment 6 --repo other/org --body x'
for r in update:list update:view update:insights channel:list branch:view; do
  add "sitefp-${r//:/}" ALLOW "eas $r"
done

# axis: DENY-SITE COVERAGE, ALTERNATION BRANCHES (added 2026-09-14, security review
# finding todos/P2-2026-09-08-corpus-covers-deny-sites-but-not-their-alternation-branches.md).
#
# _pin_sites (below) proves every deny SITE the guard can emit is reached by some
# row. It cannot see one level deeper: a deny regex is usually an alternation, and
# only ONE branch of it needs a row for the whole site to stay attributed --
# `_pin_sites` is satisfied the moment ANY sibling branch still reaches the same
# message. Before this axis, `railway (up|deploy|redeploy|restart|down|delete|
# remove|rm|run)` had a row for `up` only; `eas (update|publish|submit)` had a row
# for `update` only; `railway (variable|variables|vars|var) (set|delete)` had
# rows for TWO of its four branches, not one -- the todo's own 2026-09-08
# measurement table is the authority, and "a row for `variable set` only", which
# this comment used to claim, is what made the count below fail to reconcile.
# That is 5 of the 18 branches across these 4 regexes already covered
# (9+3+4+2 = 18, minus 5, leaves exactly the 13 this axis adds); the earlier
# wording implied 4 covered and therefore 14. WHICH two of that family were
# covered is deliberately not restated here: three different instruments
# disagreed about it on 2026-09-14 (a text scan of the row bodies cannot span
# the `{n} >/dev/null` a row embeds, and an overall DENY/ALLOW mutation cannot
# see a row that several checks deny at once), and the count -- which is the
# thing the 13 depends on -- does not turn on the answer. Read the table, not
# this comment, if you need the pair. Narrowing any OTHER branch out of its alternation --
# deleting `railway run`, the exact shape of the guard's own "executes an
# arbitrary command with the LIVE service env, incl. the production DATABASE_URL"
# warning -- flipped that command DENY -> ALLOW while every existing check in this
# file's pin stayed green, measured by mutating a scratch copy of the guard and
# running the (then-current) corpus against it: 0 of the 602 pre-existing rows
# moved on any of the 4 paths.
#
# EXTRACTED from the guard's OWN alternations, not hand-listed (NOTE6: a
# hand-carved subset is how the tool position went missing in the first place).
# `_alt_or_die` greps the literal regex text out of guard-outward-cli.sh and
# aborts the WHOLE run if a pattern does not match EXACTLY one line -- the same
# denominator discipline `EXPECTED_ROWS` already gives a generation loop that runs
# dry. It is called as a plain statement, never inside `$(...)`, specifically so
# its `exit 1` reaches the top level: wrapping it in a command substitution would
# let the failure print to stderr and vanish, leaving the family silently empty
# and the corpus reporting a clean run on zero rows -- exactly the hole this whole
# file exists to close. A branch ADDED to one of these four regexes later grows
# the extracted list and grows ROWS, redding `EXPECTED_ROWS` until the pin is
# bumped -- caught automatically, with no row to write by hand.
#
# A branch REMOVED is caught too, but by a DIFFERENT and WEAKER mechanism than the
# rows above it, and the difference matters enough to say plainly rather than
# overclaim. Because extraction and verdict-testing both read the SAME guard file
# LIMIT OF THE CLAIM BELOW, measured: this holds for branches matching the
# extraction character class. That class is widened to `[a-z0-9|-]+` as of
# 2026-09-15 -- it was `[a-z|]+`, under which adding a HYPHENATED branch (and
# hyphens are already normal in this guard: update-branch, delete-asset,
# revert-update-rollout, roll-back-to-embedded) made `_alt_or_die` match 0 lines
# and abort the whole generation with a FATAL rather than growing ROWS. Fail-
# closed, so never a silent miss, but "caught automatically, no row to write by
# hand" was not what happened -- the fix was to widen the class, not bump a pin.
# in ordinary same-commit operation, a branch deleted from the guard also
# disappears from THIS file's own generated row set: `rows` shrinks, `EXPECTED_ROWS`
# reds, and the attribution manifest loses that branch's line -- a real, required,
# un-silenceable pin failure, but a row-COUNT signal, not a semantic one. It is the
# SAME signal a typo in an extraction pattern would produce, and "the count moved,
# bump the pin" is a more attractive rubber-stamp than "this specific DENY became
# an ALLOW." MUTATION-VERIFIED both ways, 2026-09-14 (see the todo below): running
# this file, unmodified, against a guard copy with `run` deleted from the railway
# alternation produced `rows is 622, expected 623` and `-siterailverb-run` removed
# from attribution -- the row vanished; it was never evaluated. A SEPARATE run that
# held row GENERATION on the real (unmutated) guard while pointing only
# verdict-testing at that same mutant -- so `siterailverb-run` still exists as a
# row -- produced the semantic form instead: `precise-path gaps is 32, expected 31`
# with `+siterailverb-run` (want DENY, got ALLOW) in the gap manifest. That second
# shape is what actually happens if this file's OWN reference commit lags the
# guard's (a stale rebase, a hand-maintained row) rather than moving with it; in
# ordinary same-commit CI it does not arise, which is exactly why the row-count
# form is the one to expect and not to wave through without reading why it moved.
_alt_or_die() {  # $1=grep -E pattern, must match EXACTLY one line of $HOOK
  local pat="$1"
  local hit n
  hit=$(grep -oE "$pat" "$HOOK")
  n=$(grep -c . <<< "$hit")
  if [ "$n" -ne 1 ]; then
    echo "FATAL: alternation-extraction pattern matched $n lines in guard-outward-cli.sh, expected exactly 1: $pat" >&2
    exit 1
  fi
  _ALT_HIT="$hit"
}

_alt_or_die 'railway\$\{_OUT_SEP\}\([a-z0-9|-]+\)\$\{_OUT_POS_SUFFIX\}'
RAILWAY_VERB_ALT=$(sed -E 's/^railway\$\{_OUT_SEP\}\(//; s/\)\$\{_OUT_POS_SUFFIX\}$//' <<< "$_ALT_HIT")
_alt_or_die 'eas\$\{_OUT_SEP\}\([a-z0-9|-]+\)\$\{_OUT_POS_SUFFIX\}'
EAS_VERB_ALT=$(sed -E 's/^eas\$\{_OUT_SEP\}\(//; s/\)\$\{_OUT_POS_SUFFIX\}$//' <<< "$_ALT_HIT")
_alt_or_die 'railway\$\{_OUT_SEP\}\([a-z0-9|-]+\)\$\{_OUT_SEP\}\(set\|delete\)\$\{_OUT_POS_SUFFIX\}'
RAILVAR_ALT=$(sed -E 's/^railway\$\{_OUT_SEP\}\(//; s/\)\$\{_OUT_SEP\}\(set\|delete\)\$\{_OUT_POS_SUFFIX\}$//' <<< "$_ALT_HIT")
_alt_or_die 'railway\$\{_OUT_SEP\}\([a-z0-9|-]+\)\$\{_OUT_SEP\}delete\$\{_OUT_POS_SUFFIX\}'
RAILSVC_ALT=$(sed -E 's/^railway\$\{_OUT_SEP\}\(//; s/\)\$\{_OUT_SEP\}delete\$\{_OUT_POS_SUFFIX\}$//' <<< "$_ALT_HIT")

IFS='|' read -ra SITERAILVERB_BR <<< "$RAILWAY_VERB_ALT"
IFS='|' read -ra SITEEASVERB_BR  <<< "$EAS_VERB_ALT"
IFS='|' read -ra SITERAILVAR_BR  <<< "$RAILVAR_ALT"
IFS='|' read -ra SITERAILSVC_BR  <<< "$RAILSVC_ALT"

for v in "${SITERAILVERB_BR[@]}"; do add "siterailverb-$v" DENY "railway $v"; done
for v in "${SITEEASVERB_BR[@]}";  do add "siteeasverb-$v"  DENY "eas $v"; done
for v in "${SITERAILVAR_BR[@]}";  do add "siterailvarset-$v" DENY "railway $v set K=V"; done
# The SECOND alternation group of the railvar site -- (set|delete) -- is not one
# of the 13 branches this todo measured, and cross-producting it against the four
# branches above belongs to the wider mechanism-x-branch sweep this axis's own
# header explicitly declines (see "Scope discipline" in the todo). One row keeps
# it from being an entirely unexercised dimension without that cross product.
add siterailvardelete DENY "railway ${SITERAILVAR_BR[0]} delete K"
for v in "${SITERAILSVC_BR[@]}";  do add "siterailsvc-$v" DENY "railway $v delete svc"; done

# FALSE-POSITIVE CONTROLS. The top-level-verb deny message above names these
# read-only forms as unaffected ("railway status, railway logs, railway whoami");
# without a row here nothing would catch a widened match swallowing them (the
# exact role `sitefp-*` plays for the eas colon-verb families above). Neither
# `railway status` nor `railway logs` had an ALLOW row anywhere in the file
# before this diff, so both are new, load-bearing controls, not decoration.
add siterailfp-status ALLOW 'railway status'
add siterailfp-logs   ALLOW 'railway logs'

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
# Membership, not just totals. All three of these are appended in the SAME
# branches that compute the verdicts below -- never recomputed afterwards from a
# second reading of the same conditions -- so a count and its list cannot encode
# different definitions of the thing they are counting. DENY_ATTRIB is collected
# here for that reason and one more: the attribution section further down used to
# re-walk ROWS and re-run `decide precise` once per row purely to re-derive the
# `p` this loop already has. Capturing here deletes all 448 of those guard
# invocations, so
# pinning attribution makes the run CHEAPER, not more expensive.
#
# The pin at the end of this file compares all three lists. Be precise about what
# the counts beside them add, because an earlier revision of this comment was not:
# `_pin_members` returns SUCCESS when BOTH sides are empty, so a count is the only
# defence against a degenerate run for a list whose PINNED side is also empty. That
# is `EXPECTED_ROWS` and nothing else -- the other three carry non-empty manifests,
# so an empty actual already reds them with every pinned line reported as removed.
# The other counts earn their place by failing FIRST and legibly ("372, expected
# 356" beats sixteen `+` lines), not by covering a case membership misses. See that
# block.
PRECISE_GAP_IDS=(); ALLPATH_DIRTY_IDS=(); DENY_ATTRIB=(); DENY_FP=(); DENY_FULL=()
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
  if [ "$p" = "$exp" ]; then note='ok'; else note="GAP (want $exp)"; GAPS=$((GAPS+1)); PRECISE_GAP_IDS+=("$id"); fi
  if [ "$p" != "$exp" ] || [ "$j" != "$exp" ] || [ "$l" != "$exp" ] || [ "$a" != "$exp" ]; then
    ALLGAPS=$((ALLGAPS+1)); ALLPATH_DIRTY_IDS+=("$id p=$p j=$j l=$l a=$a")
  fi
  # WHY a DENY row's reason is captured at all: a DENY is not evidence the
  # INTENDED check fired. `co-mask-c1`, `c1-threedash` and `flagvcasearm-ghadmin`
  # all deny for a reason unrelated to the mechanism their family name names, and
  # each of their notes below says in so many words to read the ATTRIBUTION line
  # rather than the verdict. Pinning verdicts alone leaves a refactor free to move
  # a row onto a different check with every column in the table unchanged.
  #
  # Trailing whitespace is stripped by `_fp` -- see its definition for why. Note
  # what that does and does not guarantee: it guarantees the RUN's side is clean.
  # It cannot guarantee the PINNED side, which is a heredoc a human can edit, so
  # `_pin_norm` rtrims as well. Both halves are needed and neither is redundant:
  # without the one here the run emits trailing spaces that have to be pinned
  # verbatim; without the one in `_pin_norm` a hand-edit to the heredoc that adds
  # a trailing space (a typo fix, an editor re-indent) reds this REQUIRED check
  # with a diff that looks identical on both sides. An earlier revision of this
  # comment claimed "both sides of the comparison are produced by this one line",
  # which was simply not true of the pinned side.
  if [ "$p" = DENY ]; then
    _rf=$(reason precise "$cmd"); _fpv=$(_fp "$_rf")
    DENY_FULL+=("$_rf"); DENY_FP+=("$_fpv")
    DENY_ATTRIB+=("$(printf '%-18s : %s' "$id" "$_fpv")")
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
# Printed from what the main loop captured. Same lines, same order, 448 fewer
# guard invocations than the second pass this replaces -- and the section is now
# LITERALLY the pinned manifest, so regenerating the pin is a copy of this block
# rather than a transcription of it.
if [ "${#DENY_ATTRIB[@]}" -gt 0 ]; then
  printf '%s\n' "${DENY_ATTRIB[@]}"
else
  echo "(none)"
fi

# ============================ THE PIN ========================================
# Everything above PRINTS. This block is the only thing that FAILS, and it is the
# reason running this file is now worth anything.
#
# Until 2026-09-07 nothing executed this corpus at all. scripts/run-hook-tests.sh
# globs `.claude/hooks/test-*.sh`, which this filename does not match, so the
# file ran neither in the local gate nor in CI -- and with no pin it printed its
# three totals and exited 0 under ANY drift. That is how every number in the
# notes below became a comment about a program nothing ran: three of PR #931's
# twelve confirmed findings were stale figures in this file's own prose.
# Tracked at todos/archive/P2-2026-09-07-repro-corpus-never-runs-in-ci-and-has-no-pin.md
#
# The filename is deliberately still NOT `test-*.sh`. Measured 2026-09-07 on
# darwin/arm64 across four full runs: 1m56s / 1m59s / 2m02s warm, and 3m37s on the
# first, cold-page-cache run -- against 2m18s for the entire 34-test hook suite.
# Folding this into that glob would roughly DOUBLE the preflight:fast hook gate,
# which fires on EVERY push touching .claude/hooks/, .husky/ or scripts/*.sh, for a
# signal that does not need to be pre-push. MEASURED ON THE RUNNER: the job's first
# real CI run took 2m10s (ubuntu-latest, PR #933) -- inside the warm darwin range,
# NOT near the 3m37s cold figure. An earlier revision of this comment asserted "CI
# is always cold, so budget ~3m30s"; that was reasoning from the darwin cold run
# rather than from a measurement, and the runner disagreed. It runs as its own
# always-on CI job; see
# .github/workflows/ci.yml -> the "Outward-CLI guard corpus" job. That name carries
# no row count ON PURPOSE: it is a REQUIRED check, branch protection matches it as an
# exact string, and a renamed job never satisfies the requirement rather than failing
# it -- so the check sits permanently "expected" and nothing in the repo can merge.
# Learned the direct way; see that job's comment.
#
# *** THE FOUR CHECKS ARE NOT REDUNDANT. EACH CATCHES WHAT THE OTHERS CANNOT.
# DO NOT DELETE ANY OF THEM. ***
#
# 1. COUNTS catch a corpus that produced NOTHING. `_pin_members` compares "" to
#    "" and RETURNS SUCCESS -- a degenerate run (ROWS empty after a botched
#    refactor of the generation loop) sails through both manifests and is caught
#    ONLY by `_pin_count "rows"`. The counts are not a cosmetic fast-fail; they
#    are the denominator assertion. An earlier revision of this comment called
#    them "only a faster error message", which invited exactly the edit that
#    would reopen this hole.
#
# 2. MEMBERSHIP catches a SWAP. A count of 31 stays green when one gap closes and
#    a different one opens, so both manifests are diffed with `comm`, never by
#    subtracting totals.
#
# 3. PER-PATH VERDICTS catch a row getting STRICTLY WORSE without changing
#    membership. Every all-path entry is `id p=.. j=.. l=.. a=..`, not a bare id,
#    because a bare id records one OR-collapsed bit ("dirty on some path") and
#    NOTE6's round-3 correction below is precisely the movement that bit cannot
#    see: those rows were ALREADY all-path-dirty on both sides and went from ONE
#    failing degraded path to THREE.
#
#    THE EXAMPLE HERE WAS RE-MEASURED 2026-09-14 AND ITS IDS CHANGED. It named
#    verbvcasearm-*/flagvcasearm-*, which was true when written and was falsified
#    by this todo's OWN implementation commits -- those rows now deny on all four
#    paths and appear in neither manifest. The illustration survives with different
#    occupants: 57 rows sit at `p=ALLOW j=DENY l=DENY a=DENY`, and the 10 that make
#    the point are verbvcasecomment-* (7) + flagvcasecomment-* (3), a case arm
#    composed with a comment hiding a decoy `esac`. A guard change flipping their
#    three degraded DENYs to ALLOW would strip the fail-closed fallback from seven
#    gated families and move NOTHING an id-only pin observes. The 370 rows clean on
#    all four paths (620 - 250) stay covered by ABSENCE -- any of them going dirty
#    appears as a `+` line.
#
# 4. ATTRIBUTION catches a row that keeps its verdict and changes WHICH CHECK
#    produced it, ON THE PRECISE PATH. The other three read only DENY/ALLOW, so a
#    refactor that moves a row onto a different deny branch leaves every count,
#    every membership set and every per-path tuple byte-identical.
#    The path qualifier is not a hole, and it is measured rather than assumed:
#    each degraded path reaches exactly ONE reason, its own fail-closed fallback in
#    crude_smells_outward (nojq "jq unavailable...", nolib "lib/cmd-detect.sh is
#    unsourceable...", noawk "the quote-aware rendering came back empty..."), 25
#    rows each, printed in the precise-clean/degraded-dirty section above. There is
#    no second branch on those paths to reroute ONTO, so there is no degraded-path
#    attribution to pin. Stated so a reader does not go hunting an empty hole. That is the `co-mask-c1` hazard
#    this file documents at length below -- "read this row's ATTRIBUTION line,
#    never its verdict alone" -- and until 2026-09-08 the pin encoded the
#    assurance those notes tell you not to make.
#    MUTATION-VERIFIED, not assumed. The mutation is the reordering the guard
#    itself declined to make and recorded as needing "its own mutation evidence"
#    (see guard-outward-cli.sh, above the `--admin` check): defer the "no REAL
#    --auto flag" deny to the `--admin` deny three lines below it whenever the
#    --admin scan matches. Both branches DENY, so no verdict on any of the four
#    paths can move, and none did: all 448 rows x 4 verdict columns came back
#    BYTE-IDENTICAL and every other check in this block stayed green, while SEVEN
#    rows silently changed which check was protecting them -- co-mask-c1,
#    co-redir-mask, and five of the flagv*-ghadmin family (arithsep, bareparen,
#    comment, sub, var). This list was the only thing in the file that noticed.
#    Note which rows did NOT move: c1-threedash keeps its old attribution, because
#    `${x:----admin}` leaves THREE dashes and `_OUT_FLAG_LEAD` correctly refuses
#    that as a flag boundary. The set was measured, not predicted -- a first guess
#    at it named c1-threedash and missed four of the seven.
#    What it still cannot see: the reason is truncated, so two checks whose
#    messages agree over the truncation would collapse into one fingerprint.
#    Measured 2026-09-08 by widening the cut to 400 and re-running: the distinct
#    fingerprint count equals the distinct full-reason count (20 of each over all
#    372 DENY rows), so nothing is currently colliding. That is no longer a
#    measurement you have to remember to repeat -- `_pin_distinct` asserts it every
#    run, from the same guard invocation, because a measurement recorded in a
#    comment is not a guard. The width is 72 BYTES, not characters --
#    see `reason()` for why that distinction is the difference between a stable pin
#    and one that disagrees between a dev box and the runner. Both measurements, and
#    the full mutation transcript, are at
#    todos/archive/P2-2026-09-07-corpus-pin-does-not-cover-deny-reason-attribution.md.
#
#    AND THE ONE THAT IS STILL OPEN, named because a residual list that discloses
#    only the residual it has already closed is worse than no list. A scope
#    NARROWING INSIDE a check that still fires first for every corpus row: the
#    check keeps producing the same verdict AND the same reason for all 721 rows
#    (the corpus's current size -- see EXPECTED_ROWS) while commands outside the
#    corpus flip. Nothing in this block can see that -- not attribution, not the
#    per-path tuples, not `_pin_sites`, which asks whether a check is reached, never whether it is
#    reached by everything it should be. That is a question about which ROWS
#    EXIST, and the only answers are new axes and adversarial construction. It is
#    the honest boundary of what a per-row pin asserts, and the reason NOTE6's "a
#    corpus can only report on the axes it varies" is the first thing to read
#    after this.
#
#    NARROWED 2026-09-14
#    (todos/P2-2026-09-08-corpus-covers-deny-sites-but-not-their-alternation-branches.md):
#    the most CONCRETE instance of this residual
#    -- deleting one branch out of a MULTI-BRANCH alternation the guard's own
#    regex already enumerates -- is closed for the four regexes it is shaped
#    that way for (railway's top-level verb list, eas's top-level verb list, the
#    railway variable/vars/var alternation, and the railway service/environment
#    alternation). See the "DENY-SITE COVERAGE, ALTERNATION BRANCHES" axis above:
#    it extracts each alternation from the guard's own source, so a branch ADDED
#    to one of those four regexes later grows this file's own row count until the
#    pin is bumped, rather than sitting invisible the way the 13 measured here
#    2026-09-08 did.
#
#    WHAT REMAINS is everything this instance's method does not reach, and one
#    thing it COULD reach but does not yet (review round 1 caught this omission --
#    naming it here rather than only in the residual is the same "a list that
#    discloses only the residual it has already closed is worse than no list"
#    discipline this whole paragraph is about):
#    (a1) the SITE_UPD_VERBS / SITE_CB_VERBS families a few hundred lines above
#    (`eas update:(delete|edit|republish|...)`, `eas (channel|branch):(create|
#    edit|delete|rename)`) are the EXACT SAME alternation-of-literal-branches
#    shape `_alt_or_die` already handles -- SITE_CB_VERBS is even a two-group
#    alternation, like the railvar site -- but they PRE-DATE this axis (PR #935)
#    and are still hand-listed, not extracted. Their coverage is COMPLETE today
#    (every branch of both alternations has a row), so this is not a live gap the
#    way the 13 measured branches were; it is the same class of latent risk this
#    todo closed for four OTHER regexes, left open for these two because
#    retrofitting a shipped, working mechanism was judged out of THIS todo's
#    scope rather than folded in under time pressure. A branch added to either
#    regex later needs a human to remember to extend the hand-list, exactly the
#    "hand-carved subset" failure NOTE6 exists to prevent.
#    GH_PR_CREATE_RE (guard-outward-cli.sh, `gh pr (create|comment)`) belongs
#    in this bucket too -- added 2026-09-15 so the corpus and the companion
#    solution doc stop disagreeing about the same list. Hand-listed, and coverage
#    COMPLETE -- and the row counts are deliberately NOT pinned in this sentence,
#    because a count here has now been wrong twice in two different ways. "19 rows
#    for `create`, 49 for `comment` across the 623" was this branch's own pre-merge
#    measurement, never re-derived after absorbing main's rows. Its 2026-09-15
#    replacement said 33 and 60 across the 721 and did NOT say how they were
#    counted; review counting a plain `pr create` substring got 37 and 82 and could
#    not reproduce it. Both numbers are correct FOR THEIR OWN SHAPE -- 33/60
#    requires single spaces (`gh pr create`), 37/82 accepts any `pr create`
#    substring -- and neither said which, which is the whole defect. A count over a
#    corpus is a property of the matcher as much as of the corpus. Count it when
#    you need it, against a dump of ROWS, and name the shape you counted:
#      grep -cE 'gh pr create' <rows-dump>   # single-space form
#      grep -cE 'pr create'    <rows-dump>   # substring form, counts strictly more
#    WHY THIS BLOCK CITES NAMES AND NOT LINE NUMBERS (2026-09-15). It used to do
#    both. Every `guard-outward-cli.sh:NNNN` here was computed while this branch
#    still sat on a 602-row base, and the merge that brought main to 721 also
#    brought in main's LONGER copy of the guard -- shifting every cited line by 78
#    to 249 (measured: 944->1022, 1606->1698, 2493->2742, 2759->3008) while
#    guard-outward-cli.sh itself stayed BYTE-IDENTICAL between the two trees. The
#    first version of this sentence said "90 to 250", which its own first example
#    (a shift of 78) falsifies -- a rounded range asserted in the very paragraph
#    arguing for measurement, caught by review.
#    Nothing that was cited changed; the citations still all became wrong.
#    A positional reference decays under any edit ABOVE it, including one made by
#    somebody else in a file you did not touch, and a merge is exactly the
#    operation that delivers those edits silently. The name survives, so grep the
#    name. See docs/solutions/code-quality/a-positional-reference-decays-anchor-instead-2026-09-13.md
#    (a2) TWO MORE ALTERNATION-SHAPED SITES THAT ARE HAND-LISTED *AND*
#    INCOMPLETELY COVERED. Added 2026-09-15 after a review pointed out that (a1)
#    discloses only a family whose coverage is COMPLETE while these two, with
#    ~26 zero-row branches between them, were in no bucket at all -- which is
#    precisely the "a list that discloses only the residual it has already
#    closed" failure this paragraph invokes twice. Both are live, measured here,
#    not theoretical:
#      GH_MUTATING_RE (guard-outward-cli.sh) spans 22 literal branches
#      across three namespaces. EXACTLY TWO have a row -- `release create` and
#      `repo delete`. All NINE `pr` branches (close, edit, ready, reopen, review,
#      lock, unlock, update-branch, revert) are at zero rows, as are 4 of 5
#      release and 7 of 8 repo branches. Deleting `close` from the alternation
#      makes that command ALLOW while moving 0 of this file's rows.
#      THE OTA-SCRIPT SITES (two deny sites in guard-outward-cli.sh) span
#      (npm|pnpm|yarn) x (run-script|run) x (preview|production) and
#      (yarn|pnpm) x (preview|production). Census over the GENERATED ROWS -- and
#      the scope matters, because an earlier wording said "appears 0 times
#      anywhere in this file", which counted the sentence itself and so refuted
#      itself under `grep -c`: of the 721 generated rows, ZERO contain `pnpm`
#      and ZERO contain `run-script`, and the only shapes generated are
#      npm+run+preview and the yarn-form production rows -- so the
#      preview/production cross is unexercised for npm. Deleting the
#      `production` branch was measured to flip this repo's own documented OTA
#      publish command from DENY to ALLOW, run verbatim
#      (`npm run update:production -- --message "ship it"`), with the preview
#      form holding DENY as control in the same run. That is the 2026-08-16
#      incident class, so this is the one to close first. Extending the P3 follow-up below, not folded in
#      here, because retrofitting them is the same shipped-mechanism retrofit
#      (a1) was scoped out for.
#    (a3) FLAG-, VERB- AND METHOD-POSITION BRANCH LISTS, hand-listed and
#    incompletely covered.
#
#    *** DERIVE THIS BUCKET, DO NOT READ IT AS A LIST. *** Three successive
#    revisions of this paragraph each added a bucket the previous one had called
#    exhaustive, so the enumeration itself is the defect and the list below is a
#    SNAPSHOT of a scan, not a closed set. THE SCAN, which is the durable part:
#    take every NON-COMMENT line of guard-outward-cli.sh and pull each flat
#    `(a|b|c)` alternation whose branches are all literals out of it. Compare
#    THAT population against these buckets -- not against the names written here,
#    which is how the last three misses happened.
#
#    THE LIST BELOW IS THE TEST OF THE SCAN, NOT THE OTHER WAY ROUND, and that
#    inversion is the correction. An earlier revision published a group count and
#    then a LINE SET as "the stable part"; neither survived. THREE independent
#    runs at the 2026-09-15 head returned 43 groups / 20 lines, 42 / 19 and
#    39 / 18, disagreeing on membership and not merely on totals -- one included
#    `_OUT_POS_SUFFIX`, one included `_OUT_REPO_FLAG_RE` while
#    missing GH_MUTATING_RE and the gh-api method site, and no
#    two agreed. A count is a property of the scan; so, it turns out, is the line
#    set. What does not move is the MEMBERS, which can be checked one at a time.
#
#    So: run a scan to DISCOVER candidates, then check it against the list below.
#    A scan that cannot return every listed member is too strict and will also
#    miss the next member written in that shape -- which is the hand-carved-subset
#    failure NOTE6 exists to prevent, one level up. Three branch shapes occur here
#    and a usable scan has to admit all three:
#      bare literal                 update            npm            --repo
#      literal + boundary group     --repo([^-A-Za-z0-9]|$)
#      case-folding bracket run     [Pp][Oo][Ss][Tt]      (_GH_API_M needs this)
#      MIXED                        literal branches alongside NON-literal siblings --
#                                   e.g. _OUT_POS_PREFIX carries 11 command-prefix words
#                                   next to a `VAR=` character class and an interpolated
#                                   $_CMD_REDIR. Added 2026-09-15 because "every branch is
#                                   a literal" EXCLUDES this shape BY CONSTRUCTION, which
#                                   is how the scan published here missed an entire bucket
#                                   while reading as exhaustive. A group qualifies if ANY
#                                   branch is a deletable literal, not if all of them are.
#    and it must handle NESTED groups, since GH_MUTATING_RE's branches are
#    themselves alternations. `_OUT_POS_SUFFIX` is NOT a member whichever
#    way the scan is drawn: its branches are character classes, so narrowing it is
#    bucket (c)'s territory below ("narrowing a character class inside one
#    branch"), not a branch deletion. That question is closed, not open.
#
#    Known members at that head, with the ones whose coverage is incomplete:
#      All of these live in guard-outward-cli.sh. They are cited BY NAME and not by
#      line number on purpose -- see the note at the end of this block.
#      _OUT_GATED_BIN            6 branches
#      _OUT_GATED_VERB          17 branches
#      _GH_API_M                 4 branches
#      _OUT_REPO_FLAG_RE         2 branches
#      GH_MERGE_VALUE_FLAGS     25 branches, 18 with NO row
#      _OUT_POS_PREFIX          11 literal branches, 0 with a row
#                               (env|command|builtin|exec|nohup|setsid|then|do|else|elif|time)
#      the (-X|--method) sites   hand-listed but
#                         COVERED: deleting `--method` moves 3 rows
#                         (flagadj{glue,sp,fd}-ghapimeth), so an enumeration gap
#                         rather than a hole.
#    DENOMINATOR PROVENANCE (added 2026-09-15): every "moves 0 of 623 rows" figure
#    below was measured on THIS BRANCH BEFORE it merged main, when the corpus held
#    623 rows. The merged corpus holds 721. Those mutations were NOT re-run
#    afterwards, so read each `623` as naming the tree the experiment ran on, not
#    this one. What each experiment established -- that the mutation moved no row
#    the corpus then contained -- stands for that tree. Whether it also moves none
#    of the 98 rows main added is UNMEASURED, and saying "0 of 721" here would be
#    asserting a measurement nobody took.
#    Two of their branches are measurably uncovered, constructed and run rather
#    than inferred:
#      _GH_API_M: deleting the PATCH branch makes `gh api repos/o/r -X PATCH`
#        ALLOW (control: -X POST still DENY) and moves 0 of 623 rows. A row
#        census agrees -- POST and DELETE and PUT all have rows, PATCH has NONE.
#        An arbitrary GitHub REST mutation is exactly the egress class this
#        guard exists for.
#      _OUT_GATED_BIN: deleting `pnpm` makes a pnpm invocation ALLOW (control:
#        the yarn form still DENY) and moves 0 of 623 rows.
#      GH_MERGE_VALUE_FLAGS is the FORGED-`--auto` DEFENCE and the most costly of
#        these: it rejects an --auto match whose preceding token is a value-taking
#        flag, so `--add-label --auto` must not count as a real --auto. Deleting
#        that ONE branch was measured to flip `gh pr merge 42 --add-label --auto`
#        from DENY to ALLOW, with three controls holding in the same run
#        (`--title --auto` still DENY, so the mechanism works for a branch left
#        in place; `--auto` alone still ALLOW, the sanctioned carve-out; no
#        --auto at all still DENY) -- and 0 of 623 rows move. THE RESIDUAL IS
#        WIDER THAN A ROW CENSUS SUGGESTS, in the direction this paragraph twice
#        calls the worst one. A token-boundary census gives 18 branches with no
#        row, not 17 (the old figure was a substring artifact -- `-c` matches
#        only inside `--cwd`). Row-presence is the wrong question anyway: what
#        matters is exercise IN THE POSITION THIS CHECK READS, adjacent to
#        `--auto` in a `gh pr merge` clause, and only THREE branches are -- `-b`,
#        `--body-file`, `-t`. So 22 of the 25 deletions are invisible. Proven on a
#        branch the census counted as COVERED: deleting `--title` flips
#        `gh pr merge 42 --title --auto` DENY -> ALLOW, with `-b --auto` still
#        DENY and bare `--auto` still ALLOW as controls, corpus byte-identical.
#    Positive control for both, in the same runs: deleting `run` from the
#    railway alternation moved exactly one row (siterailverb-run), so the
#    instrument was live.
#    (a4) THE CRUDE DEGRADED MIRROR'S OWN COPIES. Added 2026-09-15. The mirror --
#    the fail-closed function that runs only when jq, awk or the lib is already
#    broken -- carries its own hand-listed branch lists in guard-outward-cli.sh:
#    the degraded-path binary list `(eas|railway|npm|pnpm|yarn|gh)`, the degraded
#    verb mega-alternation (sixteen alternation groups mirroring essentially every
#    command-position site regex) and the degraded gh-flag list (`(create|comment)`
#    and `(--repo|-R)`): 19 groups, in none of (a1)/(a2)/(a3).
#    They are NOT redundant with the precise-path lists -- they are a PARALLEL
#    COPY governing the three degraded paths this corpus tests and pins per-path,
#    so covering the precise list does not cover them, and the two must be kept
#    in step BY HAND. Measured: deleting `pnpm` from the degraded-path binary
#    list alone, leaving
#    _OUT_GATED_BIN intact, keeps the precise verdict at DENY and flips the
#    DEGRADED verdict DENY->ALLOW, control `yarn` holding DENY on both paths, and
#    0 of 623 rows move when precise AND degraded verdicts are compared per row.
#    (b) any OTHER deny check in the file that is GENUINELY not a branch list --
#    narrowed twice now, because it twice asserted a universal that measurement
#    broke: the interior-redirect, flag-adjacent, forged/masked --auto,
#    decoy-clause and root-position-flag families are each their own bespoke
#    regex, not a branch list, and adding a branch-style row generator for them
#    is exactly the "enumerate every mechanism x every branch" cross product
#    this todo's own scope note declines. THREE NARROWINGS RECORDED, because the
#    same sentence has now been wrong three times: it first said the remaining
#    checks "do not take the alternation shape at all" ((a2) refuted that), then
#    implied the remainder were bespoke regexes ((a3) refuted that), then still
#    missed the degraded mirror's parallel copies ((a4) refuted that). The
#    honest reading is that this bucket is whatever the scan in (a3) does not
#    account for -- a REMAINDER, not a characterisation. Do not restate it as a
#    property;
#    (c) narrowing that is not branch DELETION at all -- tightening `_OUT_SEP` or
#    themselves, or narrowing a character class inside one
#    branch rather than removing the branch whole. `_OUT_POS_PREFIX` WAS NAMED
#    HERE AND IS NOT BUCKET (c) MATERIAL: unlike _OUT_SEP, whose branches carry
#    no literal, it holds 11 bare literals that are individually deletable.
#    Measured -- removing ONLY `nohup` flips `nohup eas update --branch preview`,
#    `nohup railway up`, `nohup npm publish` and `nohup gh api repos/o/r -X POST`
#    from DENY to ALLOW, with `eas update` and `setsid eas update` holding DENY
#    as controls in the same run, and the full corpus against that mutant is
#    BYTE-IDENTICAL to the green baseline. One branch deletion, four deny
#    families opened including the OTA publish path, zero rows moved. It is an
#    (a3) member and is listed there.
#    branch rather than removing the branch whole.
#    All SIX are real and still invisible to every check in this
#    block for the same reason the original paragraph gave: this is a question
#    about which rows exist, not one a fixed pin can answer without a new axis
#    (or, for (a1)/(a2)/(a3)/(a4), the same axis extended) for each shape.
#
#    The residual this list USED to name second -- a deny site no row reaches, so
#    deleting it is invisible -- was live when it was written and is closed now:
#    see the DENY-SITE COVERAGE axis and `_pin_sites`. It was found by a reviewer
#    deleting three real protections and watching this file exit 0.
#
# BUMP 2026-09-14 (round-3 security review). The apicollapse-* axis was re-keyed from
# SEPARATORS to COMMAND-POSITION OPENERS — `;&|` plus `(`, backtick, `{`, `!`, and the
# executing `<(`/`>(` spellings — because keyed on separators it varied exactly the three
# characters the previous fix excluded and could only confirm that fix. A process substitution
# opening at `(` was live through it. 27 -> 81 rows in the axis, so +54 overall and +54
# attribution rows (every new row denies); precise-path gaps unchanged at 31, all-path gaps
# unchanged at 279, NOTHING REMOVED. EXPECTED_EMIT_SITES 26 -> 27 for the GH_API_RE_SEPSAFE
# integrity check, which no command text can reach and which is registered in
# _pin_exempt_sites with its reason rather than given a row.
#
# One expectation in this axis was WRONG on the first pass and the corpus caught it: the
# backtick opener was declared ALLOW on the strength of a hand probe that had actually
# measured a BACKSLASH-backtick, because it built the character through shell text. Nine rows
# came back GAP. A probe that constructs its input through the shell tests whatever the shell
# left behind — which, for precisely the characters an axis like this varies, is not the
# character you named.
#
# BUMP 2026-09-14 (round-2 security review of the same change). ONE mechanism: the value arm
# added in the bump below is not monotone on an occurrence COUNT, so a consumed value could
# swallow a separator and collapse two `gh api` occurrences into one, retiring the ambiguity
# refusal. Counting now takes the MAX of the wide and separator-safe grammars. +30 rows, all
# in the new generated apicollapse-* axis (3 flags x 3 separators x 3 tails = 27, plus 3
# controls); +27 attribution rows = exactly the DENY-expecting new rows; +2 all-path dirty =
# the two ALLOW controls whose degraded mirror over-denies, the category this file already
# documents. Precise-path gaps unchanged at 31, and NOTHING WAS REMOVED.
#
# READ THIS BEFORE TRUSTING THE AXES BELOW: the regression that prompted this bump moved
# ZERO rows of the 655-row corpus that existed at the time. Not because the corpus is weak --
# because no dimension varied "a flag whose value swallows a separator". The axis exists now;
# the lesson is that its absence was invisible.
#
# BUMP 2026-09-13 (second half of the root-position P0). ONE mechanism moved every ID:
# _CMD_GH_GLOBALS's generic arm gained an OPTIONAL non-dash value token, so a root-position
# flag that TAKES a separate argument no longer leaves that argument where the namespace
# belongs. +53 rows, all in the new generated ghrootv-* axis (8 flags x 6 families = 48, plus
# 2 literals and 3 false-positive controls). +34 all-path dirty and +34 attribution rows --
# the same 34, i.e. exactly the DENY-expecting new rows; the 16 two-sided ALLOW rows and the
# 3 controls add neither. NOTHING WAS REMOVED from either manifest, which is the check that
# says no pre-existing row changed behaviour. Precise-path gaps are unchanged at 31: the new
# axis contributes none. Every number here was read out of the run, and the manifest lines
# were pasted from the run's own "+" output rather than typed.
#
# HOW TO BUMP: a bump is a deliberate, dated edit, and the DIFF is where a
# reviewer confirms the movement was intended. Re-run this file, paste the sets
# it reports, and state in the commit message WHICH mechanism moved each ID.
# Never bump a pin to turn a red gate green without that sentence -- that is the
# failure mode this whole block exists to prevent.

# 739 -> 876 (2026-09-15) BY A MERGE, AND THE PIN LINE DID NOT CONFLICT. That is the
# part worth reading twice. Both sides of this merge carried the literal `739`, so git
# had nothing to reconcile and kept it -- but they reached 739 from a common base of
# 602 by entirely different routes, each adding 137 rows: main via the brace-range and
# case-arm work, the root-position-flag-PROPERTY branch via its ghrootv-* axis. The
# merged tree holds both sets: 602 + 137 + 137 = 876.
# MEASURED, NOT COMPUTED: the run on the resolved tree reported
# `rows=876  precise-path gaps=24  all-path gaps=279` and
# `FAIL: rows is 876, expected 739`. The arithmetic is a check on the measurement.
#
# THE ALL-PATH TOTAL IS THE DANGEROUS ONE HERE, and it is dangerous in a way the
# 2026-09-15 case-arm bump was not. EXPECTED_ALLPATH_GAPS read 279 BEFORE this bump and
# measures 279 AFTER it -- the scalar check passes either way. It passes for a bad
# reason: the merge assembled an inconsistent pair, main's 243-entry manifest sitting
# under the other branch's 279 scalar, because each line was taken from a different
# side. EXPECTED_ALLPATH_DIRTY_IDS is what caught it: 36 members entered while the
# count sat still. A count-only pin would have waved this through, which is the same
# lesson EXPECTED_PRECISE_GAP_IDS was added for and the reason both exist.
#
# Nothing CLOSED in this merge -- every membership drift was an addition (-0/+36 and
# -0/+115). That is what you expect from a branch that ADDS covered rows rather than
# fixing an open gap, and it is stated because "one closed, one opened" is the
# comfortable misreading this block warns about elsewhere.
# All three manifests below were REGENERATED FROM THE RUN, not hand-merged. Hand-merging
# them is how an earlier resolution in this same file silently dropped flagvcasearm-*
# and produced a 21-member pin that still looked plausible.
EXPECTED_ROWS=876

# One line per precise-path DENY, `id : <first 72 chars of the deny reason>`.
# 761 of the 876 rows deny on the precise path; the other 115 are ALLOW there: 91
# rows EXPECTED to allow, plus the 24 precise-path gaps. Those 91 span NINETEEN id
# families -- fp-* (16), ghrootv-* (16), c2-* (9), c1g-* (7), fautodigfp-* (6),
# sitefp-* (5), vft-* (5), flagadjfp-* (4), apicolfp-* (3), decoyfp-* (3),
# ghrootfp-* (3), ghrootvfp-* (3), c9-* (2), fautocutsp-* (2), fautogrant-* (2),
# siterailfp-* (2), plus the singletons co-nested-brace, fautobrace-pre and
# fautodigctrl-bb. COUNTED, not recalled: select every row whose EXPECTED and
# PRECISE verdicts are both ALLOW, group on the id prefix. 91 + 24 = 115 and
# 876 - 761 = 115, so the decomposition closes.
#
# THIS PARAGRAPH WAS ITSELF THE SIXTH STALE COPY, and it went stale in the way this
# file keeps documenting one level down. It read "646 of the 739 ... 69 ... SIXTEEN
# families" -- every figure correct, and correct about MAIN, whose copy of these
# lines is byte-identical. A merge brought main's prose into a tree with 876 rows
# and 761 attributions, and prose has no gate: no pin reddens, no suite fails, and
# the five count pins right above were all caught precisely because something DID
# redden for them. It was found by review, by re-running the decomposition rather
# than reading the sentence.
# The worst line was the one asserting its own freshness -- "RE-DERIVED 2026-09-15
# after the case-arm merge and unchanged by it: the sixteen families and their
# counts are identical, because that merge moved only rows that DENY or that are
# gaps". True of the case-arm merge it named, false of the merge the file now sits
# in: 22 rows entered that are ALLOW on both EXPECTED and PRECISE and are not gaps
# -- ghrootv-* (16), ghrootvfp-* (3) and apicolfp-* (3) -- so 69 + 22 = 91 and
# sixteen families became nineteen. A claim of having been re-derived is not
# evidence of having been re-derived, and it is worse than no claim, because it
# stops the next reader checking. Re-derive it or delete it; do not carry it. Corrected 2026-09-13: this was the FIFTH stale copy of a
# count in this file, found by review after four others were repaired -- and it
# sits five lines above its own warning about exactly that. These numbers are
# bumped with
# EXPECTED_DENY_ATTRIB_ROWS below -- a round-4 review found them two revisions
# stale, sitting directly above the constant they describe.
# BUMPED 2026-09-14 (todos/archive/P2-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md):
# 504 -> 511. The 7 `r4brange-verb-*` rows now deny (their own new check, see
# guard-outward-cli.sh's brace-range narrow-deny block) and moved from the gap
# bucket below into this one. The 7 `r4brange-tool-*` rows did NOT move --
# still a documented residual, see EXPECTED_PRECISE_GAPS just below.
# BUMPED AGAIN, SAME DAY (code-reviewer round-1 CRITICAL on this todo's own
# review): 511 -> 567, +56 new `r4brange-verb-decoy-{after,before}-*` rows
# (56 = 7 families x 4 decoy shapes x 2 positions). These did not exist when
# the block above was written; they were added to durably regression-pin the
# fix for a real bypass the reviewer found by construct-and-run (a decoy
# occurrence of `merge{1..3}`/etc. ANYWHERE in the command silently disabled
# the entire brace-range narrow-deny block, because the exclusion added by the
# block above was a bare, position-unanchored substring search). All 56 rows
# deny (EXPECTED_ROWS also bumped 602 -> 658 for the same reason) -- none are
# gaps, so EXPECTED_PRECISE_GAPS/EXPECTED_ALLPATH_GAPS below are unaffected by
# this second bump.
# BUMPED A THIRD TIME, SAME DAY (code-reviewer round-2 CRITICAL, found by the
# SAME dispatch's own "try a genuine co-occurring gh construction" adversarial
# instruction): 567 -> 609, +42 new `r4brange-verb-genuine-{after,before}-*`
# rows (42 = 7 families x 3 genuine-benign gh shapes x 2 positions). The
# round-1 fix (command-position anchoring) closed the inert-prose decoy axis
# above but not this one: the exclusion was still a whole-command existence
# check, so a REAL, independently-ALLOWED gh construction sharing the excluded
# shape (bare `gh api{X..Y}`, no mutating flag; bare `gh pr create{X..Y}`/
# `gh pr comment{X..Y}`, no `--repo`) elsewhere in the command silenced an
# unrelated dangerous glued construction. Fixed by making the exclusion
# per-OCCURRENCE (`grep -oE` extraction) instead of a second whole-command
# check. All 42 rows deny (EXPECTED_ROWS bumped 658 -> 700 too) -- none are
# gaps.
# BUMPED A FOURTH TIME 2026-09-15, and this one is NOT a guard behaviour change --
# it is the arithmetic of two branches that each grew the same corpus, reconciled
# at merge. See todos/archive/P2-2026-09-08-corpus-covers-deny-sites-but-not-their-alternation-branches.md
# for the branch side: it added 21 rows on a base of 602 (19 of them denying on the
# precise path), covering every alternation BRANCH at a deny site instead of one row
# per site. main meanwhile went 602 -> 700 for the brace-range work described above.
# Merged, that is 700 + 21 = 721 rows and 609 + 19 = 628 attributions.
# MEASURED, NOT COMPUTED: the arithmetic above is stated only because re-running this
# file on the resolved tree independently reported `rows=721  precise-path gaps=24
# all-path gaps=236`, with NO id in either +/- drift list -- so nothing opened,
# nothing closed, and no row was rerouted to a different check. Had the two figures
# disagreed, the measurement would be the one that counts.
# EXPECTED_PRECISE_GAPS/EXPECTED_ALLPATH_GAPS are unaffected (24/236, main's values):
# every added row denies, so none of them lands in a gap bucket.
# The `siterailfp-*` control family was ALSO restored to the ALLOW decomposition
# above, because main's copy of that sentence predates those 2 rows.
# CORRECTED THE SAME DAY, BY REVIEW: restoring it did NOT make that list complete,
# and the first version of this paragraph asserted that it did. Enumerating the
# ALLOW set showed the eight named families covered only 42 of the 69 rows -- five
# more families and three singletons were missing. The list above is now the
# measured sixteen. The lesson is one this file keeps relearning: confirming that a
# named member EXISTS is a positive check, and says nothing about whether the list
# is EXHAUSTIVE. Exhaustiveness is a negative claim and needs the full enumeration,
# which is cheap here -- the run already prints every row.
# BUMPED 2026-09-15 by the case-arm merge, and the PRECISE-GAP TOTAL IS THE
# DANGEROUS ONE HERE: it did not move. See
# todos/archive/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
# for that branch. It closes the `case`-arm bypass on the precise path, so its 14
# `toolvcasearm-*`/`verbvcasearm-*` gaps and the 3 `flagvcasearm-*` gaps LEAVE the
# precise-gap set, and it adds 17 `*vcasecomment-*` rows for the still-open
# comment-composition residual, which ENTER it. 24 - 17 + 17 = 24. The count is
# identical before and after while SEVENTEEN of its twenty-four members changed,
# which is exactly what EXPECTED_PRECISE_GAP_IDS exists to catch and what a
# count-only pin would have waved through. Both manifests below were regenerated
# from the run, not hand-merged -- hand-merging them is how the first attempt at
# this resolution silently dropped `flagvcasearm-*` and produced a 21-member pin
# that still looked plausible.
# The other three moved as the two branches compose: rows 721 -> 739 (+18),
# attribution 628 -> 646 (+18), all-path gaps 236 -> 243 (+7). MEASURED on the
# resolved tree: `rows=739  precise-path gaps=24  all-path gaps=243`.
# THE 17 INCOMING ROWS DO NOT SHARE ONE SHAPE, which is why they are listed by
# family and not summarised. Re-measured on this tree, not carried across the
# merge from the branch that wrote them:
#     7  toolvcasecomment-*   p=ALLOW j=ALLOW l=ALLOW a=ALLOW
#     7  verbvcasecomment-*   p=ALLOW j=DENY  l=DENY  a=DENY
#     3  flagvcasecomment-*   p=ALLOW j=DENY  l=DENY  a=DENY
# All 17 miss on the PRECISE path, which is what makes every one of them a gap;
# only the first seven are ALLOW on all four. An earlier revision on the branch
# said all of them were "ALLOW on all four paths" -- one FORM's property asserted
# of the whole CLASS, the defect that branch's own solution doc is named after.
EXPECTED_DENY_ATTRIB_ROWS=761

# 7 + 17 = 24. This is the SAME decomposition as the "FULL ATTRIBUTION of the
# remaining precise-path gaps" note further down, and the two must stay equal:
#   7   r4brange-tool-* (7) -- brace range glued to the BINARY name itself,
#       no sigil. CLOSED 2026-09-14 for the sibling r4brange-verb-* (7, the
#       range glued to the VERB instead) -- see guard-outward-cli.sh's
#       brace-range narrow-deny block and its own DOCUMENTED RESIDUALS entry
#       for why TOOL-position specifically stays open (reaching the new check
#       needs the fast-path prefilter to not cheap-exit first, which needs an
#       intact binary-name substring or a stage-3 decline sigil neither of
#       which a split BINARY name supplies, and this todo's Scope Contract
#       forbids widening the fast path's sigil class to reach it).
#   17  toolvcasearm-* (7) + verbvcasearm-* (7) + flagvcasearm-* (3 of 4)
#       -- `case` arm `)` with no matching opener.
# Both buckets are DELIBERATE, documented residuals with open todos, not
# failures. Pinning 0 here would make this gate permanently red, and a
# permanently red gate gets disabled -- which is how the corpus ended up
# unguarded in the first place.
EXPECTED_PRECISE_GAPS=24

# PRE-EXISTING STALENESS, found incidentally while bumping this pin for the
# brace-range fix (2026-09-14) and left AS FOUND rather than silently
# re-derived: the "31 + 133 = 164" cross-check this comment used to state does
# not equal the pinned constant below even before this change (243, not 164).
# Measured directly against a fresh run rather than assumed: the
# "precise-clean, degraded-dirty" section printed 212 rows on this same run,
# not 133, and 31 (the OLD EXPECTED_PRECISE_GAPS) + 212 = 243 -- the actual old
# pinned value. So "133" (and the sub-splits below it: "25 over-denied... 108
# DENY-expected...") is itself a stale count this comment never caught, from
# before some now-untraced axis was added. This bump does not re-derive that
# breakdown -- it is out of THIS todo's scope (a fast-path/precise-path narrow
# deny, not a degraded-mirror audit) and the 212 figure has no verified
# per-family split behind it yet. What IS verified for this bump: with the 7
# `r4brange-verb-*` rows closed, GAPS dropped 31 -> 24 and the hidden-section
# row count stayed 212 (unchanged, confirmed by diffing pre- and post-fix
# runs) -- so 24 + 212 = 236, matching EXPECTED_ALLPATH_GAPS below exactly. A
# future pass auditing the 133/212 discrepancy should start from that 212, not
# from this comment's old sub-splits.
#   24  every precise-path gap (a precise gap is all-path dirty by definition;
#       verified as a strict subset, not assumed)
#  212  precise-CLEAN rows dirty on at least one degraded path -- the
#       crude_smells_outward mirror, deliberately NOT widened in PR #931.
#       READ THAT CITATION NARROWLY. todos/P1-2026-09-07-crude-smells-degraded-mirror-lags-the-flag-adjacent-fix.md
#       enumerates SIX rows (flagadjfd-* x3, flagadjsp-* x2, flagadjglue-npmlog),
#       NOT this bucket. The family-by-family sub-split this comment used to
#       carry (25 ALLOW-expecting + 108 DENY-expected = 133) is the stale part
#       named above -- NOT re-stated here as fact; see that paragraph.
# THE ALL-PATH GAPS BELOW ARE NAMED, NOT ABSORBED -- AND THE FIRST VERSION OF
# THIS NOTE NAMED THE WRONG CAUSE. It said the c9-ws-* rows degrade because the
# crude mirror "does not model a `{name}` fd prefix at all". Measured, that is
# false: the same command degrades identically with NO BRACE ANYWHERE (rows
# c9-crude-*). The real cause is `crude_smells_outward`'s binary->verb separator
# `[^a-zA-Z]+` -- the sentence already names the function, and the line number that
# used to sit here resolved to unrelated text on the sibling brace-range branch, so it
# is dropped rather than corrected -- which cannot cross ANY redirect
# whose target contains letters -- `/dev/null`, `/tmp/l`. The family is
# therefore much broader than a brace prefix, and was entirely unpinned.
#
# The contrast that makes it non-obvious: row co-pref-sufx DENYs on all four
# paths, because there the mirror still sees the binary and verb contiguous.
# Position, not presence.
#
# Attributing a gap to the narrowest mechanism you just touched is how this file
# keeps producing residual lists that read as complete. Measure the sibling
# shape before you name the cause.
EXPECTED_ALLPATH_GAPS=279

EXPECTED_PRECISE_GAP_IDS=$(cat <<'PIN_PRECISE_EOF'
flagvcasecomment-easbld
flagvcasecomment-ghapi
flagvcasecomment-ghcomment
r4brange-tool-easbld
r4brange-tool-easupd
r4brange-tool-ghapi
r4brange-tool-ghcomment
r4brange-tool-ghmerge
r4brange-tool-npmpub
r4brange-tool-railup
toolvcasecomment-easbld
toolvcasecomment-easupd
toolvcasecomment-ghapi
toolvcasecomment-ghcomment
toolvcasecomment-ghmerge
toolvcasecomment-npmpub
toolvcasecomment-railup
verbvcasecomment-easbld
verbvcasecomment-easupd
verbvcasecomment-ghapi
verbvcasecomment-ghcomment
verbvcasecomment-ghmerge
verbvcasecomment-npmpub
verbvcasecomment-railup
PIN_PRECISE_EOF
)

EXPECTED_ALLPATH_DIRTY_IDS=$(cat <<'PIN_ALLPATH_EOF'
apicolfp-oneshot p=ALLOW j=DENY l=DENY a=DENY
apicolfp-read p=ALLOW j=DENY l=DENY a=DENY
c1g-allargs-3dash p=ALLOW j=DENY l=DENY a=DENY
c1g-arrelem-3dash p=ALLOW j=DENY l=DENY a=DENY
c1g-barebang-3dash p=ALLOW j=DENY l=DENY a=DENY
c1g-excl-length p=ALLOW j=DENY l=DENY a=DENY
c1g-excl-status p=ALLOW j=DENY l=DENY a=DENY
c1g-ind-3dash p=ALLOW j=DENY l=DENY a=DENY
c1g-pos1-3dash p=ALLOW j=DENY l=DENY a=DENY
c2-dynpath p=ALLOW j=DENY l=DENY a=DENY
c2-fp-backtick p=ALLOW j=DENY l=DENY a=DENY
c2-fp-getf p=ALLOW j=DENY l=DENY a=DENY
c2-fp-header p=ALLOW j=DENY l=DENY a=DENY
c2-fp-jq p=ALLOW j=DENY l=DENY a=DENY
c2-fp-methodology p=ALLOW j=DENY l=DENY a=DENY
c2-fp-paginate p=ALLOW j=DENY l=DENY a=DENY
c2-fp-user p=ALLOW j=DENY l=DENY a=DENY
c2-readonly p=ALLOW j=DENY l=DENY a=DENY
c9-crude-eas p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-crude-ghadmin p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-eas p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-easamp p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-easclob p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-ghadmin p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-npm p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-railway p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-dig-railwayvar p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-nfd-bind p=ALLOW j=DENY l=DENY a=DENY
c9-numfd-bind p=ALLOW j=DENY l=DENY a=DENY
c9-ws-eas p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-easamp p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-easclob p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-ghadmin p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-npm p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-railway p=DENY j=ALLOW l=ALLOW a=ALLOW
c9-ws-railwayvar p=DENY j=ALLOW l=ALLOW a=ALLOW
decoyfp-auto p=ALLOW j=DENY l=DENY a=DENY
fauto-cooccur p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoamp-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoamp-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoampl-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoampl-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoapp-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoapp-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautobang-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautobang-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautobrace-pre p=ALLOW j=DENY l=DENY a=DENY
fautoclob-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoclob-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautocutsp-clob p=ALLOW j=DENY l=DENY a=DENY
fautocutsp-fddup p=ALLOW j=DENY l=DENY a=DENY
fautodigctrl-bb p=ALLOW j=DENY l=DENY a=DENY
fautodigfp-b2 p=ALLOW j=DENY l=DENY a=DENY
fautodigfp-bf2 p=ALLOW j=DENY l=DENY a=DENY
fautodigfp-lead p=ALLOW j=DENY l=DENY a=DENY
fautodigfp-sp p=ALLOW j=DENY l=DENY a=DENY
fautodigfp-t2 p=ALLOW j=DENY l=DENY a=DENY
fautodigfp-val p=ALLOW j=DENY l=DENY a=DENY
fautofd-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautofd-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautogrant-amp p=ALLOW j=DENY l=DENY a=DENY
fautogrant-glue p=ALLOW j=DENY l=DENY a=DENY
fautogt-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautogt-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoin-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautoin-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautonfd-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautonfd-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
fautonfddig-ns p=DENY j=ALLOW l=ALLOW a=ALLOW
fautonfddig-tool p=DENY j=ALLOW l=ALLOW a=ALLOW
flagadjfd-npmlog p=DENY j=ALLOW l=ALLOW a=ALLOW
flagadjfp-andand p=ALLOW j=DENY l=DENY a=DENY
flagadjfp-roredir p=ALLOW j=DENY l=DENY a=DENY
flagadjfp-semi p=ALLOW j=DENY l=DENY a=DENY
flagadjglue-npmlog p=DENY j=ALLOW l=ALLOW a=ALLOW
flagadjsp-npmlog p=DENY j=ALLOW l=ALLOW a=ALLOW
flagadjsp-yarncwd p=DENY j=ALLOW l=ALLOW a=ALLOW
flagvcasecomment-easbld p=ALLOW j=DENY l=DENY a=DENY
flagvcasecomment-ghapi p=ALLOW j=DENY l=DENY a=DENY
flagvcasecomment-ghcomment p=ALLOW j=DENY l=DENY a=DENY
fp-automerge p=ALLOW j=DENY l=DENY a=DENY
fp-c2-noflag p=ALLOW j=DENY l=DENY a=DENY
fp-easread p=ALLOW j=DENY l=DENY a=DENY
fp-mention p=ALLOW j=DENY l=DENY a=DENY
fp-quotedall p=ALLOW j=DENY l=DENY a=DENY
ghroot-Rglued-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rglued-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rglued-ghcreate p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rglued-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rsep-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rsep-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rsep-ghcreate p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-Rsep-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-repoeq-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-repoeq-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-repoeq-ghcreate p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-repoeq-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-reposep-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-reposep-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-reposep-ghcreate p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-reposep-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-selfrepo p=DENY j=ALLOW l=ALLOW a=ALLOW
ghroot-vs-auto p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-authoremail-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-authoremail-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-authoremail-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-authoremail-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-body-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-body-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-body-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-body-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-bodyfile-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-bodyfile-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-bodyfile-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-bodyfile-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-matchhead-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-matchhead-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-matchhead-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-matchhead-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-noarg-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-noarg-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-noarg-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-noarg-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-retarget p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-selfrepo p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-subject-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-subject-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-subject-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-subject-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownlong-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownlong-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownlong-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownlong-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownshort-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownshort-ghcommentR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownshort-ghcreateR p=DENY j=ALLOW l=ALLOW a=ALLOW
ghrootv-unknownshort-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnsglue-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnsglue-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnsglue-ghrelease p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnsglue-ghrepo p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnsglue-railsvc p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnsglue-railvar p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnssp-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnssp-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnssp-ghrelease p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnssp-ghrepo p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnssp-railsvc p=DENY j=ALLOW l=ALLOW a=ALLOW
intrnssp-railvar p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-ghrelease p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-ghrepo p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-railsvc p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolglue-railvar p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-ghrelease p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-ghrepo p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-railsvc p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
intrtoolsp-railvar p=DENY j=ALLOW l=ALLOW a=ALLOW
nssufx-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
nssufx-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
r4ansic-tool-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-easbld p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-easupd p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-ghapi p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-ghcomment p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-ghmerge p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-npmpub p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4brange-tool-railup p=ALLOW j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
r4dig-tool-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
r4spec-tool-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
sitefp-updateinsights p=ALLOW j=DENY l=DENY a=DENY
sitefp-updatelist p=ALLOW j=DENY l=DENY a=DENY
sitefp-updateview p=ALLOW j=DENY l=DENY a=DENY
toolvarithsep-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvarithsep-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvarithsep-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvarithsep-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvarithsep-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvarithsep-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvarithsep-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvbareparen-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasearm-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-easbld p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-easupd p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-ghapi p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-ghcomment p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-ghmerge p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-npmpub p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvcasecomment-railup p=ALLOW j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvdqclose-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvmixq-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvnest-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-easbld p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-ghapi p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-ghcomment p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-ghmerge p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-npmpub p=DENY j=ALLOW l=ALLOW a=ALLOW
toolvsqclose-railup p=DENY j=ALLOW l=ALLOW a=ALLOW
trailclose-ctl p=DENY j=ALLOW l=ALLOW a=ALLOW
trailclose-easupd p=DENY j=ALLOW l=ALLOW a=ALLOW
trailclose-ghmrg p=DENY j=ALLOW l=ALLOW a=ALLOW
verbvcasecomment-easbld p=ALLOW j=DENY l=DENY a=DENY
verbvcasecomment-easupd p=ALLOW j=DENY l=DENY a=DENY
verbvcasecomment-ghapi p=ALLOW j=DENY l=DENY a=DENY
verbvcasecomment-ghcomment p=ALLOW j=DENY l=DENY a=DENY
verbvcasecomment-ghmerge p=ALLOW j=DENY l=DENY a=DENY
verbvcasecomment-npmpub p=ALLOW j=DENY l=DENY a=DENY
verbvcasecomment-railup p=ALLOW j=DENY l=DENY a=DENY
vft-app p=ALLOW j=DENY l=DENY a=DENY
vft-bang p=ALLOW j=DENY l=DENY a=DENY
vft-fd p=ALLOW j=DENY l=DENY a=DENY
vft-gt p=ALLOW j=DENY l=DENY a=DENY
vft-in p=ALLOW j=DENY l=DENY a=DENY
PIN_ALLPATH_EOF
)

# Generated by running this file and copying its "deny-reason attribution"
# section verbatim -- that section prints exactly these strings, in this order.
# Read the RIGHT-hand side when a line moves: it names the check in prose, which
# is the whole point of pinning attribution rather than a digest of it.
#
# A FUNCTION, not the `$(cat <<'EOF' ... )` form the two manifests above use, and
# that is not a style choice. bash's command-substitution parser counts
# parentheses THROUGH a quoted heredoc body, and `reason`'s `cut -c1-72` truncates
# two of these 17 messages mid-parenthetical ("(and the yar", "(-X/--method
# POST/"). Inside `$( ... )` those unmatched `(`s desync the scanner and the whole
# file dies with "unexpected EOF while looking for matching `)'" -- at PARSE time,
# so no amount of testing the logic reaches it. Same scanner-desync family as the
# cmd-detect bare-paren fix in dd45ef3e. A heredoc in a plain function body is
# never scanned that way. Do not "simplify" this back.
_pin_expected_attrib() { cat <<'PIN_ATTRIB_EOF'
apicollapse-shortc-amp-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-amp-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-amp-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-bang-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-bang-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-bang-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-brace-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-brace-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-brace-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-btick-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-btick-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-btick-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-paren-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-paren-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-paren-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-pipe-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-pipe-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-pipe-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-psubin-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-psubin-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-psubin-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-psubout-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-psubout-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-psubout-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-semi-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-semi-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortc-semi-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-amp-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-amp-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-amp-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-bang-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-bang-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-bang-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-brace-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-brace-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-brace-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-btick-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-btick-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-btick-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-paren-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-paren-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-paren-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-pipe-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-pipe-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-pipe-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-psubin-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-psubin-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-psubin-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-psubout-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-psubout-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-psubout-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-semi-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-semi-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-shortt-semi-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-amp-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-amp-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-amp-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-bang-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-bang-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-bang-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-brace-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-brace-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-brace-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-btick-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-btick-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-btick-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-paren-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-paren-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-paren-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-pipe-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-pipe-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-pipe-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-psubin-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-psubin-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-psubin-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-psubout-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-psubout-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-psubout-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-semi-method : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-semi-mut : more than one command-position 'gh api' occurrence — ambiguous, cannot
apicollapse-unknown-semi-read : more than one command-position 'gh api' occurrence — ambiguous, cannot
c1-create-colon    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1-repo-colon      : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1-repo-lit        : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1-repo-short      : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1-submit-bare     : command-position 'eas build --auto-submit' submits the finished binary t
c1-submit-colon    : command-position 'eas build --auto-submit' submits the finished binary t
c1-submit-lit      : command-position 'eas build --auto-submit' submits the finished binary t
c1-submit-plus     : command-position 'eas build --auto-submit' submits the finished binary t
c1-threedash       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
c1g-allargs-lit    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1g-allargstar     : command-position 'eas build --auto-submit' submits the finished binary t
c1g-arrat-lit      : command-position 'eas build --auto-submit' submits the finished binary t
c1g-arrelem-lit    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1g-arrstar-lit    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1g-bangkeys-lit   : command-position 'eas build --auto-submit' submits the finished binary t
c1g-barebang-lit   : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1g-ind-lit        : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1g-inddig-lit     : command-position 'eas build --auto-submit' submits the finished binary t
c1g-pos1-lit       : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c1g-pos10-lit      : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c2-ansic-hex       : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-backtick        : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-dynamic         : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-empty-proof-expand : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-empty-proof-lit : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c2-expand          : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-glued           : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-lit             : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c2-tension         : command-position 'gh api' with a method flag (-X/--method) whose value i
c2-tension-bt      : command-position 'gh api' with a method flag (-X/--method) whose value i
c9-after-api       : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-after-comment   : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-after-create    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-after-merge     : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
c9-afterapp-api    : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-afterfd-api     : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-afterfd1-api    : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-afterfdapp-api  : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-bang-api        : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-bang-comment    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-bangboth-api    : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-both-api        : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-both-comment    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-bothapp-api     : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-clob-api        : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-clob-comment    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-clob-create     : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-clob-merge      : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
c9-clobapp-api     : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-clobboth-api    : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-clobbothapp-api : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-clobfd-api      : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-crude-eas       : command-position 'eas update/publish/submit' publishes an OTA update or
c9-crude-ghadmin   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
c9-dig-eas         : command-position 'eas update/publish/submit' publishes an OTA update or
c9-dig-easamp      : command-position 'eas update/publish/submit' publishes an OTA update or
c9-dig-easclob     : command-position 'eas update/publish/submit' publishes an OTA update or
c9-dig-ghadmin     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
c9-dig-ghapi       : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-dig-ghcomment   : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-dig-method      : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-dig-npm         : command-position 'npm publish' pushes a package to the registry.
c9-dig-railway     : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
c9-dig-railwayvar  : command-position 'railway variable/vars/var set/delete' mutates a live s
c9-nfd-api         : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-nfdapp-api      : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-nfdboth-api     : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-nfdclob-api     : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-ws-eas          : command-position 'eas update/publish/submit' publishes an OTA update or
c9-ws-easamp       : command-position 'eas update/publish/submit' publishes an OTA update or
c9-ws-easclob      : command-position 'eas update/publish/submit' publishes an OTA update or
c9-ws-ghadmin      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
c9-ws-ghapi        : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-ws-ghcomment    : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
c9-ws-method       : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
c9-ws-npm          : command-position 'npm publish' pushes a package to the registry.
c9-ws-railway      : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
c9-ws-railwayvar   : command-position 'railway variable/vars/var set/delete' mutates a live s
cap-199-ghmerge    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
cap-200-ghmerge    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
cap-250-easupd     : command-position 'eas update/publish/submit' publishes an OTA update or
cap-250-ghmerge    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
co-c2-halfA        : command-position 'gh api' with a method flag (-X/--method) whose value i
co-c2-halfB        : command-position 'gh api' with a method flag (-X/--method) whose value i
co-c2-predA        : command-position 'gh api' with a method flag (-X/--method) whose value i
co-c2-predB        : command-position 'gh api' with a method flag (-X/--method) whose value i
co-c2-toolsplit    : command-position 'gh api' with a method flag (-X/--method) whose value i
co-c2-toolsub      : command-position 'gh api' with a method flag (-X/--method) whose value i
co-ind-pref        : command-position 'eas build --auto-submit' submits the finished binary t
co-mask-c1         : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
co-pos-create      : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
co-pref-dollar     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
co-pref-multi      : more than one command-position 'gh pr merge' occurrence — ambiguous, c
co-pref-sufx       : command-position 'eas update/publish/submit' publishes an OTA update or
co-redir-mask      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
co-sigil-c1        : command-position 'eas build --auto-submit' submits the finished binary t
co-two-api         : more than one command-position 'gh api' occurrence — ambiguous, cannot
co-two-api-c2      : more than one command-position 'gh api' occurrence — ambiguous, cannot
decoynsfd-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynsfd-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynsfd-ghmerge  : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoynsglue-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynsglue-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynsglue-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoynsplain-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynsplain-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynsplain-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoynssp-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynssp-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoynssp-ghmerge  : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoytoolfd-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolfd-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolfd-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoytoolglue-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolglue-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolglue-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoytoolplain-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolplain-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolplain-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
decoytoolsp-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolsp-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
decoytoolsp-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
fauto-cooccur      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoamp-lead      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoamp-ns        : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoamp-tool      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoamp-trail     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoampl-lead     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoampl-ns       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoampl-tool     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoampl-trail    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoapp-lead      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoapp-ns        : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoapp-tool      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoapp-trail     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautobang-lead     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautobang-ns       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautobang-tool     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautobang-trail    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoclob-lead     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoclob-ns       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoclob-tool     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoclob-trail    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoctrl-glued    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautocut-clob      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautocut-fddup     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautodig-multi     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautodig-one       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautodig-zero      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautofd-lead       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautofd-ns         : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautofd-tool       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautofd-trail      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautogt-lead       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautogt-ns         : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautogt-tool       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautogt-trail      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoin-lead       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoin-ns         : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoin-tool       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoin-trail      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautojoin-glue     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautojoin-off      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautojoin-sp       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfd-lead      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfd-ns        : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfd-tool      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfd-trail     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfddig-lead   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfddig-ns     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfddig-tool   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautonfddig-trail  : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
fautoog-admin      : command-position 'gh pr merge --admin' uses administrator privileges to
fautoog-multi      : more than one command-position 'gh pr merge' occurrence — ambiguous, c
fautoog-repo       : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
fautoog-sigil      : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagadjctrl-boolean : command-position 'npm run update:preview/update:production' (and the yar
flagadjfd-ghapimeth : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
flagadjfd-ghapix   : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
flagadjfd-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagadjfd-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagadjfd-npmlog   : command-position 'npm run update:preview/update:production' (and the yar
flagadjfd-yarncwd  : command-position 'npm run update:preview/update:production' (and the yar
flagadjglue-ghapimeth : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
flagadjglue-ghapix : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
flagadjglue-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagadjglue-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagadjglue-npmlog : command-position 'npm run update:preview/update:production' (and the yar
flagadjglue-yarncwd : command-position 'npm run update:preview/update:production' (and the yar
flagadjsp-ghapimeth : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
flagadjsp-ghapix   : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
flagadjsp-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagadjsp-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagadjsp-npmlog   : command-position 'npm run update:preview/update:production' (and the yar
flagadjsp-yarncwd  : command-position 'npm run update:preview/update:production' (and the yar
flagvarithsep-easbld : command-position 'eas build --auto-submit' submits the finished binary t
flagvarithsep-ghadmin : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvarithsep-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvarithsep-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagvbareparen-easbld : command-position 'eas build --auto-submit' submits the finished binary t
flagvbareparen-ghadmin : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvbareparen-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvbareparen-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagvbt-easbld     : command-position 'eas build --auto-submit' submits the finished binary t
flagvbt-ghadmin    : command-position 'gh pr merge --admin' uses administrator privileges to
flagvbt-ghapi      : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvbt-ghcomment  : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagvcasearm-easbld : command-position 'eas build --auto-submit' submits the finished binary t
flagvcasearm-ghadmin : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvcasearm-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvcasearm-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagvcasecomment-ghadmin : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvcomment-easbld : command-position 'eas build --auto-submit' submits the finished binary t
flagvcomment-ghadmin : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvcomment-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvcomment-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagvsub-easbld    : command-position 'eas build --auto-submit' submits the finished binary t
flagvsub-ghadmin   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvsub-ghapi     : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvsub-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
flagvvar-easbld    : command-position 'eas build --auto-submit' submits the finished binary t
flagvvar-ghadmin   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
flagvvar-ghapi     : command-position 'gh api' with a method flag (-X/--method) whose value i
flagvvar-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghapi-redir-trail  : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghroot-Rglued-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghroot-Rglued-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-Rglued-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-Rglued-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghroot-Rsep-ghapi  : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghroot-Rsep-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-Rsep-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-Rsep-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghroot-repoeq-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghroot-repoeq-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-repoeq-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-repoeq-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghroot-reposep-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghroot-reposep-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-reposep-ghcreate : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghroot-reposep-ghmerge : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghroot-selfrepo    : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghroot-vs-auto     : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghrootv-authoremail-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-authoremail-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-authoremail-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-authoremail-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-body-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-body-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-body-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-body-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-bodyfile-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-bodyfile-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-bodyfile-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-bodyfile-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-matchhead-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-matchhead-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-matchhead-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-matchhead-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-noarg-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-noarg-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-noarg-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-noarg-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-retarget   : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghrootv-selfrepo   : 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with
ghrootv-subject-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-subject-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-subject-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-subject-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-unknownlong-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-unknownlong-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-unknownlong-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-unknownlong-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
ghrootv-unknownshort-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
ghrootv-unknownshort-ghcommentR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-unknownshort-ghcreateR : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
ghrootv-unknownshort-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrnsfd-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
intrnsfd-ghmerge   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrnsfd-ghrelease : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrnsfd-ghrepo    : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrnsfd-railsvc   : command-position 'railway service/environment delete' deletes a live Rai
intrnsfd-railvar   : command-position 'railway variable/vars/var set/delete' mutates a live s
intrnsglue-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
intrnsglue-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrnsglue-ghrelease : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrnsglue-ghrepo  : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrnsglue-railsvc : command-position 'railway service/environment delete' deletes a live Rai
intrnsglue-railvar : command-position 'railway variable/vars/var set/delete' mutates a live s
intrnssp-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
intrnssp-ghmerge   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrnssp-ghrelease : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrnssp-ghrepo    : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrnssp-railsvc   : command-position 'railway service/environment delete' deletes a live Rai
intrnssp-railvar   : command-position 'railway variable/vars/var set/delete' mutates a live s
intrtoolfd-easbld  : command-position 'eas build --auto-submit' submits the finished binary t
intrtoolfd-easupd  : command-position 'eas update/publish/submit' publishes an OTA update or
intrtoolfd-ghapi   : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
intrtoolfd-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
intrtoolfd-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrtoolfd-ghrelease : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrtoolfd-ghrepo  : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrtoolfd-npmpub  : command-position 'npm publish' pushes a package to the registry.
intrtoolfd-railsvc : command-position 'railway service/environment delete' deletes a live Rai
intrtoolfd-railup  : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
intrtoolfd-railvar : command-position 'railway variable/vars/var set/delete' mutates a live s
intrtoolglue-easbld : command-position 'eas build --auto-submit' submits the finished binary t
intrtoolglue-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
intrtoolglue-ghapi : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
intrtoolglue-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
intrtoolglue-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrtoolglue-ghrelease : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrtoolglue-ghrepo : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrtoolglue-npmpub : command-position 'npm publish' pushes a package to the registry.
intrtoolglue-railsvc : command-position 'railway service/environment delete' deletes a live Rai
intrtoolglue-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
intrtoolglue-railvar : command-position 'railway variable/vars/var set/delete' mutates a live s
intrtoolsp-easbld  : command-position 'eas build --auto-submit' submits the finished binary t
intrtoolsp-easupd  : command-position 'eas update/publish/submit' publishes an OTA update or
intrtoolsp-ghapi   : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
intrtoolsp-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
intrtoolsp-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
intrtoolsp-ghrelease : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrtoolsp-ghrepo  : command-position mutating 'gh pr/release/repo' subcommand. Read-only for
intrtoolsp-npmpub  : command-position 'npm publish' pushes a package to the registry.
intrtoolsp-railsvc : command-position 'railway service/environment delete' deletes a live Rai
intrtoolsp-railup  : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
intrtoolsp-railvar : command-position 'railway variable/vars/var set/delete' mutates a live s
lit-easbld         : command-position 'eas build --auto-submit' submits the finished binary t
lit-easupd         : command-position 'eas update/publish/submit' publishes an OTA update or
lit-ghapi          : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
lit-ghcomment      : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
lit-ghmerge        : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
lit-npmpub         : command-position 'npm publish' pushes a package to the registry.
lit-railup         : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
mautofd-b          : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautofd-bodyfile   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautofd-t          : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautoglue-b        : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautoglue-bodyfile : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautoglue-t        : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautosp-b          : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautosp-bodyfile   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mautosp-t          : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mid-backtick       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mid-eas            : command-position 'eas update/publish/submit' publishes an OTA update or
mid-sub            : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
mid-var            : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
nssufx-ghcomment   : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
nssufx-ghmerge     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
nsvsub-ghcomment   : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
nsvsub-ghmerge     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
nsvvar-ghcomment   : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
nsvvar-ghmerge     : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
pref-easbld        : command-position 'eas build --auto-submit' submits the finished binary t
pref-easupd        : command-position 'eas update/publish/submit' publishes an OTA update or
pref-ghapi         : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
pref-ghcomment     : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
pref-ghmerge       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
pref-npmpub        : command-position 'npm publish' pushes a package to the registry.
pref-railup        : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
r4ansic-tool-easbld : command-position 'eas build --auto-submit' submits the finished binary t
r4ansic-tool-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
r4ansic-tool-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
r4ansic-tool-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
r4ansic-tool-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
r4ansic-tool-npmpub : command-position 'npm publish' pushes a package to the registry.
r4ansic-tool-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
r4ansic-verb-easbld : command-position 'eas build --auto-submit' submits the finished binary t
r4ansic-verb-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
r4ansic-verb-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
r4ansic-verb-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
r4ansic-verb-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
r4ansic-verb-npmpub : command-position 'npm publish' pushes a package to the registry.
r4ansic-verb-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
r4brange-verb-decoy-after-easbld-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easbld-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easbld-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easbld-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easupd-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easupd-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easupd-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-easupd-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghapi-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghapi-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghapi-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghapi-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghcomment-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghcomment-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghcomment-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghcomment-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghmerge-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghmerge-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghmerge-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-ghmerge-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-npmpub-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-npmpub-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-npmpub-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-npmpub-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-railup-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-railup-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-railup-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-after-railup-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easbld-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easbld-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easbld-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easbld-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easupd-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easupd-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easupd-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-easupd-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghapi-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghapi-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghapi-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghapi-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghcomment-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghcomment-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghcomment-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghcomment-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghmerge-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghmerge-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghmerge-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-ghmerge-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-npmpub-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-npmpub-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-npmpub-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-npmpub-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-railup-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-railup-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-railup-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-decoy-before-railup-3 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-easbld : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-easupd : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-easbld-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-easbld-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-easbld-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-easupd-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-easupd-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-easupd-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghapi-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghapi-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghapi-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghcomment-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghcomment-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghcomment-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghmerge-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghmerge-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-ghmerge-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-npmpub-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-npmpub-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-npmpub-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-railup-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-railup-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-after-railup-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-easbld-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-easbld-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-easbld-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-easupd-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-easupd-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-easupd-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghapi-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghapi-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghapi-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghcomment-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghcomment-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghcomment-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghmerge-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghmerge-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-ghmerge-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-npmpub-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-npmpub-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-npmpub-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-railup-0 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-railup-1 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-genuine-before-railup-2 : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-ghapi : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-ghcomment : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-ghmerge : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-npmpub : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4brange-verb-railup : an outward-facing CLI's verb or binary is glued to a brace RANGE ({X..Y}
r4dig-tool-easbld  : command-position 'eas build --auto-submit' submits the finished binary t
r4dig-tool-easupd  : command-position 'eas update/publish/submit' publishes an OTA update or
r4dig-tool-ghapi   : command-position 'gh api' with a method flag (-X/--method) whose value i
r4dig-tool-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
r4dig-tool-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
r4dig-tool-npmpub  : command-position 'npm publish' pushes a package to the registry.
r4dig-tool-railup  : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
r4dig-verb-easbld  : command-position 'eas build --auto-submit' submits the finished binary t
r4dig-verb-easupd  : command-position 'eas update/publish/submit' publishes an OTA update or
r4dig-verb-ghapi   : command-position 'gh api' with a method flag (-X/--method) whose value i
r4dig-verb-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
r4dig-verb-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
r4dig-verb-npmpub  : command-position 'npm publish' pushes a package to the registry.
r4dig-verb-railup  : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
r4spec-tool-easbld : command-position 'eas build --auto-submit' submits the finished binary t
r4spec-tool-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
r4spec-tool-ghapi  : command-position 'gh api' with a method flag (-X/--method) whose value i
r4spec-tool-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
r4spec-tool-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
r4spec-tool-npmpub : command-position 'npm publish' pushes a package to the registry.
r4spec-tool-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
r4spec-verb-easbld : command-position 'eas build --auto-submit' submits the finished binary t
r4spec-verb-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
r4spec-verb-ghapi  : command-position 'gh api' with a method flag (-X/--method) whose value i
r4spec-verb-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
r4spec-verb-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
r4spec-verb-npmpub : command-position 'npm publish' pushes a package to the registry.
r4spec-verb-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
sitebranch-create  : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitebranch-delete  : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitebranch-edit    : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitebranch-rename  : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitechannel-create : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitechannel-delete : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitechannel-edit   : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitechannel-rename : command-position 'eas channel:/branch: create/edit/delete/rename' repoin
sitedup-ghcomment  : more than one command-position 'gh pr create/comment' occurrence — amb
sitedup-ghcreate   : more than one command-position 'gh pr create/comment' occurrence — amb
siteeasverb-publish : command-position 'eas update/publish/submit' publishes an OTA update or
siteeasverb-submit : command-position 'eas update/publish/submit' publishes an OTA update or
siteeasverb-update : command-position 'eas update/publish/submit' publishes an OTA update or
siterailsvc-environment : command-position 'railway service/environment delete' deletes a live Rai
siterailsvc-service : command-position 'railway service/environment delete' deletes a live Rai
siterailvardelete  : command-position 'railway variable/vars/var set/delete' mutates a live s
siterailvarset-var : command-position 'railway variable/vars/var set/delete' mutates a live s
siterailvarset-variable : command-position 'railway variable/vars/var set/delete' mutates a live s
siterailvarset-variables : command-position 'railway variable/vars/var set/delete' mutates a live s
siterailvarset-vars : command-position 'railway variable/vars/var set/delete' mutates a live s
siterailverb-delete : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-deploy : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-down  : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-redeploy : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-remove : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-restart : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-rm    : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-run   : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siterailverb-up    : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
siteupd-delete     : command-position 'eas update:delete/edit/republish/revert-update-rollout
siteupd-edit       : command-position 'eas update:delete/edit/republish/revert-update-rollout
siteupd-republish  : command-position 'eas update:delete/edit/republish/revert-update-rollout
siteupd-revert-update-rollout : command-position 'eas update:delete/edit/republish/revert-update-rollout
siteupd-roll-back-to-embedded : command-position 'eas update:delete/edit/republish/revert-update-rollout
siteupd-rollback   : command-position 'eas update:delete/edit/republish/revert-update-rollout
sufx-easbld        : command-position 'eas build --auto-submit' submits the finished binary t
sufx-easupd        : command-position 'eas update/publish/submit' publishes an OTA update or
sufx-ghapi         : command-position 'gh api' with a mutating HTTP method (-X/--method POST/
sufx-ghcomment     : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
sufx-ghmerge       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
sufx-npmpub        : command-position 'npm publish' pushes a package to the registry.
sufx-railup        : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
syn-binary         : an outward-facing CLI is named in command position but the verb is not l
syn-cmdsub         : an outward-facing CLI is named in command position but the verb is not l
syn-default        : an outward-facing CLI is named in command position but the verb is not l
syn-indirect       : an outward-facing CLI is named in command position but the verb is not l
syn-nocolon        : an outward-facing CLI is named in command position but the verb is not l
toolvarithsep-easbld : command-position 'eas build --auto-submit' submits the finished binary t
toolvarithsep-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
toolvarithsep-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvarithsep-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvarithsep-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvarithsep-npmpub : command-position 'npm publish' pushes a package to the registry.
toolvarithsep-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvbareparen-easbld : command-position 'eas build --auto-submit' submits the finished binary t
toolvbareparen-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
toolvbareparen-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvbareparen-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvbareparen-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvbareparen-npmpub : command-position 'npm publish' pushes a package to the registry.
toolvbareparen-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvbt-easbld     : command-position 'eas build --auto-submit' submits the finished binary t
toolvbt-easupd     : command-position 'eas update/publish/submit' publishes an OTA update or
toolvbt-ghapi      : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvbt-ghcomment  : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvbt-ghmerge    : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvbt-npmpub     : command-position 'npm publish' pushes a package to the registry.
toolvbt-railup     : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvcasearm-easbld : command-position 'eas build --auto-submit' submits the finished binary t
toolvcasearm-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
toolvcasearm-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvcasearm-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvcasearm-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvcasearm-npmpub : command-position 'npm publish' pushes a package to the registry.
toolvcasearm-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvcomment-easbld : command-position 'eas build --auto-submit' submits the finished binary t
toolvcomment-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
toolvcomment-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvcomment-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvcomment-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvcomment-npmpub : command-position 'npm publish' pushes a package to the registry.
toolvcomment-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvdqclose-easbld : command-position 'eas build --auto-submit' submits the finished binary t
toolvdqclose-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
toolvdqclose-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvdqclose-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvdqclose-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvdqclose-npmpub : command-position 'npm publish' pushes a package to the registry.
toolvdqclose-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvmixq-easbld   : command-position 'eas build --auto-submit' submits the finished binary t
toolvmixq-easupd   : command-position 'eas update/publish/submit' publishes an OTA update or
toolvmixq-ghapi    : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvmixq-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvmixq-ghmerge  : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvmixq-npmpub   : command-position 'npm publish' pushes a package to the registry.
toolvmixq-railup   : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvnest-easbld   : command-position 'eas build --auto-submit' submits the finished binary t
toolvnest-easupd   : command-position 'eas update/publish/submit' publishes an OTA update or
toolvnest-ghapi    : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvnest-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvnest-ghmerge  : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvnest-npmpub   : command-position 'npm publish' pushes a package to the registry.
toolvnest-railup   : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvsqclose-easbld : command-position 'eas build --auto-submit' submits the finished binary t
toolvsqclose-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
toolvsqclose-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvsqclose-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvsqclose-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvsqclose-npmpub : command-position 'npm publish' pushes a package to the registry.
toolvsqclose-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvsub-easbld    : command-position 'eas build --auto-submit' submits the finished binary t
toolvsub-easupd    : command-position 'eas update/publish/submit' publishes an OTA update or
toolvsub-ghapi     : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvsub-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvsub-ghmerge   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvsub-npmpub    : command-position 'npm publish' pushes a package to the registry.
toolvsub-railup    : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
toolvvar-easbld    : command-position 'eas build --auto-submit' submits the finished binary t
toolvvar-easupd    : command-position 'eas update/publish/submit' publishes an OTA update or
toolvvar-ghapi     : command-position 'gh api' with a method flag (-X/--method) whose value i
toolvvar-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
toolvvar-ghmerge   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
toolvvar-npmpub    : command-position 'npm publish' pushes a package to the registry.
toolvvar-railup    : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
trailclose-ctl     : command-position 'eas update/publish/submit' publishes an OTA update or
trailclose-easupd  : command-position 'eas update/publish/submit' publishes an OTA update or
trailclose-ghmrg   : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
verbvarithsep-easbld : command-position 'eas build --auto-submit' submits the finished binary t
verbvarithsep-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
verbvarithsep-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
verbvarithsep-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
verbvarithsep-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
verbvarithsep-npmpub : command-position 'npm publish' pushes a package to the registry.
verbvarithsep-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
verbvbareparen-easbld : command-position 'eas build --auto-submit' submits the finished binary t
verbvbareparen-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
verbvbareparen-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
verbvbareparen-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
verbvbareparen-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
verbvbareparen-npmpub : command-position 'npm publish' pushes a package to the registry.
verbvbareparen-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
verbvcasearm-easbld : command-position 'eas build --auto-submit' submits the finished binary t
verbvcasearm-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
verbvcasearm-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
verbvcasearm-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
verbvcasearm-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
verbvcasearm-npmpub : command-position 'npm publish' pushes a package to the registry.
verbvcasearm-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
verbvcomment-easbld : command-position 'eas build --auto-submit' submits the finished binary t
verbvcomment-easupd : command-position 'eas update/publish/submit' publishes an OTA update or
verbvcomment-ghapi : command-position 'gh api' with a method flag (-X/--method) whose value i
verbvcomment-ghcomment : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
verbvcomment-ghmerge : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
verbvcomment-npmpub : command-position 'npm publish' pushes a package to the registry.
verbvcomment-railup : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
vft-amp            : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
vft-clob           : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
vft-vmask          : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
vsub-easbld        : command-position 'eas build --auto-submit' submits the finished binary t
vsub-easupd        : command-position 'eas update/publish/submit' publishes an OTA update or
vsub-ghapi         : command-position 'gh api' with a method flag (-X/--method) whose value i
vsub-ghcomment     : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
vsub-ghmerge       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
vsub-npmpub        : command-position 'npm publish' pushes a package to the registry.
vsub-railup        : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
vvar-easbld        : command-position 'eas build --auto-submit' submits the finished binary t
vvar-easupd        : command-position 'eas update/publish/submit' publishes an OTA update or
vvar-ghapi         : command-position 'gh api' with a method flag (-X/--method) whose value i
vvar-ghcomment     : 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repos
vvar-ghmerge       : command-position 'gh pr merge' without a REAL --auto flag merges a PR im
vvar-npmpub        : command-position 'npm publish' pushes a package to the registry.
vvar-railup        : command-position 'railway up/deploy/redeploy/restart/down/delete/remove/
PIN_ATTRIB_EOF
}
EXPECTED_DENY_ATTRIB=$(_pin_expected_attrib)

# LC_ALL=C on BOTH sides. Under a UTF-8 locale glibc's collation ignores `-`, so
# `flagadjfd-*` and `flagadjfp-*` interleave differently than they do under C --
# which would make this pin disagree between a darwin dev box and the ubuntu
# runner for reasons that have nothing to do with the guard.
# The rtrim is not cosmetic -- see the capture site's comment. The RUN's side is
# already clean; this is what protects the hand-editable PINNED side from a
# trailing space that no diff shows.
_pin_norm() { printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//' | LC_ALL=C sort; }

# ...and every `comm` below reads that ordering with the SAME collation. `comm` is
# a merge: it assumes its two inputs are sorted the way IT compares them, and GNU
# comm compares with the locale's collation unless told otherwise. Feeding it
# C-sorted input under a glibc UTF-8 locale -- where `-` is ignored in collation --
# lets the merge desync and report lines as unique-to-each side that are present in
# both. Forcing `LC_ALL=C` on the sort while leaving it off the comparison closes
# only half of the divergence this pin was already written to avoid. Not
# reproducible on darwin (BSD comm does not collate), which is exactly why it is
# forced rather than tested: the runner is the platform that would show it.

# ---- coverage: every deny the guard can EMIT must be reachable by a row -----
# Reads the GUARD'S SOURCE, not a run: zero extra invocations. The same
# extraction reason() applies to a live decision, applied to the literal strings
# instead -- verified equivalent, all 20 fingerprints the corpus reaches match a
# site found this way exactly, with no leftovers on either side.
#
# WHY this exists at all: see the DENY-SITE COVERAGE axis above. Without it the
# NEXT deny site added to the guard is silently uncovered again, and the only
# thing standing between that and a dead protection is whether someone remembers.
# A comment saying "add a row when you add a check" is not a guard; this is.
ACTUAL_EMIT_SITES=$(grep -oE '(deny "|permissionDecisionReason":")guard-outward-cli: .*' "$HOOK" \
  | LC_ALL=C sed -E 's/^[^g]*guard-outward-cli: //; s/ Bypass:.*//' \
  | LC_ALL=C cut -c1-72 | sed 's/[[:space:]]*$//' | LC_ALL=C sort -u)

# The 7 sites no command text can reach on the PRECISE path, and why each is
# (COUNT THE HEREDOC, do not trust this number: it read 5 for two commits after the two
# DEFINITION-INTEGRITY entries landed -- the root-position shape assertion and the
# GH_API_RE_SEPSAFE check -- because the paragraph below was extended and this line was not.
# Found in round-5 review by re-deriving it rather than reading it.)
# structurally unreachable rather than merely uncovered:
#   - jq unavailable / lib unsourceable / quote-aware rendering empty
#       fail-closed fallbacks reached only on the nojq, nolib and noawk paths.
#       The corpus DOES exercise all three -- 25 rows each, printed in the
#       precise-clean/degraded-dirty section -- just not through attribution,
#       which is precise-path only.
#   - .tool_name / .tool_input.command unreadable
#       malformed-envelope handling. `envelope()` emits well-formed JSON by
#       construction, so no ROW can reach these; test-guard-outward-cli.sh owns
#       them.
# Adding to this list is how you disable a coverage requirement, so it is a
# deliberate, dated, reviewable edit like any other pin -- never the way to make
# a red gate green.
_pin_exempt_sites() { cat <<'PIN_EXEMPT_EOF'
jq unavailable - failing closed for a command that looks like an outward
lib/cmd-detect.sh is unsourceable (broken install) - failing closed via
the hook envelope's .tool_input.command could not be read (malformed JSO
the hook envelope's .tool_name could not be read (malformed JSON or a ch
the quote-aware rendering came back empty for a non-empty command - eith
the root-position flag grammar lost its shape — _OUT_GH_GLOBALS is mis
GH_API_RE_SEPSAFE is no longer built from BOTH _OUT_GH_GLOBALS_SEPSAFE a
PIN_EXEMPT_EOF
}
# 28 as of 2026-09-15, and BOTH SIDES OF THE MERGE THAT PRODUCED IT SAID 27 -- which is
# why this needs a paragraph. Base 4c8d780c had 26 sites and 6 exempt entries. main added
# one site (26 -> 27, 6 exempt). The root-position-flag-PROPERTY branch added a DIFFERENT
# one, the GH_API_RE_SEPSAFE integrity check below, together with its exempt entry
# (26 -> 27, 7 exempt). Both wrote the literal `27`, so git had nothing to reconcile and
# kept it; the merged tree holds both new sites and measures 28. The exempt-entry count is
# the tell that the two 27s were never the same number -- 6 on one side, 7 on the other.
# MEASURED, NOT COMPUTED: the run on the resolved tree reported
# `FAIL: guard deny-emit sites is 28, expected 27`. 26 + 1 + 1 = 28 is a check on that,
# not a substitute. See
# docs/solutions/code-quality/a-clean-merge-leaves-a-stale-count-pin-2026-09-14.md.
#
# THE GH_API_RE_SEPSAFE INTEGRITY CHECK, retained from the branch that added it because the
# check is in this tree: like the shape assertion beside it, NO COMMAND TEXT CAN REACH IT --
# it fires only on a definition that has been edited so the count-only needle stops reading
# the separator-safe grammar. It is therefore exempt from _pin_sites rather than given a row.
# Its coverage is two mutation rows in test-guard-outward-cli.sh -- search
# `GH_API_RE_SEPSAFE is no longer built from BOTH` -- one reverting BOTH constants, then one
# per `case` arm. The per-arm rows matter: the both-at-once row denies under either
# single-arm weakening, so on its own it pins neither.
#
# THAT SENTENCE WAS FALSE WHEN FIRST WRITTEN, which is the reason it now names the rows. It
# claimed the coverage existed; it did not, and it could not have: the mutation helper at the
# time hard-coded the SHAPE assertion's reason string, so no row pointed at this check could
# have passed. Exempting a site from the axis that exists to prove every deny is reachable,
# on a claim of coverage elsewhere, leaves the site covered NOWHERE -- and a justification
# naming coverage that does not exist is worse than none, because it stops the next reader
# looking. Verify the rows exist before trusting this paragraph.
EXPECTED_EMIT_SITES=28

PIN_FAIL=0

_pin_count() {  # $1=label $2=expected $3=actual
  [ "$3" = "$2" ] && return 0
  echo "FAIL: $1 is $3, expected $2 -- the guard's behaviour moved, or the pin was not updated with it"
  PIN_FAIL=1
}

_pin_members() {  # $1=label $2=expected-list $3=actual-list
  local added removed
  added=$(LC_ALL=C comm -13 <(_pin_norm "$2") <(_pin_norm "$3"))
  removed=$(LC_ALL=C comm -23 <(_pin_norm "$2") <(_pin_norm "$3"))
  [ -z "$added" ] && [ -z "$removed" ] && return 0
  echo "FAIL: $1 MEMBERSHIP drifted from the pin -- a total can hold while rows swap, and this is the check that sees it"
  [ -n "$removed" ] && { echo "  in the pin, NOT produced by this run (closed, or the row was renamed/removed):"; sed 's/^/    -/' <<< "$removed"; }
  [ -n "$added" ]   && { echo "  produced by this run, NOT in the pin (OPENED, or newly degraded):"; sed 's/^/    +/' <<< "$added"; }
  PIN_FAIL=1
}

# The precise manifest is bare IDs while the all-path one carries tuples, and that
# asymmetry is only safe while every precise gap is ALSO all-path dirty -- that is
# what makes a precise row's direction recoverable from the all-path `p=` field.
# The relation is an INVARIANT of the two collection branches above (a row failing
# on precise necessarily fails the any-path test), not a coincidence, but a later
# edit narrowing the ALLGAPS condition would break it and the precise manifest
# would silently lose its direction information. So assert it rather than leave a
# reviewer to remember why bare IDs were safe -- the same reason the rest of this
# block exists.
#
# IT IS ALSO THE ONLY CHECK HERE THAT A CARELESS BUMP CANNOT SILENCE, and that is
# the stronger reason to keep it. Measured by a reviewer 2026-09-07: narrow the
# ALLGAPS condition, then "re-pin to whatever it emits now" (drop the totals to
# match, delete the orphaned tuples from the expected manifest). `_pin_count` and
# `_pin_members` both go GREEN -- actual now equals the freshly-pinned expected --
# and `_pin_subset` STAYS RED, because it compares the run against ITSELF rather
# than against the pin. Every other check in this block verifies conformance to a
# number a human can edit; this one verifies an internal invariant no bump can
# restate. That is precisely the failure mode HOW TO BUMP is written to prevent.
# Three checks below verify the run against ITSELF rather than against a pinned
# number, which is the only kind a "re-pin to whatever it emits now" bump cannot
# silence. `_pin_subset` was the first; the review that added the attribution pin
# asked for the same treatment of the two properties that pin quietly assumes.
_pin_denominator() {  # $1=label $2=expected-count $3=actual-count $4=how-derived
  [ "$3" = "$2" ] && return 0
  echo "FAIL: $1 -- the run says $2, but $3 $4. These two are the SAME quantity computed two ways;"
  echo "  they cannot be reconciled by editing a pin, because neither side is a pin."
  PIN_FAIL=1
}

_pin_distinct() {  # $1=fingerprints  $2=full reasons
  local nf nr
  nf=$(_pin_norm "$1" | LC_ALL=C sort -u | grep -c .)
  nr=$(_pin_norm "$2" | LC_ALL=C sort -u | grep -c .)
  [ "$nf" = "$nr" ] && return 0
  echo "FAIL: two DIFFERENT deny checks now share a 72-byte fingerprint -- $nr distinct reasons collapse to $nf."
  echo "  The attribution pin cannot tell those checks apart, so a reroute BETWEEN them is invisible to it."
  echo "  Colliding pairs:"
  _pin_norm "$1" | LC_ALL=C sort | uniq -d | sed 's/^/    /'
  echo "  Widen the cut in _fp and re-pin, or reword one of the messages so they diverge inside 72 bytes."
  PIN_FAIL=1
}

_pin_sites() {  # $1=all emit sites  $2=fingerprints the run attributed  $3=exempt
  local uncovered
  uncovered=$(LC_ALL=C comm -23 <(_pin_norm "$1") \
                <(LC_ALL=C sort -u <(_pin_norm "$2") <(_pin_norm "$3")))
  [ -z "$uncovered" ] && return 0
  echo "FAIL: the guard can emit a deny NO corpus row reaches, so deleting that check is invisible to every check in this pin:"
  sed 's/^/    /' <<< "$uncovered"
  echo "  Add a row that reaches it (see the DENY-SITE COVERAGE axis), or, if no command text CAN reach it,"
  echo "  add it to _pin_exempt_sites with the reason written down. Do not just re-pin the count."
  PIN_FAIL=1
}

_pin_subset() {  # $1=precise ids  $2=all-path tuples (`id p=.. j=.. l=.. a=..`)
  local ids2 orphans
  ids2=$(printf '%s\n' "$2" | sed 's/ .*//')
  orphans=$(LC_ALL=C comm -23 <(_pin_norm "$1") <(_pin_norm "$ids2"))
  [ -z "$orphans" ] && return 0
  echo "FAIL: precise-path gaps are no longer a subset of all-path dirty -- these IDs are pinned as precise gaps but absent from the all-path manifest, so their direction is no longer recoverable:"
  sed 's/^/    /' <<< "$orphans"
  PIN_FAIL=1
}

# bash 3.2 (the macOS system bash this file runs under locally) errors on
# "${arr[@]}" for an EMPTY array under `set -u`, while bash 5 on the runner does
# not. Guarded so that a future tree with zero gaps fails the pin honestly
# instead of crashing on one platform only.
if [ "${#PRECISE_GAP_IDS[@]}" -gt 0 ]; then
  ACTUAL_PRECISE_GAP_IDS=$(printf '%s\n' "${PRECISE_GAP_IDS[@]}")
else
  ACTUAL_PRECISE_GAP_IDS=""
fi
if [ "${#ALLPATH_DIRTY_IDS[@]}" -gt 0 ]; then
  ACTUAL_ALLPATH_DIRTY_IDS=$(printf '%s\n' "${ALLPATH_DIRTY_IDS[@]}")
else
  ACTUAL_ALLPATH_DIRTY_IDS=""
fi
if [ "${#DENY_ATTRIB[@]}" -gt 0 ]; then
  ACTUAL_DENY_ATTRIB=$(printf '%s\n' "${DENY_ATTRIB[@]}")
  ACTUAL_DENY_FP=$(printf '%s\n' "${DENY_FP[@]}")
  ACTUAL_DENY_FULL=$(printf '%s\n' "${DENY_FULL[@]}")
else
  ACTUAL_DENY_ATTRIB=""; ACTUAL_DENY_FP=""; ACTUAL_DENY_FULL=""
fi
# How many rows the TABLE says deny on the precise path -- derived from PS[@],
# which is appended unconditionally, not from the attribution branch. See
# _pin_denominator.
PRECISE_DENY_COUNT=$(printf '%s\n' "${PS[@]}" | grep -c '^DENY$')

echo ""
echo "=== pin ==="
_pin_count "rows"              "$EXPECTED_ROWS"         "${#ROWS[@]}"
_pin_count "precise-path gaps" "$EXPECTED_PRECISE_GAPS" "$GAPS"
_pin_count "all-path gaps"     "$EXPECTED_ALLPATH_GAPS" "$ALLGAPS"
_pin_members "precise-path gap" "$EXPECTED_PRECISE_GAP_IDS"   "$ACTUAL_PRECISE_GAP_IDS"
_pin_members "all-path dirty"   "$EXPECTED_ALLPATH_DIRTY_IDS" "$ACTUAL_ALLPATH_DIRTY_IDS"
_pin_count   "deny-reason attribution rows" "$EXPECTED_DENY_ATTRIB_ROWS" "${#DENY_ATTRIB[@]}"
_pin_members "deny-reason attribution" "$EXPECTED_DENY_ATTRIB" "$ACTUAL_DENY_ATTRIB"
_pin_count   "guard deny-emit sites" "$EXPECTED_EMIT_SITES" "$(grep -c . <<< "$ACTUAL_EMIT_SITES")"
_pin_subset "$ACTUAL_PRECISE_GAP_IDS" "$ACTUAL_ALLPATH_DIRTY_IDS"
_pin_denominator "attributed rows vs DENY verdicts" "$PRECISE_DENY_COUNT" "${#DENY_ATTRIB[@]}" \
  "rows were attributed"
_pin_distinct "$ACTUAL_DENY_FP" "$ACTUAL_DENY_FULL"
_pin_sites "$ACTUAL_EMIT_SITES" "$ACTUAL_DENY_FP" "$(_pin_exempt_sites)"

if [ "$PIN_FAIL" -ne 0 ]; then
  echo ""
  echo "The corpus drifted from its pin. Read the per-ID lists above, not just the totals:"
  echo "  a '+' line is a bypass that OPENED or a path that newly degraded -- treat it as a regression until attributed;"
  echo "  a '-' line is one that CLOSED -- welcome, but it still has to be named in the bump commit;"
  echo "  the SAME id in BOTH lists is NEITHER: it is ONE row whose per-path verdicts moved. Diff the"
  echo "  changed field (p=/j=/l=/a=). Nothing closed -- 'one closed, one opened' is the comfortable"
  echo "  misreading, and this is the exact class the per-path tuples were added to catch."
  echo "  On the ATTRIBUTION list specifically, the same id in both lists means the row still denies"
  echo "  and now denies from a DIFFERENT check. Its verdict did not move, so nothing else here can"
  echo "  see it -- decide whether the new check is the one that should be protecting that row before"
  echo "  bumping, because a verdict-preserving reroute is exactly what this list exists to surface."
  exit 1
fi

echo "✓ pin: rows=$EXPECTED_ROWS  precise-path gaps=$EXPECTED_PRECISE_GAPS  all-path gaps=$EXPECTED_ALLPATH_GAPS; precise manifest exact; all-path manifest exact INCLUDING per-path verdicts; precise-subset-of-all-path holds; all $EXPECTED_DENY_ATTRIB_ROWS deny reasons attributed to the same checks as the pin"
exit 0

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
# CITATION HYGIENE, mechanical. A path broken across a comment wrap is invisible to
# `grep -F` for the whole path, which has produced a confident false "0 remaining" in
# this repo six times. The sweep that finds the class, and the one to run before
# claiming a path sweep is complete:
#     awk '/todos\/|docs\// && !/\.md/ {print FILENAME":"NR}' <file>
# Every line citing a todos/ or docs/ path must carry the `.md` on that SAME line.
# Run it, not a full-path grep.
# IT OVER-MATCHES, AND THE RESIDUE IS NOT ZERO (recorded 2026-09-15). The sweep keys
# on the two bare path-prefix strings in the pattern above, so it also flags lines
# that are not citations at all and can never carry a `.md`. Across the files this
# change touches there are exactly two, both deliberate and neither to be "fixed":
#   lib/cmd-detect.sh           a bare DIRECTORY mention (the legacy-patterns dir)
#   test-guard-outward-cli.sh   a TEST FIXTURE whose payload is a `grep -rn` command
#                               string ending in a bare directory argument
# So "the sweep returns empty" is the WRONG success condition. It was written that way
# once in this change's own history, before all five touched files had been checked,
# and it is unreachable while those two lines exist. The checkable claim is: every
# sweep hit is either a wrapped citation to repair, or one of the two above.
# ENUMERATE AND CLASSIFY the hits; do not count them.
# THIS PARAGRAPH IS WHY IT IS WORDED WITHOUT SPELLING THE PREFIXES. The first draft
# named both literally and so added three more hits to the very residue it was
# describing -- prose about a text sweep tends to contain what the sweep matches, and
# a note that inflates its own count is worse than no note. Same reason the reviewer
# dispatch prompt refuses to spell the severity words it warns about.
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
# SUPERSEDED 2026-09-07 by the interior-redirect absorber (_OUT_SEP) and, in the
# same PR, the FLAG-ADJACENT fixes. SUPERSEDED AGAIN 2026-09-10 by PR #939 (the
# clobber-override axis). The CURRENT correct output is
# `rows=462  precise-path gaps=31  all-path gaps=165`.
#
# *** THE 165 HERE AND THE 167 FORTY LINES BELOW ARE DIFFERENT QUANTITIES. ***
# The one below is a HAND COUNT of an all-path union made during PR #931 over a
# 427-row corpus; this one is what ALLGAPS prints on the current corpus. Their
# history is the whole point: 164 vs 167 when that paragraph was written, then
# 167 vs 167 for one release window, and now 165 vs 167 again -- PR #939 widened
# the crude `--repo` mirror to match the precise path, which closed
# flagadjfd-ghcomment and flagadjfd-ghcreate.
#
# THE COINCIDENCE WAS THE ACCIDENT, NOT THE SEPARATION. Anyone who had "tidied"
# the mismatch during the window when both read 167 would have welded together
# two quantities that have since moved apart again. Do not reconcile them, do
# not read either as a check on the other.
#
# THE BASELINE IS `origin/main` AT a9d77417 (PR #930). Naming it matters: the only
# commit NOTE6 used to name in this area was b01fcff2, the PREVIOUS change's
# baseline, so a reader re-deriving these numbers would have diffed the wrong tree.
# Method: ONE corpus script, two guards -- main's guard with the CURRENT corpus,
# so both sides see the same 427 rows.
#
# Attributed BY ID (`comm` of the two dirty sets), never by subtracting totals:
#
#   precise-path dirty  102 -> 31   71 CLOSED, **0 OPENED**
#   all-path dirty      194 -> 164  30 CLOSED, **0 newly dirty**
#
# The 71 decomposes exactly, and the decomposition is the check that no row moved
# for an unexplained reason:
#
#     51  intrtool-*/intrns-*   (33 tool slot + 18 namespace slot)
#     12  flagadj*-*            (6 fd + 4 sp + 2 glue -- see below)
#      6  decoytoolplain-*/decoynsplain-*
#      2  nssufx-*  (pre-existing)
#     --
#     71  denominator 102
#
# ONLY 12 OF THE 18 flagadj ROWS WERE GAPS ON MAIN, and that is reported rather
# than rounded up: the other 6 family x spelling combinations already denied on
# main, so the axis contains 18 rows of which 12 were live bypasses. Reporting
# "18 closed" would have been the easy sentence and a false one.
#
# *** SUPERSEDED 2026-09-07 -- MARKER ADDED. THE PARAGRAPH BELOW CONTAINS TWO
# STATEMENTS THAT ARE FALSE ABOUT THE CODE. It is left in place and unrewritten on
# purpose: the 164 it describes is CORRECT and is what the pin asserts.
#
# AND THE 167 IS NOT RECOVERABLE, which is why this is a marker and not a
# rewrite. That figure is a HAND COUNT over a two-tree before/after comparison
# made during PR #931; it is not a number this file emits, on this tree or any
# other, so there is nothing to re-derive and nothing to check it against. The
# honest resolution is to say so rather than invent a second explanation that
# reads better -- inventing one is how the paragraph below got written. Tracked
# and closed at
# todos/archive/P3-2026-09-07-corpus-note6-allgaps-explanation-is-wrong.md.
#   (a) "THE FOUR ALLOW-EXPECTING CONTROL ROWS" -- measured, there are 25 of 40.
#       The four named are a subset. Full enumeration is in the
#       EXPECTED_ALLPATH_GAPS pin comment above.
#   (b) "the printed metric ... does not count an ALLOW-expecting row that a
#       degraded path denies" -- it DOES. ALLGAPS increments on ANY path mismatch,
#       and all 25 are in the shipped all-path manifest.
# You are most likely reading this while attributing a manifest movement involving
# one of those 25. Do not attribute it using the paragraph below. ***
#
# THE FOUR ALLOW-EXPECTING CONTROL ROWS (decoyfp-auto, flagadjfp-andand,
# flagadjfp-roredir, flagadjfp-semi) ARE PRECISE-CLEAN AND DEGRADED-DIRTY ON BOTH
# TREES. That is the varithsep-* precedent -- a disclosure, not a regression: the
# degraded mirror over-denies them and does so identically before and after, so
# no row got strictly worse. It is also why this block's all-path union counted by
# hand (167) differs by 3 from the file's own printed `all-path gaps` (164): the
# printed metric counts GAPS (want DENY, got ALLOW) and does not count an
# ALLOW-expecting row that a degraded path denies. Both numbers are right for
# their own definition; the one that carries the safety claim is **0 newly dirty**,
# which is a set difference and independent of either denominator.
#
# ALL-PATH MOVED LESS THAN PRECISE, AND THAT IS THE DISCLOSURE, NOT A MISS: the
# degraded mirror (crude_smells_outward) was deliberately NOT widened, so its
# [^a-zA-Z]+ separator still absorbs a letter-FREE redirect (2>&1) and still
# misses a letter-bearing one (>/dev/null). Widening it is not a one-line change
# deferred out of laziness -- that function runs on the no-jq and no-lib paths,
# which reach it BEFORE/WITHOUT the lib source, so interpolating $_CMD_REDIR
# there would reference an UNSET variable under the guard's `set -uo pipefail`.
# CORRECTED 2026-09-07, by measurement: that is a hard error, NOT the "empty
# string, no error, suite green, separator silently reduced to nothing" this
# block used to claim. Moving a $_CMD_REDIR reference above the lib source and
# changing nothing else yields `_CMD_REDIR: unbound variable`, empty stdout, and
# 53 passed / 495 failed. The reason to leave crude_smells_outward alone is
# unchanged -- the reference is simply unavailable there -- but the failure mode
# is loud, and the old wording implied the constraint was untestable when in fact
# almost every assertion catches it. Recorded in the guard's DOCUMENTED RESIDUALS.
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
# SUPERSEDED 2026-09-07 -- MARKER ADDED because this block reads as current and is
# not. Every figure below describes the tree at b01fcff2 (the PREVIOUS change's
# baseline, not this one's) and is two changes stale: `33` became 31 with the
# interior absorber and the corpus is now 448 rows against `origin/main` at
# a9d77417. See the 2026-09-07 block above for the live numbers. Kept, not
# rewritten, for its arithmetic lesson -- but it sat in the PRESENT TENSE between
# two blocks that contradict it, forty lines from a line that already reconciles
# `33 -> 31`, which is exactly how a superseded number gets quoted forward.
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
# strictly worse
# (docs/solutions/code-quality/summary-count-cannot-express-a-row-getting-strictly-worse-2026-09-06.md),
# and an earlier revision of this note was
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
#       from the "no REAL --auto" rule -- because a literal `$`, or an UNQUOTED
#       `(`, anywhere in the merge CLAUSE masks --auto (guard-outward-cli.sh's ATTRIBUTION RESIDUAL note), NOT because
#       the construct breaks the `--auto` spelling, which stays byte-intact
#       (the splice target is --admin). A BACKTICK does not mask: those spans are
#       gone from CLAUSE before the check runs, so a backtick spelling reaches
#       the --admin check and reports the --admin reason. It reports `ok` on both
#       sides and so is not a closure. A verdict is not evidence the intended
#       check fired.
#    1  c2-ansic-hex, as a SIDE EFFECT of the ANSI-C decoding rather than by a
#       change aimed at it: the vanished rendering now reduces
#       `-X $'\x50\x4f\x53\x54'` to a literal `-X POST`, which the
#       mutating-method branch matches. Its own entry below is updated.
#       Confirmed by ID in the before/after diff, not predicted in advance.
#
# FULL ATTRIBUTION of the remaining precise-path gaps. Was 14 + 17 + 2 = 33;
# the `2` bucket closed on 2026-09-07, so it became 14 + 17 = 31. The `14`
# bucket itself halved on 2026-09-14 (r4brange-verb-* closed, see below), so
# it is now 7 + 17 = 24. Each remaining row has an OPEN todo — none is a
# defect this change introduced, and every one allows on `main` too:
#
#    7  (was 14) r4brange-tool-*. A brace RANGE carries no `$` and no backtick
#       anywhere, so no sigil-keyed decline can see it and no deleting
#       rendering can reach it. Needs a narrow guard-side deny — CLOSED
#       2026-09-14 for the sibling r4brange-verb-* (see below), still open here
#       because closing it would additionally need the fast-path prefilter's
#       stage-3 decline widened to a brace-range shape, which this todo's Scope
#       Contract explicitly forbids ("no widening of the fast path's sigil
#       class"). Tracked at
#       todos/archive/P2-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md
#
#   17  toolvcasearm-* (7), verbvcasearm-* (7), flagvcasearm-* (3 of 4) — CLOSED
#       ON THE PRECISE PATH 2026-09-13, so this bucket is HISTORY, not a current
#       gap. toolvcasearm-* still allow on the three DEGRADED paths; the verb and
#       flag rows deny on all four. A `case`
#       arm's `)` has NO matching opener, so the paren counter that closed the
#       bare-paren rows cannot reach it, and the obvious `case`/`esac` keyword
#       tracker is a deny->ALLOW regression generator (`e$(echo case)as update`
#       DENIES today and would render EMPTY under it). Deliberately deferred with
#       its reasoning, not overlooked. Tracked at
#       todos/archive/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
#
#       flagvcasearm-ghadmin is the FOURTH flag row and reports `ok` — READ ITS
#       ATTRIBUTION, NOT ITS VERDICT. It denies from a different check entirely:
#       a literal `$`, or an UNQUOTED `(`, anywhere in the merge CLAUSE masks --auto
#       (guard-outward-cli.sh's ATTRIBUTION RESIDUAL note), so the "no REAL --auto" rule fires --
#       a BACKTICK does not, since those spans are already gone from CLAUSE and
#       that spelling reaches the --admin check instead. The
#       construct does NOT break the `--auto` spelling -- it is spliced into
#       --admin and --auto stays byte-intact. Same rule as co-mask-c1.
#
#    0  (was 2) nssufx-ghmerge and nssufx-ghcomment — an INTERIOR redirect, a
#       different mechanism with its own entry below and its own todo. CLOSED
#       2026-09-07 by `_OUT_SEP`, together with the 51 generated intrtool-*/
#       intrns-* rows added in the same change. The bucket is kept at zero rather
#       than deleted: the entry below records what the two rows could NOT see.
#
# SUPERSEDED 2026-09-13 -- MARKER ADDED (cmd-detect-case-arm todo). The "17"
# bucket immediately above ("toolvcasearm-* (7), verbvcasearm-* (7),
# flagvcasearm-* (3 of 4) ... Deliberately deferred") is CLOSED on the precise
# path, so `14 + 17 = 31` became `14` AT THAT MOMENT. Deliberately past tense:
# the live total is 31 again via a DIFFERENT 17 (the vcasecomment rows), so a
# present-tense "is now 14" here would contradict both EXPECTED_PRECISE_GAPS and
# the composition note this file keeps in one place. Kept in place rather than rewritten,
# per this note's own convention -- the reasoning it records (why a naive
# case/esac tracker is a deny->ALLOW regression generator) is exactly what the
# fix had to satisfy, not a stale claim.
#
# Attributed BY ID (`comm` of the two precise-gap-membership sets), not by
# subtracting totals:
#
#   precise-path gaps  31 -> 14   17 CLOSED, **0 OPENED**
#
# The 17, by family (all now `ok` on the precise path, attributed to their OWN
# family's check -- see EXPECTED_DENY_ATTRIB, not a fallback ambiguity deny):
#   7  toolvcasearm-*   -- `command-position '<verb>' ...` for each of the 7
#                          gated families (the TOOL-position spelling).
#   7  verbvcasearm-*   -- same 7 checks, VERB-position spelling.
#   3  flagvcasearm-easbld/ghapi/ghcomment -- FLAG-position spelling.
# flagvcasearm-ghadmin (the fourth flag row) is UNCHANGED -- it already
# reported `ok` before this fix, from a DIFFERENT check (a literal `$`, or an
# UNQUOTED `(`, anywhere in the merge CLAUSE masks --auto, so the "no REAL --auto" rule fires;
# a backtick does NOT and reaches the --admin check instead -- see the note four
# screens above this one). Nothing about ITS
# attribution moved.
#
# ALL-PATH GAPS moved LESS than precise-path, and that is the disclosure, not
# a miss: the fix is lib/cmd-detect.sh only, so none of the three degraded
# paths (which never source the lib) changed at all.
#
#   all-path dirty  243 -> 233 (10 CLOSED, 0 newly dirty -- read the SHAPE,
#                               not just the total; a count alone would hide
#                               that 7 rows changed shape without closing)
#     -17  removed (their OLD, now-stale tuple): flagvcasearm-easbld/ghapi/
#          ghcomment (3) and verbvcasearm-* (7) go COMPLETELY clean -- their
#          degraded paths already denied, only precise was wrong, and p=DENY
#          now matches on all four.
#     +7   re-added, SAME id, NEW tuple: toolvcasearm-* (7) were ALLOW on all
#          four before and stay dirty after (p flips ALLOW -> DENY; j/l/a stay
#          ALLOW, unreachable from a lib-only fix) -- these are the "0 newly
#          dirty" the count above asserts: no row went from clean to dirty,
#          one field of an already-dirty row's tuple changed.
#   -17 + 7 = net -10 = 243 -> 233. See EXPECTED_ALLPATH_DIRTY_IDS.
#
# WHY THE FIX CANNOT BE READ AS "CLOSING case-arm": it recognises `case`/
# `esac` ONLY at a genuine command-word start (never an argument, a quote, or
# mid-word), and ONLY in the counting pass (cmd_words_vanished), never the
# blind one (cmd_words_vanished_blind) -- an unterminated `case` would
# otherwise collapse BOTH unioned renderings at once, the exact regression
# class this file's own `vcomment`/`varithsep` entries above already document
# for a different pair of mechanisms. `e$(echo case)as update --branch
# preview` is pinned as a named two-sided regression control in
# test-cmd-detect.sh precisely so a future "simplify this" pass cannot
# reintroduce the unconditional tracker this note already ruled out.
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
#                             are now closed; r4brange-tool-* (7) remains —
#                             still open 2026-09-14, see FULL ATTRIBUTION above.
#   r4spec/r4dig/r4ansic-verb-*
#                  (21 rows)  precise ALLOW, all three degraded DENY — the
#                             precise path was the WEAK one, so "degraded fails
#                             closed" is not a safe default. All 21 now closed.
#   r4brange-verb-*  (7 rows) ALLOW on all four — the ONLY verb-position
#                             mechanism that also defeats the degraded paths,
#                             because that mirror keys on `$`/backtick and a
#                             brace range contains neither. CLOSED 2026-09-14:
#                             guard-outward-cli.sh grew a brace-range narrow
#                             deny in the same location as the existing
#                             expansion-token narrow deny (the binary name
#                             stays intact in raw text for every row in this
#                             bucket, so the fast-path prefilter never declines
#                             them, unlike r4brange-tool-* above), AND
#                             crude_smells_outward's trailing sigil class grew
#                             a brace-range alternative alongside its existing
#                             `$`/backtick one. All 7 rows now report `ok` on
#                             all four paths — verified by re-running this
#                             corpus, not asserted.
#
#                             CORRECTED, SAME DAY (code-reviewer CRITICAL
#                             finding on this todo's own review round): the
#                             sentence above was true of what this corpus
#                             tested at the time it was written, and that was
#                             NOT enough — the fix's first shipped version had
#                             a real, reachable bypass this corpus's 7 bare
#                             rows structurally could not see: the exclusion
#                             added to stop the new check stealing an existing
#                             check's deny REASON (`gh pr merge{1..3}` etc.
#                             already denying correctly) was a bare,
#                             position-unanchored substring search over the
#                             WHOLE command, so a decoy occurrence of
#                             `merge{1..3}`/`create{1..3}`/`comment{1..3}`/
#                             `api{1..3}` ANYWHERE — even inside an unrelated
#                             `echo` argument — cancelled the entire block and
#                             silently ALLOWED a genuine glued construction
#                             elsewhere in the same command. Confirmed live:
#                             `eas up{d..d}ate --branch preview && echo
#                             merge{1..3}` ALLOWED where the bare construction
#                             alone correctly denied. Fixed by anchoring the
#                             exclusion to command position
#                             (`_OUT_BR_RANGE_ALREADY_HANDLED` now requires
#                             `_OUT_POS_PREFIX`+`gh`, not a bare substring),
#                             and the gap this corpus had against THAT decoy
#                             shape is now closed: see the `r4brange-verb-
#                             decoy-*` axis (56 rows, generated from
#                             {7 families} x {4 decoy shapes} x
#                             {before,after} positions, all EXPECT=DENY, all
#                             `ok`) added the same round.
#
#                             CORRECTED AGAIN, SAME DAY (code-reviewer ROUND
#                             2, same review, same instruction to try a
#                             "genuine" not just an "inert" decoy): the
#                             paragraph above made the IDENTICAL overclaiming
#                             mistake it exists to correct, one level down.
#                             "the gap this corpus had is now closed" was
#                             true only against an INERT-PROSE decoy (a decoy
#                             that itself does nothing, like `echo
#                             merge{1..3}`). The command-position anchor did
#                             NOT close a GENUINE decoy: a real,
#                             independently-ALLOWED gh construction sharing
#                             the excluded shape (bare `gh api{1..3}` with no
#                             mutating flag; bare `gh pr create{1..3}`/`gh pr
#                             comment{1..3}` with no `--repo`) elsewhere in
#                             the command still silenced an unrelated
#                             dangerous glued construction, because the
#                             exclusion was still ONE whole-command existence
#                             check independent of which occurrence tripped
#                             which arm. Confirmed live:
#                             `eas up{d..d}ate --branch preview && gh
#                             api{1..3}` fully ALLOWED (a real OTA publish).
#                             Fixed by making the exclusion per-OCCURRENCE
#                             (`grep -oE` extraction, testing each matched
#                             trigger occurrence against the exclusion
#                             independently, denying if any one is not
#                             covered) instead of a second whole-command
#                             check. The gap against THIS shape is now closed
#                             too: see the `r4brange-verb-genuine-*` axis (42
#                             rows, {7 families} x {3 genuine-benign gh
#                             shapes} x {before,after}, all EXPECT=DENY, all
#                             `ok`) added the same round.
#
#                             The lesson, twice now in the same paragraph:
#                             "verified by re-running this corpus" is only as
#                             strong as what the corpus was capable of
#                             constructing, and a correction that narrows an
#                             overclaim to a SPECIFIC counter-example (here:
#                             "closed against a decoy" narrowed from "closed")
#                             can still overclaim if the counter-example
#                             itself had an unexamined dimension (inert vs.
#                             genuine). Neither correction lied about what it
#                             tested; both stated a broader conclusion than
#                             the construction space behind it supported. The
#                             fix that finally held is the SHAPE of fix this
#                             file's own Prevention sections keep landing on:
#                             per-occurrence, not per-command — the same
#                             discipline already required for `gh pr merge`/
#                             `gh api` occurrence counting, now applied to a
#                             boolean exclusion instead of a count.
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
#     todos/archive/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md
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
