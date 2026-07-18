---
title: "A shell-exported NODE_ENV=production breaks the entire vitest jsdom path — builtin externalization crash, then production React without act"
track: bug
category: runtime-errors
module: client
severity: high
tags: [testing, vitest, vite, node-env, jsdom, environment]
symptoms: ["No such built-in module: node:", "ERR_UNKNOWN_BUILTIN_MODULE at collection time on every RN component test", "React.act is not a function on every render test", "Module node:module has been externalized for browser compatibility warning naming test/setup.ts", "CI green on the same commit while every local jsdom test fails", "pure-function (node-env) tests unaffected"]
created: 2026-07-17
---

# A shell-exported NODE_ENV=production breaks the entire vitest jsdom path

## Problem

Every RN component test (the `// @vitest-environment jsdom` path) failed at
collection with `Error: No such built-in module: node:`
(`ERR_UNKNOWN_BUILTIN_MODULE`), preceded by a vite warning that
`test/setup.ts`'s `node:module` import "has been externalized for browser
compatibility." After working around the crash, every test then failed with
`React.act is not a function`. Pure-function (node-env) tests passed. CI was
green on the same lockfile the whole time.

## Root Cause

The invoking shell had `NODE_ENV=production` exported. Vite's transform
pipeline runs in the parent vitest process and reads the shell value — the
repo `.env` (`NODE_ENV="development"`) is irrelevant because dotenv loads
inside the *worker* at setup time, after transforms. Production mode flips the
resolve conditions for the jsdom ("client"-consumer) module graph, with two
independent casualties:

1. `test/setup.ts`'s static `import { createRequire } from "node:module"` is
   externalized into a browser-compat stub that crashes collection.
2. `react` resolves to its production build, which does not export `act`, so
   `@testing-library/react` throws `React.act is not a function` in every test.

CI never sets `NODE_ENV`, so CI is immune — the classic signature here is
**local-only failure with green CI on an identical lockfile**.

This supersedes the "transient contention" conclusion in
`vitest-collection-crash-transient-contention-2026-07-16.md`: the apparent
transience was which shell (with or without the export) ran the probe.

## Eliminated on the way (all reproduced the crash, ruling each out)

Both checkouts (main + worktree, so not worktree-specific) · `CI=1` env ·
Node 22.20 and 24.9 (not runtime-version drift) · a fresh vite `cacheDir`
(not stale dep-optimizer cache) · installed vitest/vite exactly matched the
lockfile (not install drift).

## Solution

Two independent hardenings (either alone fixes its own layer; both applied):

1. `test/setup.ts` — resolve the builtin at runtime, invisible to static
   analysis: `const { createRequire } = process.getBuiltinModule("node:module")`
   (Node ≥22.3).
2. `vitest.config.ts` — normalize the mode at config load, before any
   transform: `if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";`
   Tests never legitimately transform under production conditions (the DB
   guard in setup.ts refuses production databases outright).

## Prevention

- When local vitest breaks while CI is green on the same commit, check
  `echo $NODE_ENV` **first** — before version drift, cache, or Node-version
  theories. It is the cheapest probe and was the actual answer.
- Never statically `import` a node builtin in a file that is part of the
  jsdom test module graph (`test/setup.ts`, mocks) — use
  `process.getBuiltinModule` if one is needed.

## Related Files

- `test/setup.ts` — runtime builtin resolution.
- `vitest.config.ts` — NODE_ENV normalization guard.
- `docs/solutions/runtime-errors/vitest-collection-crash-transient-contention-2026-07-16.md` — superseded diagnosis of the same signature.
