#!/usr/bin/env bash
# .claude/hooks/lib/mutants.sh — automated mutation checks for hook test suites.
# Spec: docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md §7.4.
#
# Usage, at the END of a .claude/hooks/test-*.sh, after its own assertions:
#   . "$HOOK_DIR/lib/mutants.sh"
#   mutant "<label>" "<repo-relative target file>" '<sed -E expression>'
#   run_mutants "$PROJECT_ROOT" ".claude/hooks/test-<name>.sh" || FAIL=1
#
# Per mutant: copy .claude/hooks, scripts/pg-lab and scripts/checkpoint.sh (whichever exist)
# into a temp root PRESERVING relative paths; apply the sed to the target copy; REQUIRE a
# changed file (an unapplied mutant proves nothing, so it FAILS the run); run the COPIED
# test file with MUTANTS_INNER=1 — its BASH_SOURCE-derived PROJECT_ROOT is the temp root,
# so every script it reaches is the mutated copy; count the mutant killed iff the suite
# exits non-zero. Any survivor or unapplied mutant → return 1.
#
# Baseline gate: the unmutated copy runs first. It must exit 0, and it must not print a
# line starting with "skip:" — a suite that skipped its live cases lets every mutant
# "survive" for the wrong reason. A skipping baseline prints a SKIPPED line with the
# declared count and returns 0: skipped and counted, never silent.
_MUT_LABEL=(); _MUT_FILE=(); _MUT_SED=()
mutant() { _MUT_LABEL+=("$1"); _MUT_FILE+=("$2"); _MUT_SED+=("$3"); }

_mut_copy_tree() { # $1 source project root, $2 destination root
  mkdir -p "$2/.claude" "$2/scripts" || return 1
  cp -R "$1/.claude/hooks" "$2/.claude/hooks" || return 1
  if [ -d "$1/scripts/pg-lab" ]; then cp -R "$1/scripts/pg-lab" "$2/scripts/pg-lab" || return 1; fi
  if [ -f "$1/scripts/checkpoint.sh" ]; then cp "$1/scripts/checkpoint.sh" "$2/scripts/checkpoint.sh" || return 1; fi
  return 0
}

run_mutants() { # $1 project root, $2 repo-relative test file
  [ -n "${MUTANTS_INNER:-}" ] && return 0
  local root="$1" test_rel="$2" declared=${#_MUT_LABEL[@]} applied=0 killed=0 fail=0 i tmp target out rc
  if [ "$declared" -eq 0 ]; then echo "mutants: FAIL — none declared"; return 1; fi
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/mutants-XXXXXX") || return 1
  _mut_copy_tree "$root" "$tmp/base" || { echo "mutants: FAIL — could not copy tree"; rm -rf "$tmp"; return 1; }
  out=$(MUTANTS_INNER=1 bash "$tmp/base/$test_rel" 2>&1); rc=$?
  if [ "$rc" -ne 0 ]; then echo "mutants: FAIL — unmutated baseline copy failed (rc $rc)"; rm -rf "$tmp"; return 1; fi
  if grep -q '^skip:' <<<"$out"; then
    echo "mutants: SKIPPED (baseline skipped live cases) — declared $declared"; rm -rf "$tmp"; return 0
  fi
  for i in "${!_MUT_LABEL[@]}"; do
    rm -rf "$tmp/m"
    _mut_copy_tree "$root" "$tmp/m" || { echo "mutants: FAIL — could not copy tree"; fail=1; continue; }
    target="$tmp/m/${_MUT_FILE[$i]}"
    if [ ! -f "$target" ]; then echo "MUTANT UNAPPLIED (no such file): ${_MUT_LABEL[$i]}"; fail=1; continue; fi
    cp "$target" "$tmp/orig"
    sed -E -i.mutbak "${_MUT_SED[$i]}" "$target" 2>/dev/null; rm -f "$target.mutbak"
    if cmp -s "$target" "$tmp/orig"; then echo "MUTANT UNAPPLIED: ${_MUT_LABEL[$i]}"; fail=1; continue; fi
    applied=$((applied + 1))
    if MUTANTS_INNER=1 bash "$tmp/m/$test_rel" >/dev/null 2>&1; then
      echo "MUTANT SURVIVED: ${_MUT_LABEL[$i]}"; fail=1
    else
      killed=$((killed + 1))
    fi
  done
  rm -rf "$tmp"
  echo "mutants: killed $killed / applied $applied / declared $declared"
  return "$fail"
}
