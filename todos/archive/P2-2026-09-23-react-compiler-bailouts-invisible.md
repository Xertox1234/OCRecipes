---
title: "React Compiler silently skips 61 of 226 client .tsx files, and nothing in lint or CI surfaces a bailout"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance, tooling]
github_issue:
---

# React Compiler silently skips 61 of 226 client .tsx files, and nothing in lint or CI surfaces a bailout

## Summary

The project rule "React Compiler is ACTIVE — don't add manual memo" holds only for components that actually compile. Measured on 2026-09-23: 61/226 client `.tsx` files contain a skipped component, including CoachChat, HomeScreen, MealPlanHome and RecipeBrowser. There is no lint or CI signal.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M1** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Skip reasons (babel-plugin-react-compiler 1.0.0 with a logger, positive control ThemedText compiles): value mutation 29, `eslint-disable` of react-hooks rules inside the function 27, ref access during render 25, `try/finally` (unsupported in 1.0.0) 21, memo-not-preserved 5. The measurement recipe is in the manifest's Post-Audit Notes and the `react_compiler_active` memory.
- `eslint-plugin-react-hooks` is 5.2.0 (transitive via eslint-config-expo), which predates the compiler lint rules. `babel-plugin-react-compiler` is not pinned in package.json.
- `docs/rules/performance.md:10` states the premise unqualified, and reviewers use it as a dedup rule.
- Research (react.dev: panicThreshold default `none`; eslint-plugin-react-hooks `recommended-latest`; compiler source `DEFAULT_ESLINT_SUPPRESSIONS` scope = whole function): `confirmed`.

## Acceptance Criteria

- [ ] A CI-enforced signal exists for NEW bailouts: either `eslint-plugin-react-hooks` v6+/v7 with the compiler rules, or a script that uses the compiler logger and fails on bailouts beyond a checked-in baseline of the current skipped set
- [ ] `babel-plugin-react-compiler` pinned explicitly in devDependencies
- [ ] `docs/rules/performance.md` qualified: manual memo is redundant only for components that compile; how to check
- [ ] Regenerate `.github/copilot-instructions.md` if docs/rules changed (`npm run build:copilot-instructions`)
- [ ] Do NOT fix the 61 bailouts here — this todo makes them visible; hot-screen instances are tracked in their own todos

## Implementation Notes

A baseline-ratchet script (like the type-aware ESLint ratchet) is the least disruptive option. Upgrading react-hooks to v7 could introduce new lint errors repo-wide — measure before choosing.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `eslint.config.js`
  - `package.json`
  - `scripts/ (new check script if chosen)`
  - `docs/rules/performance.md`
  - `.github/copilot-instructions.md (regenerated)`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A lint-plugin major bump can cascade into many new errors; the ratchet approach avoids a big-bang fix.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M1).

### 2026-09-25 — Scope Contract deviation (acceptance criteria win)

- **Chose the baseline-ratchet script**, not an `eslint-plugin-react-hooks` v6+/v7 upgrade, per
  the Implementation Notes' own risk callout (a major lint-plugin bump can cascade repo-wide).
  Re-derived the audit's exact measurement recipe from `docs/audits/2026-09-23-frontend.md`
  Post-Audit Notes and ran it live against the real tree: 61/226 `client/**/*.tsx` files bail
  out (excluding `__tests__`), matching the audit exactly, including all four named examples
  (CoachChat, HomeScreen, MealPlanHomeScreen, RecipeBrowserScreen). Positive control
  `ThemedText.tsx` compiles clean. Classification bug found and fixed during implementation:
  a naive `events.length > 0` check flags 225/226 files, because `CompileSuccess` is itself a
  logged event per compiled function — the correct test is "any event kind other than
  `CompileSuccess`".
- **AC 1 requires a "CI-enforced signal", but the Scope Contract's "Files in scope" list does
  not include `.github/workflows/ci.yml` or `scripts/preflight.sh`.** First attempt: wire the
  new script as its own step in both files, mirroring the 7 existing sibling `check-*.js`
  scripts (`check-accessibility.js`, `check-hardcoded-colors.js`,
  `check-bottomsheet-backhandler.js`, `check-idor-storage.js`, `check-jsdom-pragma.js`,
  `check-rules-file-size.js`, `check-solution-frontmatter.js`), each of which IS wired into
  both. The advisor (consulted mid-implementation, after this first attempt) pointed out a
  narrower fix that stays entirely within the literal Scope Contract file list: chain the new
  check onto the existing `lint` npm script (`package.json`, already in scope) —
  `"lint": "ESLINT_NO_TYPE_AWARE= npx expo lint && node scripts/check-react-compiler-bailouts.js"`.
  `.github/workflows/ci.yml:45` and `scripts/preflight.sh`'s full-mode block both already run
  `npm run lint`, so this gets CI enforcement AND preflight parity for free, with zero workflow
  file edits — deliberately diverging from the 7 siblings' one-step-per-file wiring, for that
  reason. Reverted the ci.yml/preflight.sh edits from the first attempt (`git checkout --`,
  confirmed clean via `git status --short`) in favor of this. Hardened the script against the
  resulting `npm run lint -- <args>` passthrough footgun (args reach the chained script, not
  `expo lint`): an unrecognized argument now exits 2 rather than silently ignoring it, matching
  `scripts/coverage-ratchet.ts`'s "a typo must not silently run in report-only mode" convention.
  Per `docs/solutions/conventions/when-implementation-notes-contradict-acceptance-criteria-the-criteria-win-2026-09-22.md`,
  the acceptance criteria win over a literal Scope Contract reading — but the actual mechanism
  chosen here needed no scope extension at all once the right seam (`lint`) was found.
