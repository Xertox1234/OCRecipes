#!/usr/bin/env bash
# Compare a guard's or keyword file's verdicts at the base commit and at the branch head, over a
# generated set, and list every verdict that changed (harness diagnosis N7).
#
# usage: bash scripts/harness/verdict-diff.sh [--base <ref>] [--head <ref>]
#   --base  default: merge-base of origin/main and the head
#   --head  default: HEAD
#
# What it compares: every registry row (verdict-diff/targets.tsv) whose path changed in base..head.
#   guard     .claude/hooks/<target>.sh, judged at both commits over seeds/<target>.tsv × variations
#             (spacing, wrappers, prefixes, a failed leading cd, quoting, brace-spelled options, a moved
#             option, interpreter redefinition). The variation kinds come from the fix chains
#             1552→1554, 1476→1479 and 1545→1548; a kind not listed here is not covered.
#   keywords  shared/constants/{diet-conflicts,allergens}.ts, judged at both commits over each
#             module's own keywords × food modifiers × position.
# Two lists: CHANGED (base and head disagree: a regression or an intended change, the reviewer
# decides which) and, for a rule that is new on the branch, GAPS (rows that should trigger and do
# not). A brand-new keyword or guard has no base verdict to change, so only the gap list can show it.
#
# Controls, both required for a stamp: every must-trigger seed (guards) or bare keyword (keywords)
# triggers at head through the same evaluation path (positive), and a re-run of a sample of head rows
# gives the same verdicts (negative). Rows evaluated must equal rows generated.
# On success writes <stamp dir>/<head sha> and <head sha>.txt (the report); the PR gate
# (.claude/hooks/pr-preflight-guard.sh) refuses a PR touching a registry path without the stamp.
# Exit 0 stamped, 1 a control or a count failed (no stamp), 2 bad usage or git failure.
# Seeds and the registry are read from this script's tree, so a run against old commits uses
# today's seeds. Nothing a seed names is executed: commands reach the hooks as JSON strings.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VD="$HERE/verdict-diff"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "verdict-diff: not in a git repo" >&2; exit 2; }
cd "$ROOT" || exit 2
. "$ROOT/scripts/lib/verdict-diff-stamp-path.sh"

BASE_REF="" HEAD_REF="HEAD"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE_REF="${2:-}"; shift 2 ;;
    --head) HEAD_REF="${2:-}"; shift 2 ;;
    *) echo "usage: bash scripts/harness/verdict-diff.sh [--base <ref>] [--head <ref>]" >&2; exit 2 ;;
  esac
done
HEAD_SHA=$(git rev-parse -q --verify "${HEAD_REF}^{commit}") || { echo "verdict-diff: unknown head '$HEAD_REF'" >&2; exit 2; }
if [ -n "$BASE_REF" ]; then
  BASE_SHA=$(git rev-parse -q --verify "${BASE_REF}^{commit}") || { echo "verdict-diff: unknown base '$BASE_REF'" >&2; exit 2; }
else
  BASE_SHA=$(git merge-base origin/main "$HEAD_SHA" 2>/dev/null) || { echo "verdict-diff: no merge-base with origin/main; pass --base" >&2; exit 2; }
fi
CHANGED=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA") || exit 2

# ---- which targets ---------------------------------------------------------------------------
ALL_GUARDS=$(awk -F'\t' '!/^#/ && $2=="guard" && $3!="*" {print $3}' "$VD/targets.tsv")
GUARDS="" KEYWORDS=0
while IFS=$'\t' read -r glob runner target; do
  case "$glob" in '' | '#'*) continue ;; esac
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # shellcheck disable=SC2053  # glob match is the point
    [[ "$f" == $glob ]] || continue
    case "$runner" in
      guard) if [ "$target" = "*" ]; then GUARDS="$GUARDS $ALL_GUARDS"; else GUARDS="$GUARDS $target"; fi ;;
      keywords) KEYWORDS=1 ;;
    esac
  done <<< "$CHANGED"
done < "$VD/targets.tsv"
GUARDS=$(printf '%s\n' $GUARDS | sort -u | tr '\n' ' ')

