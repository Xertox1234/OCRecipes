#!/usr/bin/env bash
# npm `prepare`: install husky, then point core.hooksPath at the MAIN checkout's
# shims as an ABSOLUTE path.
#
# Why: husky 9 writes the relative `.husky/_` into the shared .git/config. Git
# resolves a relative hooksPath against each worktree's own root, and `.husky/_`
# is generated + gitignored, so a linked worktree (/todo executors, ad-hoc
# worktrees) has no such folder and git silently runs NO hooks there: no
# lint-staged on commit, no preflight:fast on push, so no pass-stamp and the
# PR-preflight guard denies. Measured 2026-10-25: 5 of the 8 PR-stamp blocks
# after #1436 were worktree pushes that ran no pre-push hook.
#
# The main checkout's shims, not the cwd's: an install run inside a worktree must
# not leave every checkout pointing at a folder that disappears with that worktree.
# If the main checkout has no shims yet, husky's relative value is left as is.
set -u

[ "${HUSKY:-}" = "0" ] && exit 0

husky || exit $?

common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ "$(basename "$common")" = ".git" ] || exit 0
main_root=$(dirname "$common")
[ -x "$main_root/.husky/_/pre-push" ] || exit 0

git config core.hooksPath "$main_root/.husky/_"
