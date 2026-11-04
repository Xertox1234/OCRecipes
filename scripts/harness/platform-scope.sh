#!/usr/bin/env bash
# Does a change need a real-platform check before merge? (harness diagnosis N6)
#
# usage: gh pr diff <n> | bash scripts/harness/platform-scope.sh
#        git diff <base>...<head> | bash scripts/harness/platform-scope.sh
#
# Reads a unified diff on stdin. In scope when any of:
#   native    a path (old or new side) under patches/, plugins/, modules/, or app.json, app.config.*,
#             eas.json: what changes the native build
#   sdk       a package.json line adding or removing an expo*, react-native*, @expo/* or
#             @react-native* version: an SDK or native-module bump
#   upload    an added or removed line in client/** (tests excluded) naming FormData, uploadAsync,
#             ExpoFile or FileSystemUploadType: how a file leaves the phone. Matched by content, not
#             by a file list, so a moved upload hook stays in scope.
# Why: the SDK 57 upgrade (#1549) broke three uploads on both platforms for 4 days; jsdom's FormData
# and a mocked fetch could not see it (#1592). Measured over 10-10 → 11-01: 12 of 321 merged PRs.
#
# Read by .claude/hooks/merge-review-guard.sh (needs an E2E run on the head commit) and by
# scripts/todo-automerge-guard.sh (HOLDs, so auto-merge cannot skip that check).
# Exit 0 in scope (one "<kind> <path>" line per reason on stdout), 1 not in scope,
# 2 empty input (a diff that could not be read must not read as "not in scope").
set -uo pipefail

awk '
  function scoped(p) {
    return p ~ /^(patches|plugins|modules)\// || p == "app.json" || p ~ /^app\.config\./ || p == "eas.json"
  }
  function client_code(p) {
    return p ~ /^client\// && p !~ /(^|\/)__tests__\// && p !~ /\.(test|spec)\.[jt]sx?$/
  }
  function hit(kind, p) {
    key = kind " " p
    if (!(key in seen)) { seen[key] = 1; print key }
    n++
  }
  { lines++ }
  /^diff --git / {
    # "diff --git a/<old> b/<new>": both sides count, so a deleted or renamed-away file is seen
    old = $3; new = $4; sub(/^a\//, "", old); sub(/^b\//, "", new)
    file = new
    if (scoped(old)) hit("native", old)
    if (scoped(new)) hit("native", new)
    next
  }
  /^(\+\+\+|---) / { next }
  /^[+-]/ {
    if (file == "package.json" && $0 ~ /^[+-][ \t]*"(expo[^"]*|react-native[^"]*|@expo\/[^"]*|@react-native[^"]*)"[ \t]*:[ \t]*"/)
      hit("sdk", file)
    else if (client_code(file) && $0 ~ /FormData|uploadAsync|ExpoFile|FileSystemUploadType/)
      hit("upload", file)
  }
  END {
    if (lines == 0) exit 2
    exit (n > 0 ? 0 : 1)
  }
'
