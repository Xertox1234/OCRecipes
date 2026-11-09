---
title: "Type-aware lint already peaks near CI's ~4 GB default heap — a typescript-eslint minor bump (8.59 → 8.72) tipped it into an OOM"
track: bug
category: performance-issues
module: shared
severity: medium
tags: [eslint, typescript-eslint, oom, type-aware-lint, architecture, tooling, typescript]
symptoms: ["CI 'Lint · Types · Patterns' fails with 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory'", "lint job exit code 134 with no lint errors reported", "main passes lint but a dependency-bump PR fails it"]
applies_to: [eslint.config.js, package.json]
created: 2026-11-09
---

# Type-aware lint already peaks near CI's ~4 GB default heap — a typescript-eslint minor bump (8.59 → 8.72) tipped it into an OOM

## Problem

A routine in-range dependency refresh (#1815) bumped `typescript-eslint` 8.59.4 → 8.72.1. CI's lint job died with a V8 heap OOM (exit 134) on that PR and on every PR stacked on it; `main` stayed green. The push gate (`preflight:fast`) lints changed files only, so it never ran the full type-aware lint and passed.

## Root Cause

Not a leak — headroom. CI sets no heap flag: the lint job runs with Node's default old-space limit, which on the GitHub runner is about 4 GB (the CI OOM log shows the heap at `4064.6 (4090.7) MB`). Measured locally with `--max-old-space-size=4096` standing in for that default, same tree, only typescript-eslint varied:

| typescript-eslint | exit | peak RSS |
| ----------------- | ---- | -------- |
| 8.72.1            | 134 (OOM) | ~3.1 GB |
| 8.59.4 (control)  | 0    | ~2.9–3.2 GB |

Full type-aware lint of this repo already uses most of the cap, so a minor bump that adds a little per-program memory crosses it.

## Solution

Held `typescript-eslint` at `^8.59.4` and rebuilt the lockfile from main's (`git show origin/main:package-lock.json > package-lock.json && npm install`) so every hoisted `@typescript-eslint/*` matches main — pinning only the meta package leaves the hoisted parser/plugin at the new version (another dependent, `eslint-config-expo`, accepts `^8.59.0`).

## Prevention

- Before pushing a bump of anything in the lint stack (typescript-eslint, eslint, eslint plugins, `typescript`), run the full lint under a 4 GB heap (the local stand-in for CI's default limit): `NODE_OPTIONS=--max-old-space-size=4096 npx eslint . --quiet` with `/usr/bin/time -l` and read `maximum resident set size`.
- The headroom is a standing risk (≈3 GB of ~4 GB): giving the lint job more heap (an explicit `NODE_OPTIONS=--max-old-space-size=…` in `ci.yml`, which it does not have today) or splitting the lint is a separate decision for the owner — don't do it inside a dependency PR.

## Related Files

- `package.json` (`typescript-eslint` range), `eslint.config.js`
- `.github/workflows/ci.yml` (the lint job — runs with Node's default heap; no `NODE_OPTIONS`)

## See Also

- [stale stryker sandbox OOMs type-aware ESLint](../runtime-errors/stryker-sandbox-ooms-type-aware-eslint-exit-0-2026-06-12.md) — a different cause of the same OOM
- [verifying a dependency bump](../best-practices/verifying-a-dependency-bump-before-push-2026-11-09.md) — the checklist this belongs to
