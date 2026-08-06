---
title: "Prettier is enforced only by the commit hook — check:format runs in no CI workflow and no gate"
status: done
priority: low
created: 2026-07-31
updated: 2026-08-05
assignee:
labels: [deferred, testing]
github_issue:
---

# Prettier is enforced only by the commit hook

## Summary

`npm run check:format` exists in `package.json` but is invoked by **no** GitHub workflow and
is **not** part of `scripts/preflight.sh`. The only enforcement is lint-staged's
`*.{ts,tsx}` → `prettier --write` at commit time, so any file that bypasses the hook reaches
`main` unformatted with nothing to catch it.

## Background

Found 2026-07-31 during slice 2a (PR #747). Verified, not assumed:

```
$ grep -rn 'check:format\|prettier' .github/workflows/
(no matches)

$ grep -n 'check:format\|prettier' scripts/preflight.sh
(no matches)
```

This is not hypothetical — it happened inside the slice that found it.
`server/services/__tests__/no-server-fsa-constants.test.ts` was committed with a 96-character
line and `npx prettier --list-different` flagged it afterwards. A code reviewer caught it;
nothing automated would have.

Bypass routes that reach `main` unformatted today:

- `git commit --no-verify`
- a path lint-staged's globs do not match
- any writer that stages and commits without running the hook

Low severity: this is formatting drift and diff noise, not correctness. Filing it because the
gap is invisible — the repo _looks_ like it enforces formatting, and contributors reasonably
assume CI would catch what the hook missed.

## Acceptance Criteria

- [x] A formatting violation on `main` is caught by something other than the commit hook
- [x] The chosen mechanism runs on every PR, not only on paths a change-detection filter matches
- [x] A deliberately mis-formatted file fails the new gate — verified by actually introducing
      one, not by reading the config
- [x] The gate's cost is proportionate: prefer adding `check:format` to an existing job over
      creating a new workflow

## Implementation Notes

- The cheapest option is one step in the existing `Lint · Types · Patterns` job, which already
  runs on every PR and is a required check.
- `scripts/preflight.sh` is the local CI-parity run — adding it there too keeps local and CI
  honest with each other, but preflight is on-demand only, so it is not a substitute.
- Check whether `docs/solutions/` should be excluded: it is already in `.prettierignore`
  because solution frontmatter arrays must stay single-line inline-flow for the pattern
  injection hook's `^tags:` grep to match.

## Scope Contract

- **Mechanisms to use:** the existing `check:format` script and an existing CI job — no new
  workflow, no new tooling, no reformatting sweep of the repo
- **Files in scope:** `.github/workflows/ci.yml` (or whichever workflow owns
  `Lint · Types · Patterns`), optionally `scripts/preflight.sh`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- If the repo currently has pre-existing formatting violations on `main`, turning this on makes
  the first PR after it red for reasons unrelated to that PR. Run `npx prettier --check .`
  first and, if there are hits, fix them in a separate formatting-only commit before wiring
  the gate.

## Updates

### 2026-07-31

- Filed after PR #747 merged. Discovered when a reviewer flagged an unformatted test file in
  that slice and the follow-up question — "why didn't CI catch this?" — turned out to have the
  answer "there is no CI check for it."

### 2026-08-05

- Implemented: added a "Format check" step (`npm run check:format`) to the `checks` job
  ("Lint · Types · Patterns") in `.github/workflows/ci.yml`, right after `Lint`. That job is
  already a required status check on `main` and already runs on every PR with no path filter.
  Mirrored the same line into `scripts/preflight.sh`'s full-mode section.
- Pre-existing violations on `main` (per the Risks section): `npx prettier --check
"**/*.{js,ts,tsx,css,json}"` found 9 files failing. Resolved in this PR, not deferred: 4
  hand-maintained files (`.claude/settings.json`, 3 `evals/datasets/*.json`) reformatted with
  `prettier --write` (whitespace-only, verified semantically identical); `eslint-suppressions.json`
  and the 4 Xcode/Expo-prebuild `ios/**/Contents.json` manifests added to `.prettierignore`
  instead, since each is owned by a non-Prettier writer that would just drift back out of
  compliance on its next regeneration/edit.
- Verified acceptance criterion 3 empirically: injected a real badly-formatted scratch `.ts`
  file, confirmed `npm run check:format` exits 1, then removed it and reconfirmed a clean pass.
- Deferred, not fixed here (see PR body): `check:format`'s glob (`**/*.{js,ts,tsx,css,json}`)
  excludes `.md`/`.yml`/`.yaml`, and `lint-staged`'s Prettier globs separately exclude
  `.json`/`.css` — both gaps are out of this todo's Scope Contract (would require editing
  `package.json`), so the "commit hook is the only enforcement" problem is only partially
  closed for those extensions. Codified as
  `docs/solutions/conventions/prettier-glob-mismatch-commit-hook-vs-ci-2026-08-05.md`.