- `package-lock.json` is also touched (one line) — not in the Scope Contract list either, but
  required: `npm ci` (CI's install step) fails if the lockfile doesn't record the new
  `babel-plugin-react-compiler` devDependency pin. Regenerated via
  `npm install --package-lock-only`; verified with `npm ci --dry-run` before relying on it.
- **TDD**: every sibling `check-*.js` script in `scripts/` has a `scripts/__tests__/check-*.test.ts`
  file — this project's TDD requirement (CLAUDE.md) is a hard rule, not scoped to app code.
  Refactored the script to extract testable pure functions (`findTsxFiles`, `isBailout`,
  `loadBaseline`, `writeBaseline`, `diffBailouts`, `parseArgs`) plus `--root`/`--baseline-file`
  overrides (mirroring `coverage-ratchet.ts`'s `--coverage-file`/`--config-file`), so tests can
  point at a temp fixture tree instead of mutating the real baseline file or scanning the real
  226-file `client/` tree on every run. Added `scripts/__tests__/check-react-compiler-bailouts.test.ts`
  (29 tests). Verified the key regression pin is not vacuous: temporarily reverted `isBailout`'s
  classification to the buggy `events.length > 0` check, confirmed 7 tests go RED (including the
  harness's own positive-control gate), then restored and confirmed GREEN.
- **Verified end to end**: `npm run test:run` (8762/8762 pass), `npm run check:types` (clean),
  `npm run lint` (0 errors, 3 pre-existing unrelated warnings — confirms the chained
  `&& node scripts/check-react-compiler-bailouts.js` runs and passes inside the exact command
  CI executes).
- **Code review (advisory, no blocking findings)**: one real WARNING —
  `scripts/check-react-compiler-bailouts.js` `require()`s `@babel/core`,
  `@babel/preset-typescript`, and `@babel/plugin-syntax-jsx`, none of which is a declared
  `package.json` dependency; they resolve today only via `babel-preset-expo`'s transitive
  hoisting. Per the frozen one-review-pass policy (`docs/AI_WORKFLOW.md` → Review Policy,
  user ruling 2026-09-22), not fixed on this branch — recorded in the executor's
  `DEFERRED_WARNINGS`. One SUGGESTION (tick the Acceptance Criteria checkboxes) was NOT
  applied — it contradicts this repo's own archive convention, verified against
  `todos/archive/P3-2026-09-24-camera-temp-file-cleanup-followups.md` and others, where a
  fully-verified `done` todo keeps every checkbox unchecked and records completion in Updates
  prose instead.

### 2026-09-25 (review repair)

- The three deferred warnings are fixed on this branch (user ruling for this sweep: every PR is repaired before merge). `@babel/core`, `@babel/preset-typescript` and `@babel/plugin-syntax-jsx` are now exact-pinned devDependencies at the installed versions (lockfile changes only the root entry). The earlier note that they resolve "only via `babel-preset-expo`" was wrong: `package-lock.json` shows many dependents of `@babel/core` (e.g. `react-native-worklets`); the solution doc is corrected. The test pinned to `Button.tsx` bailing out is removed: it would break when someone fixes Button, and the `BROKEN_COMPONENT` fixture already covers the bail-out branch.
- Independent review (second round): the ratchet scanned only `.tsx`, but compilation mode "infer" compiles `use*` hooks in plain `.ts` too, and 20 client hooks already bail out (e.g. `useChat.ts`). It now scans `.ts` and `.tsx` (not `.d.ts`), parsing TSX only for `.tsx` like the real build. It also fails with exit 2 if the compiler copy it resolves differs from the one `babel-preset-expo` resolves. After merging current `main`, the baseline is 80/438 (`QuickLogDrawer.tsx` stopped bailing after #1080). The memoization doc now says to memoize the component that bailed, not the whole baseline file. The three generic babel helpers use caret ranges; `babel-plugin-react-compiler` stays exact.
