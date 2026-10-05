---
title: "An ESM direct-run guard (`import.meta.url === pathToFileURL(process.argv[1]).href`) silently does nothing when the script is launched through a symlinked path — realpath the tmpdir in spawn tests and assert positive output"
track: knowledge
category: conventions
module: shared
tags: [harness, testing, node, esm, symlink, macos]
applies_to: ["scripts/**/*.mjs", "scripts/**/*.ts", "scripts/__tests__/**"]
created: 2026-10-02
---

# Realpath tmpdir and assert positive output for ESM-guarded scripts

## Rule

1. In a test that spawns a direct-run-guarded script from a temp tree,
   `realpathSync` the temp directory before building any path from it.
2. Assert positive output (a file the script wrote, a known stdout line),
   never only the exit code or silence, so a script that did not run fails the test.
3. Direct-run guards compare realpaths on both sides
   (`realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])`,
   catch -> `false`), and a spawn test launches the script through an explicit
   symlink, asserting `realpathSync(link) !== link` first so the test is not
   vacuous on a Linux runner whose tmpdir has no symlink.

## Smell patterns

- A spawn test whose assertions would all still hold if the script printed
  nothing and did nothing (exit status only, or "stdout is empty").
- A `mkdtempSync(path.join(os.tmpdir(), ...))` directory that a guarded script is
  copied into or launched from, without `realpathSync`.

## Why

Six repo scripts guard their `main()` with
`const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; } })(); if (isMain) { main(); }`
so the file can also be imported by unit tests without running (the original
shape, `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`,
is the one that no-ops through a symlink, measured below):
`scripts/ci/mutation-on-diff.mjs`, `scripts/mutation-explore.mjs`,
`scripts/check-react-compiler-bailouts.js`, `scripts/coverage-ratchet.ts`,
`scripts/todo-scheduler.ts` and `scripts/verify-barcode-cache-candidates.ts`
(found by grep on 2026-10-02). The measurement below is on the `.mjs` script.
Measured 2026-10-02 under tsx 4.22.3 as well: the same false/true split.

Measured 2026-10-02 (Node v24.20.0, macOS): running
`node <symlinked directory>/scripts/ci/mutation-on-diff.mjs <list file>`
exits 0 with empty stdout and empty stderr; `main()` never ran, although the
relative import of `../../stryker.targets.mjs` still resolved. The same command
through the real path printed the summary. The mechanism consistent with that
result: the ESM loader resolves the main module through realpath, so
`import.meta.url` holds the real path, while `process.argv[1]` keeps the path as
it was given; the two `file:` URLs differ and the guard is false. The failure is
silent: exit status 0, no output.

On macOS `os.tmpdir()` returns `/var/folders/...`, and `/var` is a symlink to
`/private/var`. A test that copies the script into such a tmpdir and spawns it
from there hits exactly this: the script exits 0 having done nothing, and a test
that asserts only the exit status, or the absence of output, passes without ever
running it. A Linux CI runner is not expected to have such a symlink in its
temp path (not measured here), so the vacuous pass is a trap that can hide a
regression on a developer machine.

## Examples

- Good pattern: `makeTree` in
  `scripts/__tests__/mutation-on-diff-select-only.test.ts` calls
  `realpathSync(mkdtempSync(path.join(tmpdir(), "mutation-select-")))`;
  `scripts/__tests__/check-rules-file-size.test.ts` (`makeRepo`) does the same
  for a related path-prefix reason.
- Bad pattern: spawning a guarded script from a tmpdir without `realpathSync`:
  the script exits 0 silently and the test never runs the logic.

## Exceptions

A script launched only through paths with no symlink component (`npm run` from a
repo path that has none) does not hit the mismatch; the hazard is a symlinked
tmpdir or checkout path.

## Related Files

- `scripts/ci/mutation-on-diff.mjs`
- `scripts/__tests__/mutation-on-diff-select-only.test.ts`
- `scripts/__tests__/check-rules-file-size.test.ts`
- `scripts/coverage-ratchet.ts`

## See Also

- [../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md): the earlier /var vs /private/var trap, for path-prefix logic, and the "assert the count" rule
- [../code-quality/silence-claim-must-pin-the-stream-it-claims-2026-08-16.md](../code-quality/silence-claim-must-pin-the-stream-it-claims-2026-08-16.md): pin silence on the stream you own
- [../logic-errors/literal-prefix-strip-fails-on-a-symlinked-path-spelling-2026-09-29.md](../logic-errors/literal-prefix-strip-fails-on-a-symlinked-path-spelling-2026-09-29.md): the same family in bash: a resolved path compared with an as-typed one silently disagrees