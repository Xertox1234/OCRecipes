---
title: A write-time formatter's glob and its CI read-time check's glob can silently diverge
track: knowledge
category: conventions
module: shared
tags: [prettier, lint-staged, ci, glob-coverage, tooling]
applies_to: [package.json, .github/workflows/**/*.yml, .prettierignore]
created: '2026-08-05'
---

# A write-time formatter's glob and its CI read-time check's glob can silently diverge

## Rule

When wiring a CI "read-time" check (`prettier --check`, a linter's `--check` mode, etc.)
that is meant to backstop a commit-time "write-time" formatter (lint-staged, a pre-commit
hook), verify the two run against the **same file-extension glob**. A gap between them
means files matching the difference never get auto-formatted locally, and were never
covered by anything before the CI gate existed — so turning the gate on surfaces every
pre-existing violation in that gap at once, and every future edit to a file in the gap
goes red in CI with no local warning to catch it first.

## Why

Discovered while wiring `check:format` (`prettier --check "**/*.{js,ts,tsx,css,json}"`)
into CI for `todo/P3-2026-07-31-prettier-enforced-only-by-the-commit-hook`. `lint-staged`'s
Prettier entries are `*.{ts,tsx}` and `*.{js,md}` — narrower than `check:format`'s glob in
two directions:

- `.json` and `.css` are checked by CI but were never auto-formatted by the commit hook.
  This is exactly why `main` already had 9 pre-existing `.json` violations the moment
  `check:format` was pointed at it — the hook was never going to catch them regardless of
  `--no-verify`.
- `.md`, `.yml`, and `.yaml` are outside `check:format`'s glob entirely, so those extensions
  still have **no CI backstop** after this fix. The todo's own problem statement — "Prettier
  is enforced only by the commit hook" — remains literally true for every `.md` and
  `.yml`/`.yaml` file in the repo, including `.github/workflows/ci.yml` itself.

## Examples

```
# lint-staged (package.json) — write-time, commit hook
"*.{ts,tsx}": ["eslint --fix", "prettier --write"]
"*.{js,md}":  ["prettier --write"]

# check:format (package.json) — read-time, wired into CI by the referenced todo
"check:format": "prettier --check \"**/*.{js,ts,tsx,css,json}\""
```

Diff the two globs by extension before treating a newly-wired CI check as "now enforced
everywhere": `.json`/`.css` are CI-only (never hook-formatted, so a normal hook-honoring
commit that edits one goes red with no local warning); `.md`/`.yml`/`.yaml` are hook-only
(still entirely un-checked by CI).

## Exceptions

- A narrower CI glob than the hook's write-time glob is not itself a hazard — CI checking
  *less* than the hook formats is a missed-coverage gap, not a divergence trap, since the
  hook already keeps those files clean. The dangerous direction is specifically a file class
  the CI check flags that the hook never auto-formats.
- Widening either glob to close a discovered gap is a separate, deliberate scope decision
  (it touches `package.json`) — don't fold it into an unrelated change that's merely wiring
  an existing check into CI for the first time.

## Related Files

- `package.json` — `lint-staged`, `check:format`
- `.github/workflows/ci.yml` — "Format check" step
- `scripts/preflight.sh` — full-mode `check:format` line
- `.husky/pre-commit`

## See Also

- [pre-commit skips type-aware eslint, run it before push](pre-commit-skips-type-aware-eslint-run-it-before-push-2026-06-19.md) — sibling "local gate ≠ CI gate" finding, same root shape (commit-time tooling is deliberately weaker than CI)
- [a grep-retrieved corpus needs a write-time format lint once its parsing layer is deleted](grep-retrieved-corpus-needs-write-time-format-lint-2026-07-03.md) — the inverse direction: enforcement moving from a validator into a write-time lint
- [prettier reformats generated files after commit, breaking byte-equality drift checks](../logic-errors/prettier-reformats-generated-files-2026-05-13.md) — sibling bug-track finding from the same todo
