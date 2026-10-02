---
title: A gitignored local-only dir must be excluded from tsc AND ESLint together — three lists, and a two-sided probe whose fixtures use distinct basenames
track: knowledge
category: best-practices
module: shared
tags: [typescript, testing, tooling, eslint, tsconfig]
applies_to: [tsconfig.json, tsconfig.check.json, eslint.config.js]
created: 2026-10-02
---

# A gitignored local-only dir must be excluded from tsc AND ESLint together

## Rule

`.gitignore` (lines 104–106) hides `docs/superpowers/`, `docs/audits/` and `docs/research/` (local AI-workflow history). Neither tsc nor ESLint reads `.gitignore`, so a stray `.ts`/`.tsx`/`.cjs` left there fails `npm run check:types`, `npm run lint` and the push gate (`scripts/preflight.sh --fast` runs `npm run check:types`, a whole-program tsc) only in a local checkout. CI never sees these directories.

1. Keep **three lists** in sync:
   - `tsconfig.json` `exclude` (bare directory names, root-anchored, one entry per line: Prettier reflows a one-liner this long)
   - `tsconfig.check.json` `exclude` (a child `exclude` replaces the parent's instead of merging, so repeat the entries)
   - `eslint.config.js` global-ignores object (the object whose only key is `ignores`, entries written `dir/**`; an object that also has `files` is not global)

2. Land the tsconfig and ESLint edits together. With `typescript-eslint`'s `projectService`, a `.ts`/`.tsx` that tsconfig excludes but ESLint still reaches fails with "was not found by the project service" (a parse error) instead of being skipped; a `.cjs` is unaffected. A reviewer reproduced this with the new tsconfig plus the old ESLint config: 12 of 12 ts/tsx fixtures gave that error.

3. Prove the change with a **two-sided probe**: broken fixtures for each directory and each extension (`.ts`, `.tsx`, `.cjs`) at the real nesting depth, plus a **control** under a non-excluded sibling (`docs/zz-probe-control/`) that must still fail. Run it before and after. Measured here: before the fix `tsc --noEmit` exited 2 with 8 TS2322 errors (both tsconfigs) and ESLint flagged 12 files; after, only the control failed (2 tsc errors, 3 ESLint files).

4. **Fixture basenames must differ per extension.** TypeScript's `include` keeps `probe.ts` and silently drops `probe.tsx` in the same directory, so the `.tsx` never enters the program and that half of the probe passes for the wrong reason. Assert the denominator, not only the exit code: how many fixtures `tsc --listFilesOnly` listed (8 before, 2 after) and how many files ESLint linted (12 before, 3 after under `docs/`; 1460 before, 1451 after for the whole repo). Run ESLint probes with `ESLINT_NO_TYPE_AWARE=` set to the empty string, which keeps the type-aware block ON exactly as `npm run lint` does.

5. Probing through `expo lint`: put ESLint-only flags (`--format json`) after `--` — one placed before `--` makes the arg parser throw `BAD_ARGS` (`Unexpected: --format`) before the env load and the lint run. By convention keep expo's own flags (`--no-cache`, `--fix`, `--quiet`) before `--`; placed after it they are forwarded to ESLint, which also accepts them. It prints a two-line `env: load .env` / `env: export` preamble to STDOUT before the JSON only when a `.env` is loaded and at least one of its variables was not already exported — nothing on a fresh clone, in CI or in an `Agent` worktree (no `.env`), when every key is already exported, or under `EXPO_NO_DOTENV=1` — so `tail -n +3` would swallow the single JSON line there and `jq length` would print nothing with exit 0; keep the first line that starts with `[` instead (`grep -m1 '^\['`). It caches by default (pass `--no-cache` to rule out a stale hit), and a single explicitly named ignored file prints a "File ignored because of a matching ignore pattern" warning instead of staying silent, so probe a directory.

## Why

A clean exit from a tool that never loaded the file looks identical to a clean exit from a tool that checked it, so the probe needs a denominator (how many fixtures the tool actually saw) and a control that must still fail. The 2026-10-01 `/todo` baseline measured 65 tsc errors and 289 ESLint errors, every one under `docs/audits/rc-2026-10-01/trial/` and none in tracked code. Without the three lists in sync, local gates go red in a checkout holding scratch files while CI stays green.

## Examples

`tsconfig.json`:

```json
"exclude": [
  "node_modules",
  "build",
  "dist",
  "docs/audits",
  "docs/superpowers",
  "docs/research"
]
```

`tsconfig.check.json` repeats the three after `dist` (its `exclude` also carries the test globs):

```json
"exclude": [
  "node_modules",
  "build",
  "dist",
  "docs/audits",
  "docs/superpowers",
  "docs/research",
  "**/__tests__/**"
]
```

`eslint.config.js`, in the global-ignores object:

```js
ignores: [
  "dist/*",
  "server_dist/*",
  ".claude/worktrees/**",
  ".worktrees/**",
  ".stryker-tmp/**",
  "docs/audits/**",
  "docs/superpowers/**",
  "docs/research/**",
],
```

The denominator commands (in a session where a hook rewrites commands, run them as `rtk proxy <cmd> | ...` so the pipe sees raw output):

```bash
# fixtures inside tsc's program: 8 before the fix, 2 after (the control's)
npx tsc --noEmit --listFilesOnly | grep -c zz-probe
# files ESLint linted under docs/: 12 before the fix, 3 after (the control's)
ESLINT_NO_TYPE_AWARE= npx eslint -f json docs | jq length
# the same through the wrapper: its own flags before `--`, ESLint's after; keep
# only the JSON line (the env preamble is two lines or absent, never one)
ESLINT_NO_TYPE_AWARE= npx expo lint docs --no-cache -- --format json | grep -m1 '^\[' | jq length
```

## Exceptions

- `tsconfig.check.json` is loaded by no script or workflow (`check:types` is `tsc --noEmit`, which loads `tsconfig.json`; preflight and CI run that), so its entries are for consistency only.
- A tsconfig `exclude` only filters `include` roots: a scratch file imported by an included file is still pulled into the program.

## Related Files

- `tsconfig.json`
- `tsconfig.check.json`
- `eslint.config.js`
- `.gitignore`
- `scripts/preflight.sh`
- `todos/archive/P3-2026-10-01-local-lint-types-scan-gitignored-docs-dirs.md`

## See Also

- [Vite native config loader migration](vite-native-config-loader-mts-migration-2026-09-23.md) — hardcoded `tsconfig.check.json` exclude literals and the eslint-config-expo parser gap
- [A verification that scans zero inputs](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — assert the count, not only the exit code
- [ESLint flat config plugin glob scope](../conventions/eslint-flat-config-plugin-glob-scope-2026-06-03.md) — a flat-config block that references a plugin the matched files never registered
- [A root .mjs and the tsc program](../conventions/root-mjs-outside-tsc-program-ts-check-is-editor-only-2026-10-01.md) — which files enter tsc's program
- [Piping a hook-proxied command](../conventions/piped-proxied-command-filters-rewritten-output-2026-08-08.md) — the pipe filters the proxy's rewritten output, not the command's
