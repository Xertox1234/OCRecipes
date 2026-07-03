---
title: Pre-commit runs ESLint without type-aware rules — run type-aware ESLint before pushing
track: knowledge
category: conventions
module: client
tags: [eslint, type-aware, pre-commit, ci, no-floating-promises, tooling]
applies_to: ['**/*.ts', '**/*.tsx']
created: '2026-06-19'
---

# Pre-commit runs ESLint without type-aware rules — run type-aware ESLint before pushing

## Rule

A green local commit does **not** imply a green CI lint. The Husky pre-commit
hook runs lint-staged with `ESLINT_NO_TYPE_AWARE=1 eslint --fix`, which **skips
all type-aware rules**. CI runs the full type-aware lint. So rules like
`@typescript-eslint/no-floating-promises` and `no-misused-promises` are invisible
at commit time and only fail in CI. Before pushing `.ts` / `.tsx` changes, run
`npx eslint <changed files>` **without** the env flag to catch them locally.

## Smell patterns

- A floating async IIFE: `(async () => { ... })();` (e.g. inside a `useEffect`).
- An unawaited promise whose result is discarded.
- An `async` function passed to a `() => void` callback prop.

All three pass pre-commit and `tsc --noEmit`, then fail CI's "Lint · Types ·
Patterns" step with exit 1.

## Why

The pre-commit deliberately disables type-aware rules for speed — they require
building the full TypeScript project graph, which is too slow for a per-commit
hook. CI has the time budget and runs them. The two lints are therefore **not
equivalent**, and `tsc` clean + pre-commit clean is a weaker signal than CI lint.

## Examples

```bash
# CI-equivalent lint on just what you changed (no env flag = type-aware ON):
git diff main...HEAD --name-only --diff-filter=d | grep -E '\.(ts|tsx)$' | xargs npx eslint
```

```ts
// Fix for a floating IIFE flagged by no-floating-promises:
void (async () => {
  await doThing();
})();
```

## Exceptions

None for correctness — but it is legitimate to skip the local type-aware run and
rely on CI, *if* you expect and accept a possible push→fail→fix round-trip. The
repo's standing guidance is "let CI enforce the gate"; this convention is the
caveat: the *pre-commit* gate is not that gate.

## Related Files

- `.husky/pre-commit`, `package.json` (`lint-staged`, `lint` scripts)
- `.github/workflows/ci.yml` — "Lint · Types · Patterns" (full type-aware lint)

## See Also

- [vitest4 mock new needs real class not arrow vifn](../runtime-errors/vitest4-mock-new-needs-real-class-not-arrow-vifn-2026-06-19.md) — another local-passes / CI-or-runtime-fails gotcha