T=$(mktemp -d "${TMPDIR:-/tmp}/verdict-diff-XXXXXX") || exit 2
VD_SESSION="verdict-diff-$$"
REG="/tmp/claude-worktree-contracts-$VD_SESSION"
cleanup() { chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T" "$REG"; }
trap cleanup EXIT

REPORT="$T/report.txt"
FAILED=0
say() { printf '%s\n' "$*" >> "$REPORT"; }
fail() { say "FAIL: $*"; FAILED=1; }
say "verdict-diff  base ${BASE_SHA:0:9} → head ${HEAD_SHA:0:9}  (interpreter: bash $BASH_VERSION)"

if [ -z "${GUARDS// /}" ] && [ "$KEYWORDS" = 0 ]; then
  say "No registry path changed in base..head; nothing to compare."
fi

for v in base:$BASE_SHA head:$HEAD_SHA; do
  mkdir -p "$T/${v%%:*}"
  git archive "${v#*:}" .claude/hooks shared | tar -x -C "$T/${v%%:*}" || { echo "verdict-diff: git archive failed" >&2; exit 2; }
done

# ---- guards ----------------------------------------------------------------------------------
MAIN='/Users/x/projects/OCRecipes'
WT="$MAIN/.claude/worktrees/agent-verdictdiff"
MISSING="$T/missing-folder"
NOEXEC="$T/noexec-folder"
PRESERVING=" id ws tab wrap prefix cdfail quote braceopt "   # families that keep the command's meaning

mkdir -p "$NOEXEC" "$T/bin" "$REG" && chmod 000 "$NOEXEC"
printf '%s' "$WT" > "$REG/aaaa000000000001"
# git-safety asks gh about PR state; a stand-in keeps the run offline and deterministic
cat > "$T/bin/gh" <<'EOF'
#!/bin/sh
printf '%s\n' '{"number":1,"state":"OPEN","mergedAt":null}'
EOF
chmod +x "$T/bin/gh"
export VD_SESSION PATH="$T/bin:$PATH"

run_rows() {  # $1 hook file, $2 rows dir, $3 out dir, $4 count — evaluates rows 1..count in parallel
  mkdir -p "$3"
  seq 1 "$4" | xargs -n 40 -P 8 bash "$VD/guard-eval.sh" "$1" "$2" "$3" || true
  local got; got=$(find "$3" -type f | wc -l | tr -d ' ')
  [ "$got" = "$4" ] || { fail "evaluated $got of $4 rows with $1 (a worker died?)"; return 1; }
}

for t in $GUARDS; do
  SEEDS="$VD/seeds/$t.tsv" HHOOK="$T/head/.claude/hooks/$t.sh" BHOOK="$T/base/.claude/hooks/$t.sh"
  say ""; say "== guard: $t"
  [ -f "$SEEDS" ] || { fail "no seeds file $SEEDS"; continue; }
  [ -f "$HHOOK" ] || { say "removed at head; nothing to judge."; continue; }
  R="$T/rows-$t"; mkdir -p "$R"; : > "$R/meta"
  k=0 seedno=0
  emit() {  # $1 family, $2 command
    k=$((k+1)); printf '%s' "$2" > "$R/$k.cmd"; printf '%s' "$CWD" > "$R/$k.cwd"
    printf '%s\t%s\t%s\t%s\n' "$k" "$seedno" "$1" "$EXPECT" >> "$R/meta"
  }
  while IFS=$'\t' read -r EXPECT cwdkey raw; do
    case "$EXPECT" in T | N) ;; *) continue ;; esac
    seedno=$((seedno+1))
    cmd=${raw//\{MAIN\}/$MAIN}; cmd=${cmd//\{WT\}/$WT}; cmd=${cmd//\\n/$'\n'}
    if [ "$cwdkey" = WT ]; then CWD=$WT; else CWD=$MAIN; fi
    printf '%s\t%s\n' "$EXPECT" "${cmd%%$'\n'*}" > "$R/seed-$seedno"
    w1=${cmd%%[ $'\n']*}; rest=${cmd#"$w1"}
    emit id "$cmd"
    emit ws "${cmd/ /  }"; emit tab "${cmd/ /$'\t'}"
    for w in sudo time env command nohup; do emit wrap "$w $cmd"; done
    emit wrap "{ $cmd"$'\n'"}"; emit wrap "( $cmd"$'\n'")"
    for p in 'true; ' 'true && ' 'false || ' $'true\n' 'true & '; do emit prefix "$p$cmd"; done
    for s in ' && : || ' '; ' ' || ' $'\n'; do emit cdfail "cd $MISSING$s$cmd"; done
    for s in '; ' ' || '; do emit cdfail "cd $NOEXEC$s$cmd"; done
    emit cdinto "cd $MAIN && $cmd"; emit cdinto "cd $WT && $cmd"
    emit quote "\\$cmd"; emit quote "'$w1'$rest"; emit quote "${w1:0:1}''${w1:1}$rest"
    repl=' {-..-}-'; repl1=' {-..-}'
    if [[ "$cmd" == *" --"[a-z]* ]]; then emit braceopt "${cmd/ --/$repl}"
    elif [[ "$cmd" == *" -"[a-zA-Z]* ]]; then emit braceopt "${cmd/ -/$repl1}"; fi
    if [[ "$cmd" != *[$'\n'\'\"]* ]]; then   # move the first option after word 2 to just after word 1
      read -r -a words <<< "$cmd"
      for ((i = 2; i < ${#words[@]}; i++)); do
        if [[ "${words[i]}" == -* ]]; then
          moved=("${words[0]}" "${words[i]}" "${words[@]:1:i-1}" "${words[@]:i+1}")
          emit flagmove "${moved[*]}"; break
        fi
      done
    fi
    for I in python3 node; do
      [[ "$cmd" == *"$I"* ]] || continue
      for form in "$I(){ sh;}" "$I ( ) { sh; }" "function $I { sh; }" "alias $I=sh" \
                  "hash -p /bin/sh $I" "enable -n $I" "eval \"$I(){ sh;}\""; do
        emit redefine "$form; $cmd"; emit redefine "$form"$'\n'"$cmd"
      done
    done
  done < "$SEEDS"
  N=$k
  run_rows "$HHOOK" "$R" "$R/head" "$N" || continue
  # negative control: a sample of head rows judged again must agree
  SAMPLE=$(awk -v n="$N" 'BEGIN{s=int(n/40); if(s<1)s=1; for(i=1;i<=n;i+=s) print i}')
  mkdir -p "$R/head2"
  printf '%s\n' "$SAMPLE" | xargs -n 40 -P 8 bash "$VD/guard-eval.sh" "$HHOOK" "$R" "$R/head2" || true
  NDIFF=0 NS=0
  for i in $SAMPLE; do NS=$((NS+1)); [ "$(cat "$R/head/$i")" = "$(cat "$R/head2/$i" 2>/dev/null)" ] || NDIFF=$((NDIFF+1)); done
  [ "$NDIFF" = 0 ] && say "control (negative): $NS sampled head rows judged twice, 0 differ" \
    || fail "control (negative): $NDIFF of $NS sampled head rows differ on a second run"
  # positive control: every must-trigger seed, unvaried, triggers at head
  MISS=$(awk -F'\t' '$3=="id" && $4=="T" {print $1"\t"$2}' "$R/meta" | while IFS=$'\t' read -r kk sn; do
    [ "$(cat "$R/head/$kk")" = ALLOW ] && printf '#%s %s\n' "$sn" "$(cut -f2 "$R/seed-$sn")"; done)
  NT=$(awk -F'\t' '$3=="id" && $4=="T"' "$R/meta" | wc -l | tr -d ' ')
  if [ -z "$MISS" ]; then say "control (positive): all $NT must-trigger seeds trigger at head"
  else fail "control (positive): must-trigger seeds that no longer trigger at head (if intended, change the seed in this PR):"; say "$MISS"; fi
  say "rows generated: $N from $seedno seeds"
  if [ -f "$BHOOK" ]; then
    run_rows "$BHOOK" "$R" "$R/base" "$N" || continue
    NCH=0 SECTION=""
    for ((sn = 1; sn <= seedno; sn++)); do
      lines=$(awk -F'\t' -v s="$sn" '$2==s {print $1"\t"$3}' "$R/meta" | while IFS=$'\t' read -r kk fam; do
        b=$(cat "$R/base/$kk") h=$(cat "$R/head/$kk")
        mark=' '; [[ "$PRESERVING" == *" $fam "* ]] || mark='!'
        [ "$b" = "$h" ] || printf '  %s %-9s %s→%s  %q\n' "$mark" "$fam" "$b" "$h" "$(cat "$R/$kk.cmd")"; done)
      [ -n "$lines" ] || continue
      n=$(printf '%s\n' "$lines" | wc -l | tr -d ' '); NCH=$((NCH+n))
      SECTION+="  seed #$sn [$(cut -f1 "$R/seed-$sn")] $(cut -f2 "$R/seed-$sn")  ($n changed)"$'\n'"$lines"$'\n'
    done
    say "CHANGED (base vs head): $NCH of $N rows. '!' = a variation that changes the command's meaning"
    say "  (redefines the interpreter, enters a folder, moves an option): check it should follow the seed."
    [ -n "$SECTION" ] && say "${SECTION%$'\n'}"
  else
    say "New at head (no base version): GAPS = must-trigger seeds whose meaning-keeping variations stay silent"
    NG=0 SECTION=""
    for ((sn = 1; sn <= seedno; sn++)); do
      [ "$(cut -f1 "$R/seed-$sn")" = T ] || continue
      lines=$(awk -F'\t' -v s="$sn" '$2==s {print $1"\t"$3}' "$R/meta" | while IFS=$'\t' read -r kk fam; do
        [[ "$PRESERVING" == *" $fam "* ]] || continue
        [ "$(cat "$R/head/$kk")" = ALLOW ] && printf '    %-9s %q\n' "$fam" "$(cat "$R/$kk.cmd")"; done)
      [ -n "$lines" ] || continue
      n=$(printf '%s\n' "$lines" | wc -l | tr -d ' '); NG=$((NG+n))
      SECTION+="  seed #$sn $(cut -f2 "$R/seed-$sn")  ($n silent)"$'\n'"$lines"$'\n'
    done
    say "GAPS: $NG"
    [ -n "$SECTION" ] && say "${SECTION%$'\n'}"
  fi
done

# ---- keywords --------------------------------------------------------------------------------
if [ "$KEYWORDS" = 1 ]; then
  say ""; say "== keywords: diet-conflicts + allergens"
  TSX="$ROOT/node_modules/.bin/tsx"
  [ -x "$TSX" ] || { fail "tsx not found at $TSX"; TSX=""; }
  if [ -n "$TSX" ]; then
    for v in base head; do
      ln -sfn "$ROOT/node_modules" "$T/$v/node_modules"
      printf '{"compilerOptions":{"baseUrl":".","paths":{"@shared/*":["./shared/*"]}}}\n' > "$T/$v/tsconfig.json"
    done
    "$TSX" "$VD/keywords.ts" plan "$T/base" "$T/head" "$T/kw-rows.json" >> "$REPORT" 2>&1 || fail "keyword plan failed"
    for v in base head; do
      (cd "$T/$v" && "$TSX" --tsconfig tsconfig.json "$VD/keywords.ts" eval "$T/$v" "$T/kw-rows.json" "$T/kw-$v.json") >> "$REPORT" 2>&1 \
        || fail "keyword eval ($v) failed"
    done
    (cd "$T/head" && "$TSX" --tsconfig tsconfig.json "$VD/keywords.ts" eval "$T/head" "$T/kw-rows.json" "$T/kw-head2.json" --sample) >> "$REPORT" 2>&1 \
      || fail "keyword eval (head re-run) failed"
    "$TSX" "$VD/keywords.ts" report "$T/kw-rows.json" "$T/kw-base.json" "$T/kw-head.json" "$T/kw-head2.json" >> "$REPORT" 2>&1 \
      || FAILED=1
  fi
fi

# ---- result ----------------------------------------------------------------------------------
cat "$REPORT"
DIR=$(verdict_diff_stamp_dir)
if [ "$FAILED" = 0 ]; then
  mkdir -p "$DIR" && cp "$REPORT" "$DIR/$HEAD_SHA.txt" && printf '%s base=%s\n' "$HEAD_SHA" "$BASE_SHA" > "$DIR/$HEAD_SHA" \
    || { echo "verdict-diff: could not write the stamp in $DIR" >&2; exit 1; }
  echo ""
  echo "✔ stamped ${HEAD_SHA:0:9}. Report: $DIR/$HEAD_SHA.txt — paste its CHANGED/GAPS lists into the PR body under '## Verdict changes' and say, for each, whether it is intended."
  exit 0
fi
echo ""
echo "✖ not stamped: a control or a count failed (see FAIL lines above)."
exit 1
