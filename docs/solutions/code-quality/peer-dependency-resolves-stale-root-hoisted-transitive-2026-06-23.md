---
title: 'A peerDependency resolves the wrong root-hoisted transitive — declare it directly, overrides can''t fix placement'
track: bug
category: code-quality
module: shared
severity: medium
tags: [npm, dependencies, peer-dependencies, esbuild, vite, lockfile, hoisting, build-tooling]
symptoms: ['`npm ls` exits non-zero with `ELSPROBLEMS` / `invalid: "<range>"` on a transitive package', A peer dependency (e.g. vite's `esbuild`) shows `invalid` even though a compatible version exists elsewhere in the tree, A CLI tool invoked from an npm script (e.g. `esbuild server/index.ts`) silently runs on a stale version nobody declared, npm `overrides` entries don't clear the warning — the wrong version stays hoisted at root]
applies_to: [package.json, package-lock.json]
created: '2026-06-23'
last_updated: '2026-09-25'
---

# A peerDependency resolves the wrong root-hoisted transitive — declare it directly, overrides can't fix placement

## Problem

A package declared as a **`peerDependency`** resolves esbuild/etc. by walking up to the nearest `node_modules/<pkg>` — i.e. the **root-hoisted** copy. If nothing in the repo declares that package *directly*, the root slot gets filled by accident with whatever a deeper, often-deprecated transitive chain hoists there. The result: a standing `npm ls` `ELSPROBLEMS`, and — worse — any CLI you invoke by bare name from an npm script silently runs on that accidental version.

Concrete instance in this repo: `vite@8` declares `esbuild` as a **peer** (`^0.27 || ^0.28`). Nothing declared esbuild directly, so the root `node_modules/esbuild` was filled with `0.18.20` dragged in by the deprecated `@esbuild-kit/core-utils` chain (`~0.18.20`). vitest's transform toolchain *and* `server:build` (`esbuild server/index.ts …`, esbuild undeclared) both ran on that 9-major-stale copy.

## Symptoms

- `npm ls esbuild` → `esbuild@0.18.20 invalid: "^0.27.0 || ^0.28.0" from node_modules/vitest/node_modules/vite`, exit code non-zero (`ELSPROBLEMS`).
- The mis-resolved package is a **peer** of its consumer (`npm view <consumer>@<ver> peerDependencies.<pkg>` shows it; `dependencies.<pkg>` is empty).
- An npm script invokes the package's CLI by bare name with the package absent from `dependencies`/`devDependencies` (`npm view` / grep the `scripts` block).

## Root Cause

Two facts compound:

1. **A peer dependency is not nested.** Unlike a regular dependency (npm gives it a private nested copy when the hoisted one is incompatible), a peer is resolved by ordinary Node module resolution — it takes whatever is hoisted to root.
2. **npm `overrides` control version, not placement.** An override forces the *version* of a dependency edge; it does not decide *which* copy hoists to root, and it cannot inject a nested copy for a *peer* edge. Both a top-level `"esbuild": "^0.28"` and a scoped `"vite": { "esbuild": "^0.28" }` were tried here and **neither** moved the root hoist (empirically confirmed): npm kept hoisting the deprecated chain's `0.18.20` and vite's peer kept resolving it.

So the only lever that actually fixes a peer mis-resolution is **changing what is hoisted to root**.

## Solution

**Declare the package as a direct `devDependency`** at the version the peer consumer wants. A direct dependency deterministically claims the root `node_modules` slot — the hoist lever `overrides` can't pull.

```diff
  "drizzle-kit": "^0.31.4",
+ "esbuild": "^0.28.0",
  "eslint": "^9.25.0",
```

Result (`npm ls esbuild` now clean, exit 0):

- root → `esbuild@0.28.1` → vite's peer `^0.27 || ^0.28` ✅ and `server:build` CLI ✅
- `@esbuild-kit/core-utils` → auto-nests its own `0.18.20` (valid for its `~0.18.20`) ✅ — drizzle-kit `db:push` loader untouched
- `drizzle-kit`'s own `esbuild@^0.25.4` → keeps its nested `0.25.12` ✅

No `overrides` entry needed. This is **not** a "blunt override" (a single global pin that breaks one consumer) — each consumer keeps an in-range copy.

**Caret caveat for `0.x` packages:** `^0.28.0` means `>=0.28.0 <0.29.0` (npm locks the minor for `0.x`). That's the correct conservative pin given esbuild breaks API between minors; when the peer consumer (vite) widens its range to include `^0.29`, bump this pin to match.

## Prevention

- **Declare any package you invoke as a bare-name CLI from an npm script** as a direct `devDependency` — never rely on a transitive hoisting it to root.
- **The same rule applies to `require()`/`import` inside a script, not just a shell CLI invocation.** Found 2026-09-25 in code review of `scripts/check-react-compiler-bailouts.js`: the script does `require("@babel/core")`, `require.resolve("@babel/preset-typescript")`, and `require.resolve("@babel/plugin-syntax-jsx")`, but none of the three is declared in `package.json` — they resolve today only because `babel-preset-expo` transitively hoists them to root (confirmed against `package-lock.json`: all three are reachable solely as transitive deps of `babel-preset-expo`/`@react-native/babel-preset`/`@babel/preset-react`). The failure mode differs from the CLI case (a `Cannot find module` throw instead of a silently-stale version) but the root cause and the fix are identical. This is a higher-stakes instance than most: the script is chained with `&&` onto `npm run lint` (both CI's lint step and full `npm run preflight`), so a future unrelated dependency bump that shifts hoisting would hard-fail `npm run lint` everywhere with an error bearing no obvious connection to whatever actually changed. Left unfixed on the PR that found it (advisory review, one-review-pass policy — `docs/AI_WORKFLOW.md`) — this file exists so the next person who touches that script (or writes a similar one) declares the direct devDependency instead of relying on the same hoist a second time.
- When a peer dependency shows `invalid` in `npm ls`, fix the **root hoist** (declare it directly), don't reach for `overrides` first.
- Re-run `npm ls <pkg>` and confirm exit 0 after the change; verify each consumer (here: vitest transform, `server:build`, `drizzle-kit --version`) still works on the new root version.

## Related Files

- `package.json` — `devDependencies` (the direct declaration) and `scripts.server:build` (the bare-name CLI invocation)
- `package-lock.json` — the resolved tree (verify semantically, see See Also)
- `todos/archive/P3-2026-06-01-dependabot-triage-3-medium-transitive.md` — the full diagnosis history (this fix overturned a "blocked on upstream" mislabel)
- `scripts/check-react-compiler-bailouts.js` — the unfixed `require()`-on-a-transitive instance found 2026-09-25 (Prevention)

## See Also

- [verify lockfile churn semantically, not by diff line count](../conventions/verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — the companion verification rule for the lockfile this fix regenerates
