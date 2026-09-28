#!/usr/bin/env bash
# scripts/checkpoint.sh — WIP checkpoints to refs/checkpoints/<sid8>/<wt-key>.
# Spec: docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md §4.
#
#   capture --session <sid8> --trigger <token> [--cwd <dir>]   snapshot every DIRTY worktree
#   list    [--cwd <dir>]                                       human recovery aid
#   reap    [--days N] [--cwd <dir>]                            delete refs older than N days (14)
#
# Recovery: git restore --source=<ref> --worktree -- <path>
#
# Invariants: never modifies HEAD, any worktree's real index, or any working tree; runs no
# git hooks (commit-tree / update-ref invoke none). Snapshots go through a COPY of the real
# index (its stat cache makes `add -A` hash only changed/untracked files; mktemp's 0-byte
# file is not a valid index). Fail-silent: exit 0 always; only `list` prints.
# Test seams: CHECKPOINT_TEST_RACE=<sha> plants a racing writer before the CAS update;
# CHECKPOINT_TEST_SLEEP=<secs> delays the capture.
set -uo pipefail
exec 2>/dev/null
G=/usr/bin/git          # bypass the RTK proxy (reference_rtk_worktree_guard_blocks_git)
[ -x "$G" ] || G=git
export GIT_AUTHOR_NAME="checkpoint" GIT_AUTHOR_EMAIL="checkpoint@localhost"
export GIT_COMMITTER_NAME="checkpoint" GIT_COMMITTER_EMAIL="checkpoint@localhost"

SUB="${1:-}"; [ $# -gt 0 ] && shift
SID=""; TRIGGER=""; CWD="$PWD"; DAYS=14
while [ $# -gt 0 ]; do
  case "$1" in
    --session) SID="${2:-}"; shift ;;
    --trigger) TRIGGER="${2:-}"; shift ;;
    --cwd)     CWD="${2:-}"; shift ;;
    --days)    DAYS="${2:-14}"; shift ;;
  esac
  shift
done
case "$DAYS" in ''|*[!0-9]*) DAYS=14 ;; esac
case "$TRIGGER" in agent|git-checkout|git-restore|git-reset|git-stash|git-clean|git-switch) ;; *) TRIGGER=unknown ;; esac

TMPD=""
trap '[ -n "$TMPD" ] && rm -rf "$TMPD"' EXIT

wt_key() { # $1 worktree -> gitdir name for a linked worktree, "main" for the main checkout
  local gd
  gd=$("$G" -C "$1" rev-parse --absolute-git-dir) || return 1
  case "$gd" in */worktrees/*) basename "$gd" ;; *) echo main ;; esac
}

capture_one() { # $1 worktree path
  local wt="$1" st idx tree key ref prev prevtree head msg commit
  st=$("$G" --no-optional-locks -C "$wt" status --porcelain --untracked-files=normal) || return 0
  [ -n "$st" ] || return 0
  head=$("$G" -C "$wt" rev-parse -q --verify HEAD) || return 0
  TMPD=$(mktemp -d "${TMPDIR:-/tmp}/ckpt-XXXXXX") || return 0
  idx="$TMPD/index"
  cp "$("$G" -C "$wt" rev-parse --path-format=absolute --git-path index)" "$idx" || { rm -rf "$TMPD"; TMPD=""; return 0; }
  GIT_INDEX_FILE="$idx" "$G" -C "$wt" add -A >/dev/null 2>&1 || { rm -rf "$TMPD"; TMPD=""; return 0; }
  tree=$(GIT_INDEX_FILE="$idx" "$G" -C "$wt" write-tree) || { rm -rf "$TMPD"; TMPD=""; return 0; }
  rm -rf "$TMPD"; TMPD=""
  key=$(wt_key "$wt") || return 0
  ref="refs/checkpoints/$SID/$key"
  prev=$("$G" -C "$wt" rev-parse -q --verify "$ref^{commit}") || prev=""
  if [ -n "$prev" ]; then
    prevtree=$("$G" -C "$wt" rev-parse "$prev^{tree}") || return 0
    [ "$prevtree" = "$tree" ] && return 0
  fi
  msg="checkpoint: $TRIGGER $(date -u +%Y-%m-%dT%H:%M:%SZ) session=$SID wt=$key"
  if [ -n "$prev" ]; then
    commit=$("$G" -C "$wt" commit-tree "$tree" -p "$prev" -p "$head" -m "$msg") || return 0
  else
    commit=$("$G" -C "$wt" commit-tree "$tree" -p "$head" -m "$msg") || return 0
  fi
  [ -n "${CHECKPOINT_TEST_RACE:-}" ] && "$G" -C "$wt" update-ref "$ref" "$CHECKPOINT_TEST_RACE"
  if [ -n "$prev" ]; then
    "$G" -C "$wt" update-ref "$ref" "$commit" "$prev"
  else
    "$G" -C "$wt" update-ref "$ref" "$commit" ""
  fi
  return 0
}

do_capture() {
  case "$SID" in ''|.|..|*[!A-Za-z0-9._-]*) return 0 ;; esac
  [ -n "${CHECKPOINT_TEST_SLEEP:-}" ] && sleep "$CHECKPOINT_TEST_SLEEP"
  local wt
  while IFS= read -r wt; do
    [ -d "$wt" ] || continue
    capture_one "$wt"
  done < <("$G" -C "$CWD" worktree list --porcelain | sed -n 's/^worktree //p')
  return 0
}

do_list() {
  local ref base n date subj
  "$G" -C "$CWD" for-each-ref --format='%(refname)' refs/checkpoints/ | while IFS= read -r ref; do
    base=$("$G" -C "$CWD" rev-parse "$ref^@" | tail -1)
    n=$("$G" -C "$CWD" diff --name-only "$base" "$ref" | wc -l | tr -d ' ')
    date=$("$G" -C "$CWD" log -1 --format=%ci "$ref")
    subj=$("$G" -C "$CWD" log -1 --format=%s "$ref")
    printf '%s\t%s\t%s files\t%s\n' "$ref" "$date" "$n" "$subj"
  done
  return 0
}

do_reap() {
  local cutoff ref ts
  cutoff=$(( $(date +%s) - DAYS * 86400 ))
  "$G" -C "$CWD" for-each-ref --format='%(refname) %(committerdate:unix)' refs/checkpoints/ |
  while read -r ref ts; do
    [ -n "$ts" ] && [ "$ts" -lt "$cutoff" ] && "$G" -C "$CWD" update-ref -d "$ref"
  done
  return 0
}

case "$SUB" in
  capture) do_capture ;;
  list)    do_list ;;
  reap)    do_reap ;;
esac
exit 0
