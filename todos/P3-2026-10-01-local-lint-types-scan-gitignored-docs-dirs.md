---
title: "Local check:types and lint go red from gitignored docs/ scratch dirs (tsconfig/eslint scan them), plus 3 unused-import warnings on main"
status: in-progress
priority: low
created: 2026-10-01
updated: 2026-10-02
assignee:
labels: [deferred, tooling, testing]
github_issue:
---

# Local check:types and lint go red from gitignored docs/ scratch dirs

## Summary

`tsconfig.json` includes `**/*.ts` / `**/*.tsx` / `**/*.mts` and excludes only `node_modules`, `build`, `dist`; `eslint.config.js` ignores only `dist`, `server_dist`, the worktree dirs and `.stryker-tmp`. The gitignored, local-only directories `docs/superpowers/`, `docs/audits/`, `docs/research/` (`.gitignore` lines 104-106, "AI-workflow history: kept locally, not synced to GitHub") are therefore scanned by both tools. Whenever a local session leaves a `.ts`/`.tsx`/`.cjs` file there, `npm run check:types` and `npm run lint` fail in the main checkout even though the repo is green.

Separately, `npm run lint` reports three `@typescript-eslint/no-unused-vars` warnings in tracked tests on `main`.

## Background

Found by the `/todo` orchestrator's Phase 1 baseline on 2026-10-01. The React Compiler diagnosis of the same day had left `.tsx` and `.cjs` scratch copies under `docs/audits/rc-2026-10-01/trial/`; the baseline measured 9819 tests passing, 65 `tsc` errors and 289 ESLint errors, every one of them under that directory and none in tracked code (`npm run check:types | grep -v ^docs/audits` was empty; `git check-ignore -v` confirmed the ignore rule). CI never sees these dirs, so this is local-only, but `preflight:fast` runs a whole-program `tsc` on every push from the main checkout, so a push from a checkout holding scratch files is blocked until they are deleted by hand.

Deferred because the orchestrator never implements changes directly during a run; filed per the CLAUDE.md Low-severity auto-file rule.

## Acceptance Criteria

- [ ] `tsconfig.json` `exclude` lists `docs/audits`, `docs/superpowers` and `docs/research`, and `tsconfig.check.json` (which redefines `exclude` rather than inheriting it) lists the same three, so a stray `.ts`/`.tsx` under any of them no longer fails `npm run check:types`. Verify with a probe: place a deliberately broken `.ts` file under `docs/audits/`, run `check:types`, expect success, delete the probe. Also run the probe WITHOUT the fix once to confirm it would have failed (positive control).
- [ ] `eslint.config.js` top-level `ignores` lists `docs/audits/**`, `docs/superpowers/**`, `docs/research/**`, so `npm run lint` skips them. Same two-sided probe with a `.cjs` or `.ts` file carrying an obvious Prettier violation.
- [ ] The three `no-unused-vars` warnings are gone with no behaviour change to the tests: `server/storage/__tests__/helpers.test.ts` (unused imports `civilDateString`, `civilDateToInstant` on line 3) and `server/services/__tests__/nutrition-coach-finder-tools.test.ts` (unused loop variable `_chunk` in `toolNamesSent`, line 93).
- [ ] From a checkout that still contains the scratch directory, `npm run check:types` exits 0 and `npm run lint` reports 0 errors and 0 warnings in tracked code.

## Implementation Notes

- `tsconfig.json`: extend `exclude` to `["node_modules", "build", "dist", "docs/audits", "docs/superpowers", "docs/research"]`. `tsconfig.check.json` extends it but REPLACES `exclude` (a child `exclude` does not merge with the parent's), so add the same three entries there too.
- `eslint.config.js`: add the three globs to the existing top-level `ignores` array (currently `dist/*`, `server_dist/*`, `.claude/worktrees/**`, `.worktrees/**`, `.stryker-tmp/**`). `npm run lint` is `npx expo lint && node scripts/check-react-compiler-bailouts.js`; the bailout script only walks `client/**`, so it needs no change.
- Do NOT delete or un-ignore anything under `docs/audits/` or its siblings; they are the user's local scratch by design.
- `helpers.test.ts`: delete the unused `civil-date` import line. `nutrition-coach-finder-tools.test.ts`: the `for await (const _chunk of ...)` loop only drains the stream; check how `@typescript-eslint/no-unused-vars` is configured in `eslint.config.js` (an `varsIgnorePattern: "^_"` would already cover it, so the warning means it is not configured that way) and either drain the iterator without a binding or add the ignore pattern, whichever matches existing project convention. Do not change what the test asserts.

## Scope Contract

- **Mechanisms to use:** the existing `exclude` and `ignores` arrays. Nothing new.
- **Files in scope:** `tsconfig.json`, `tsconfig.check.json`, `eslint.config.js`, `server/storage/__tests__/helpers.test.ts`, `server/services/__tests__/nutrition-coach-finder-tools.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- `expo lint` wraps ESLint's flat config; confirm the added `ignores` entries are honoured by running the probe in the acceptance criteria rather than assuming.
- `scripts/preflight.sh --fast` runs its own `tsc`; confirm which tsconfig it loads so the exclusion applies to the push gate too, since that gate is the user-facing symptom.

## Updates

### 2026-10-01

- Initial creation, filed by the `/todo` orchestrator after its Phase 1 baseline check.
