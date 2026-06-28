#!/usr/bin/env bash
# Unit test for scripts/lib/preflight-stamp-path.sh — the single source of truth for
# the PR-gate pass-stamp path, shared by scripts/preflight.sh (writer) and
# pr-preflight-guard.sh (reader). Auto-run by full preflight (the .claude/hooks/test-*.sh
# glob) and by CI's "Lint · Types · Patterns" job. Hermetic: own temp git repos, no
# network, inherited git env stripped so an absolute GIT_DIR can't hijack resolution.
set -uo pipefail

HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/preflight-stamp-path.sh"
FAIL=0
ok()  { echo "ok: $1"; }
bad() { echo "FAIL: $1"; FAIL=1; }

[ -f "$HELPER" ] || { echo "FAIL: helper not found at $HELPER"; exit 1; }

# 1. PREFLIGHT_STAMP_FILE override is returned verbatim (keeps callers' tests hermetic).
OUT=$( . "$HELPER"; PREFLIGHT_STAMP_FILE=/tmp/override-xyz preflight_stamp_path )
[ "$OUT" = "/tmp/override-xyz" ] && ok "override honored verbatim" || bad "override not honored: $OUT"

# Resolve the path in a given cwd with inherited git env stripped (so an absolute
# GIT_DIR / GIT_COMMON_DIR can't point resolution at the real repo) and no override.
key_in() { # $1 = dir to run in  → stamp path on stdout
  ( cd "$1" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
      -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR -u PREFLIGHT_STAMP_FILE \
      bash -c ". '$HELPER'; preflight_stamp_path" )
}

R1=$(mktemp -d); R2=$(mktemp -d)
trap 'rm -rf "$R1" "$R2"' EXIT
( cd "$R1" && git init -q ); ( cd "$R2" && git init -q )
mkdir -p "$R1/sub"

P1=$(key_in "$R1"); P1SUB=$(key_in "$R1/sub"); P2=$(key_in "$R2")

# 2. Default path is repo-keyed — NOT the bare global path that caused the clobber.
case "$P1" in
  /tmp/ocrecipes-preflight-pass-?*) ok "default path is repo-keyed ($P1)" ;;
  *) bad "default path not keyed: $P1" ;;
esac
[ "$P1" != "/tmp/ocrecipes-preflight-pass" ] && ok "not the bare global path" || bad "fell back to bare global path"

# 3. Same repo, different cwd → same path (cwd-invariant: writer & reader must agree
#    even when the hook fires from a different cwd than the preflight run).
[ "$P1" = "$P1SUB" ] && ok "same repo, different cwd → same path" || bad "cwd drift: $P1 vs $P1SUB"

# 4. Different repos → different paths (no cross-repo clobber).
[ "$P1" != "$P2" ] && ok "different repos → different paths" || bad "two repos collided on $P1"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
