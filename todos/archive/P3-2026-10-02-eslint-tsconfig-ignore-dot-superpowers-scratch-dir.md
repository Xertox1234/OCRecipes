---
title: "Local npm run lint fails on gitignored .superpowers/ scratch .ts files (4 parsing errors) — add the dot-dir to the eslint ignores and tsconfig excludes like #1226 did for docs/"
status: done
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, tooling, testing]
github_issue:
---

# Local lint fails on gitignored `.superpowers/` scratch files

## Summary

`.superpowers/` is gitignored (`.gitignore:7`) and holds the superpowers plugin's local session scratch (today: `.superpowers/sdd/2026-09-14-advanced-testing-lanes-B-property-tests/*.ts` and `b2-probe.mts`). TypeScript's `**` include glob never descends into dot-directories, so those files are outside the tsconfig project; ESLint's flat config DOES lint dot-directories, so the type-aware block reports `Parsing error: … was not found by the project service` for every `.ts`/`.mts` under it. On 2026-10-02, `npm run lint` on a clean `main` (e41bf71c) exited 1 with 4 such errors and zero problems in tracked code.

## Background

Found by the `/todo` orchestrator's Phase 5 verification on 2026-10-02, right after #1226 fixed the same class for `docs/audits`, `docs/superpowers` and `docs/research`. A controlled run of the same two files under the pre-#1226 configs (detached worktree at 2b9ae012 with node_modules symlinked) failed identically, so #1226 did not cause it; the orchestrator's Phase 1 file list had been truncated at 40 entries and missed these. CI is unaffected because the directory is not in the repo. Local-only, same class as #1226; filed per the CLAUDE.md Low-severity auto-file rule.

## Acceptance Criteria

- [x] `eslint.config.js` top-level `ignores` lists `.superpowers/**` (next to `.claude/worktrees/**` and `.worktrees/**`), so `npm run lint` skips it. Two-sided probe: a `.ts` with an obvious violation under `.superpowers/probe-<unique>/` fails lint before the change and is skipped after; a control under a non-ignored dir still fails. Give fixtures distinct basenames (the fixture trap recorded in the #1226 solution doc).
- [x] `tsconfig.json` and `tsconfig.check.json` `exclude` list `.superpowers` for consistency with the eslint ignores (tsc already skips dot-dirs through its `**` semantics; the entry documents intent and keeps the three lists in sync, as #1226's comments require).
- [x] From a checkout that still contains `.superpowers/sdd/…/*.ts`, `npm run lint` exits 0 with 0 errors and `npm run check:types` exits 0.
- [x] `docs/solutions/best-practices/exclude-gitignored-scratch-dirs-from-tsc-and-eslint-together-2026-10-02.md` gains one sentence: dot-directories need the eslint `ignores` entry even though tsc skips them on its own.

## Implementation Notes

- `eslint.config.js`: add `".superpowers/**"` to the existing global `ignores` object (the one #1226 extended with the three `docs/` globs).
- `tsconfig.json` / `tsconfig.check.json`: add `".superpowers"` to both `exclude` arrays (a child `exclude` replaces the parent's, so both files).
- Do NOT delete anything under `.superpowers/`; it is the superpowers plugin's local session state.
- Reuse the probe recipe from the #1226 solution doc. `npm run lint` sets `ESLINT_NO_TYPE_AWARE=` (empty), so run the probe through `npm run lint` or `ESLINT_NO_TYPE_AWARE= npx eslint --no-cache <file>`, not bare `npx eslint`.

## Scope Contract

- **Mechanisms to use:** the existing `ignores` and `exclude` arrays. Nothing new.
- **Files in scope:** `eslint.config.js`, `tsconfig.json`, `tsconfig.check.json`, `docs/solutions/best-practices/exclude-gitignored-scratch-dirs-from-tsc-and-eslint-together-2026-10-02.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None (#1226 is merged).

## Risks

- Other gitignored top-level dirs (`scratchpad/` at the repo root, for one) may hold the same class of file. Sweep `git status --porcelain --ignored` for top-level ignored dirs that contain `.ts`/`.mts`/`.cjs` today and add them in the same change only if they actually do.

## Updates

### 2026-10-02

- Initial creation, filed by the `/todo` orchestrator after its Phase 5 verification.

### 2026-10-04

- Executed: added `.superpowers/**` to eslint global ignores and `.superpowers` to both tsconfig excludes; one sentence added to the #1226 solution doc. Two-sided probe: dot-dir `.ts` fixture gave "not found by the project service" before, is ignored after; control under `zz-probe-control/` still fails (no-var). Ignored-dir sweep found no other `.ts` holders needing entries.
