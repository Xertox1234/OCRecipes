---
title: Stale .stryker-tmp sandbox OOMs type-aware ESLint — and the crash exits 0
track: bug
category: runtime-errors
module: shared
severity: medium
tags: [eslint, stryker, mutation-testing, oom, type-aware-lint, tooling]
symptoms: ['`npm run lint` prints a V8 native stack trace ending in `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`', The npm/expo-lint wrapper still exits 0 despite the child crash — looks like a phantom failure or a trailing-echo artifact, 'With a raised heap (`NODE_OPTIONS=--max-old-space-size=8192`), lint instead reports ~800 parsing errors: `<repo>/.stryker-tmp/sandbox-*/... was not found by the project service`', 'CI lint is green while local lint crashes — the sandbox is gitignored, so only machines that ran Stryker are affected']
applies_to: [eslint.config.js, stryker.conf.*, tsconfig.json]
created: '2026-06-12'
---

# Stale .stryker-tmp sandbox OOMs type-aware ESLint — and the crash exits 0

## Problem

After a Stryker mutation-testing run, a stale `.stryker-tmp/sandbox-*/` directory (a full copy of the repo) is left behind. The next `npm run lint` walks it: type-aware ESLint's project service tries to parse an entire second copy of the codebase, blows the default ~4GB V8 heap, and dies — but `expo lint` swallows the child's crash and exits 0, so scripts and orchestrators that trust exit codes see a "pass" with a stack trace in the output.

## Symptoms

- `npm run lint` output ends in a node OOM native stack trace, yet `$?` is 0.
- Raising the heap converts the crash into ~800 `was not found by the project service` parsing errors, all under `.stryker-tmp/`.
- CI is unaffected (sandbox is gitignored), so the failure looks machine-local and intermittent.

## Root Cause

`.gitignore` does not constrain tools that walk the filesystem directly. Type-aware ESLint enumerates files itself; `.stryker-tmp` was in `.gitignore` but not in `eslint.config.js` `ignores`, so the linter parsed repo × 2. The exit-0 masking is the `expo lint` wrapper not propagating the child process's failure.

## Solution

Add the sandbox to ESLint's own ignore list (`eslint.config.js`, fixed in `0b44f02c`):

```js
ignores: [
  "dist/*",
  "server_dist/*",
  ".claude/worktrees/**",
  ".worktrees/**",
  ".stryker-tmp/**",
],
```

## Prevention

- When introducing any tool that materializes a repo copy or large temp tree (Stryker sandbox, codegen output, `.claude/worktrees`), add its directory to **every** tree-walking tool's own ignore (ESLint `ignores`, `tsconfig` `exclude`, Vitest `exclude`) — gitignore alone is never enough.
- Never trust a wrapper CLI's exit code alone: grep the output for `FATAL ERROR`/OOM signatures before declaring lint green (this repo already mandates exit-code skepticism for trailing-echo artifacts; this is the inverse case — a false 0).

## Related Files

- `eslint.config.js` — the `ignores` block
- `.gitignore:113` — `.stryker-tmp/` (necessary but not sufficient)

## See Also

- [vitest-mock-missing-export-masked-by-catch](vitest-mock-missing-export-masked-by-catch-2026-06-10.md) — same theme: a real failure masked by a layer that swallows it
- [gated mutation testing hard exclusion](../best-practices/gated-mutation-testing-hard-exclusion-2026-06-05.md) — the Stryker setup that produces the sandbox
