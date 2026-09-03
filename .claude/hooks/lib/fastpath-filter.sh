#!/usr/bin/env bash
# Shared necessary-substring fast-path filter for the PreToolUse/PostToolUse(Bash) matcher
# hooks. SOURCE this file; it defines one function and runs nothing on its own.
#
# WHY THIS EXISTS (todos/archive/P3-2026-08-16-extract-shared-fastpath-filter-helper.md): an
# 18-line, byte-identical (modulo the needle set) two-stage necessary-substring filter was
# hand-copied into 7 hooks (branch-preflight.sh, commit-verify.sh, core-bare-guard.sh,
# drift-detect.sh, drift-detect-update.sh, guard-outward-cli.sh, pr-preflight-guard.sh). A
# fix that must change the filter (e.g. the `$`-strip added in PR #850) had to be
# hand-applied identically 7 times; missing one silently reopens a bypass in that one hook.
#
# Deliberately NOT folded into lib/cmd-detect.sh: the fast path runs BEFORE that (500+ line)
# lib is sourced in every hook, and several hooks exit without ever sourcing it. Routing this
# filter through cmd-detect.sh would make every Bash tool call parse the whole file instead
# of exiting on a cheap glob — inverting the optimization this filter exists to provide.
#
# cmd_fastpath_has "$CMD" pattern [pattern...]
#   Two-stage necessary-substring test. Stage 1 tests each PATTERN (a `case` glob, e.g.
#   '*commit*', or an ordered multi-segment glob like '*gh*pr*create*') against the raw
#   $CMD. Stage 2 runs ONLY on a stage-1 miss: it retests the SAME patterns against a copy
#   of $CMD with the characters cmd_words (lib/cmd-detect.sh) can DELETE removed — quotes,
#   backslash, newline, and `$`.
#
#   Stage 2 exists because a hook's PRECISE matcher reads cmd_words, which deletes those
#   characters and so can synthesize a needle the raw text does not contain: `git com"mit"`
#   holds no literal `commit`, so a single-stage filter exits before the precise matcher is
#   ever asked (review, 2026-08-16). cmd_words only ever deletes those characters or inserts
#   the placeholder letter `x`, and none of this project's fast-path needles contain an `x`,
#   so stage 2 is a superset of what cmd_words can produce BY CONSTRUCTION, not by
#   assumption — re-verify this claim whenever cmd_words' character set changes (see
#   docs/solutions/conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md).
#
#   Four literal substitutions, NOT one bracket class: on a 3 KB command, bash 3.2 takes
#   ~1450 ms for a class-form strip (`${CMD//[\'\"\\$NL]/}`) and ~5.5 ms for four literal
#   substitutions, same result. Do not "simplify" this.
#
#   PATTERNS ARE SEPARATE ARGUMENTS — NEVER ONE `|`-JOINED STRING. A `case` pattern-list
#   alternation (`a|b`) must be literal source text at `case`-parse time; a `|` produced by
#   variable expansion does NOT alternate (verified: `pat='*a*|*b*'; case "$x" in $pat)`
#   does not split on the embedded `|` — a command matching only the `*b*` half silently
#   misses). Passing patterns as N separate arguments and looping is the correct
#   generalization of `case "$CMD" in *a*|*b*)`. A SINGLE pattern may still embed multiple
#   wildcards for an ordered-all-of test (`*gh*pr*create*` requires "gh", then "pr", then
#   "create", in that order, anything between) — that is unrelated to alternation and needs
#   no special handling here.
#
#   Callers whose precise matcher is case-INSENSITIVE (guard-outward-cli.sh) must wrap the
#   CALL in `shopt -s nocasematch` / `shopt -u nocasematch` themselves. Shell options are
#   process-global, not function-scoped, so this works without any flag on the function; bash
#   3.2 has no `local -` (added in 4.4) to save/restore options function-locally, so this
#   function must not toggle nocasematch itself — doing so would leak the setting into the
#   caller once this function returns.
cmd_fastpath_has() {
  local _fph_cmd="$1"; shift
  local _fph_pat
  for _fph_pat in "$@"; do
    case "$_fph_cmd" in $_fph_pat) return 0 ;; esac
  done
  local _fph_t
  _fph_t=${_fph_cmd//\'/}
  _fph_t=${_fph_t//\"/}
  _fph_t=${_fph_t//\\/}
  _fph_t=${_fph_t//$'\n'/}
  _fph_t=${_fph_t//\$/}
  for _fph_pat in "$@"; do
    case "$_fph_t" in $_fph_pat) return 0 ;; esac
  done
  return 1
}
