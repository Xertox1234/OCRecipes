#!/usr/bin/env bash
# npm `postinstall` (after patch-package): put the Android library build dirs back on U34Bolt.
#
# Why: Android dev builds keep each library's node_modules/<lib>/android/build/ on the U34Bolt
# drive through a symlink (the laptop disk is short; the dirs total ~5.5 GB). `npm ci` recreates
# node_modules without those links, so the next build would write them to the laptop again. The
# drive's own script (/Volumes/U34Bolt/OCRecipes/build/android/link-lib-build-dirs.sh, documented
# in /Volumes/U34Bolt/README.md) relinks them; this runs it after every install.
#
# Runs only in the main checkout, where Android builds happen — a linked worktree would give the
# drive a second, never-built copy of every library dir. Silent no-op when the drive script is
# absent (drive not mounted, CI, EAS) or CI/EAS_BUILD is set. Never fails the install.
# OCR_ANDROID_LINK_SCRIPT overrides the drive script's path (tests).
set -u

link_script="${OCR_ANDROID_LINK_SCRIPT:-/Volumes/U34Bolt/OCRecipes/build/android/link-lib-build-dirs.sh}"

[ -n "${CI:-}" ] && exit 0
[ -n "${EAS_BUILD:-}" ] && exit 0
[ -f "$link_script" ] || exit 0

git_dir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ "$git_dir" = "$common" ] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

if ! bash "$link_script" "$repo_root"; then
  echo "relink-android-build-dirs: the U34Bolt link script failed — run it by hand: bash $link_script $repo_root" >&2
fi
exit 0
