---
title: fileURLToPath(new URL(import.meta.url)) fails tsc under the DOM-lib tsconfig — use process.cwd() in source-scanning tests
track: bug
category: code-quality
module: server
severity: low
tags: [typescript, tsc, dom-lib, url, import-meta, fileurltopath, vitest, source-scan]
symptoms: ['tsc error TS2345: Argument of type ''URL'' is not assignable to parameter of type ''string | URL''', 'Type ''URL'' is not assignable to type ''import("url").URL''. The types returned by ''searchParams[Symbol.iterator]()'' are incompatible', Code runs fine under Vitest/esbuild but the CI type-check (tsc --noEmit) fails]
applies_to: ['**/*.test.ts', scripts/**/*.ts]
created: '2026-06-26'
---

# fileURLToPath(new URL(import.meta.url)) fails tsc under the DOM-lib tsconfig — use process.cwd() in source-scanning tests

## Problem

A test (or script) that resolves a directory from its own location with the idiomatic
`fileURLToPath(new URL("..", import.meta.url))` compiles and runs under Vitest (esbuild strips types), but the CI `tsc --noEmit` gate rejects it: the `URL` passed to `fileURLToPath` is the wrong `URL`.

## Symptoms

- `tsc` error `TS2345: Argument of type 'URL' is not assignable to parameter of type 'string | URL'` at the `fileURLToPath(...)` call.
- The follow-on note blames `searchParams[Symbol.iterator]()` incompatibility between the two `URL` types.
- Green under `vitest run`, red only at the type-check step — easy to miss locally if you rely on the runner.

## Root Cause

The shared `tsconfig` includes the DOM lib, so the global `URL` resolves to the **DOM `URL`**, not Node's `url.URL`. `node:url`'s `fileURLToPath` is typed to accept `string | import("url").URL`, and the DOM `URL` is structurally incompatible (its iterators differ). esbuild never type-checks, so the mismatch only surfaces under `tsc`. This is the same DOM-vs-Node global clash already worked around for `setInterval` in `server/middleware/auth.ts` (it returns the DOM `number` overload, cast to `NodeJS.Timeout`).

## Solution

In a test or script that needs a project path, anchor on `process.cwd()` instead of `import.meta.url`. Vitest runs anchored at the project root (it resolves `cwd` to the directory containing `vitest.config.ts`), and repo scripts (e.g. `scripts/coverage-ratchet.ts`) already rely on this:

```ts
// ✗ Fails tsc under the DOM-lib tsconfig:
const DIR = fileURLToPath(new URL("..", import.meta.url));

// ✓ Type-clean and cwd-anchored:
const DIR = path.join(process.cwd(), "server", "routes");
```

Document the `cwd` assumption in a comment so a future contributor doesn't "fix" it back to the `import.meta.url` form (a plausible suggestion — it *is* more cwd-robust in plain Node, but it does not compile here).

## Prevention

- Never trust a green `vitest run` as proof of type-safety; the CI gate runs `tsc --noEmit` separately.
- When a Node-only API rejects a `URL`/timer/global in this repo, suspect the DOM lib first.

## Related Files

- `server/routes/__tests__/auth-route-wiring.test.ts` — uses `process.cwd()` for the route source scan
- `server/middleware/auth.ts` — the parallel `setInterval` DOM-overload workaround

## See Also

- [route-tests-mock-auth-hide-wiring-seam-2026-06-26.md](../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md) — the source-scanning test where this gotcha surfaced
