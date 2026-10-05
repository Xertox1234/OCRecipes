---
title: "ESM direct-run guard no-ops through a symlinked path — compare realpaths on both sides in the six guarded scripts and add a symlink-launch test"
status: in-progress
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, harness, testing]
github_issue:
---

# ESM direct-run guard no-ops through a symlinked path

## Summary

Six scripts guard their `main()` with `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href` so the unit tests can import them without running them. The ESM loader resolves the main module through realpath, so `import.meta.url` holds the real path while `process.argv[1]` keeps the path as given; launched through a symlinked path (macOS `/var` → `/private/var`, or any `ln -s`), the two `file:` URLs differ, the guard is false, and the script exits 0 having done nothing. Replace the comparison with a symmetric realpath check in all six and add one spawn test that launches a script through an explicit symlink and asserts it ran.

## Background

Noticed during the `/todo` sweep PR #1224 (Mutation-on-diff: skip npm ci when no changed module is eligible, merged as 25fcf9da). Its `--select-only` spawn tests hit the silent no-op from a macOS tmpdir and worked around it by `realpathSync`-ing the fixture tree (`scripts/__tests__/mutation-on-diff-select-only.test.ts:131-139`, see the comment there); the convention doc committed in the same PR, `docs/solutions/conventions/esm-direct-run-guard-no-ops-through-a-symlinked-path-2026-10-02.md:19-21`, already prescribes the fix as its rule 3 ("compare realpaths on both sides … add a test that launches the script through a symlink"), but no todo covered it.

Verified 2026-10-02 against main ec26b972: `grep -rn 'pathToFileURL(process.argv[1])'` (node_modules, `.worktrees`, `.stryker-tmp` excluded) finds exactly six sites and nothing else uses that shape (six other scripts use the looser `isMain` IIFE substring check on `argv[1]`, e.g. `scripts/cleanup-junk-recipes.ts:150-156`, which is symlink-tolerant). A live run of the real `scripts/ci/mutation-on-diff.mjs --select-only` with an eligible fixture from a `mktemp -d` dir: via the `/var/...` spelling it exits 0 with empty stdout and no `run=` line; via `/private/var/...` it prints `select-only: 1 eligible module(s), run=true` and writes `run=true`; via a relative path from the symlinked cwd it also works, because the kernel realpaths the cwd. A minimal guard probe shows the same false/true split under `node` v24.20.0 and tsx 4.22.3, which closes the gap the convention doc leaves at :38-39 ("the `.ts` ones run under tsx and were not measured").

Deferred because it is latent only: every current caller uses a relative path (`package.json:18` `node scripts/check-react-compiler-bailouts.js`, `:41` `tsx scripts/coverage-ratchet.ts`, `:43` `node scripts/mutation-explore.mjs`; `.github/workflows/mutation-on-diff.yml:59` and `:77` `node scripts/ci/mutation-on-diff.mjs`; `.claude/skills/todo/SKILL.md:339` `npx tsx scripts/todo-scheduler.ts`; `scripts/verify-barcode-cache-candidates.ts:3-4` documents `npx tsx scripts/...`), no hook or skill invokes any of the six by absolute path, the checkout's realpath is itself, and worktrees live in-repo. Nothing is broken today; the next absolute-path launcher (a hook, a skill, a CI step built on `$GITHUB_WORKSPACE`, a developer under a symlinked checkout) would get a green exit and no work. Not a `.claude/hooks/**` finding. Low severity, filed under the CLAUDE.md Medium/Low auto-file rule.

## Acceptance Criteria

- [ ] All six guards compare realpaths on both sides inside a try/catch IIFE (`realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])`, catch → `false`): `scripts/ci/mutation-on-diff.mjs`, `scripts/mutation-explore.mjs`, `scripts/check-react-compiler-bailouts.js`, `scripts/coverage-ratchet.ts`, `scripts/todo-scheduler.ts`, `scripts/verify-barcode-cache-candidates.ts`. `grep -rn 'pathToFileURL(process.argv' scripts/` returns nothing, and `pathToFileURL` is dropped from each file's `node:url` import (it has no other use in any of the six), so lint stays at zero warnings.
- [ ] A new spawn test in `scripts/__tests__/mutation-on-diff-select-only.test.ts` creates an explicit symlink to the realpath'd fixture tree (`symlinkSync`), asserts it entered the regime (`expect(realpathSync(link)).not.toBe(link)` — `os.tmpdir()` carries no symlink on Linux CI, so a tmpdir-only test would be vacuous there), launches `scripts/ci/mutation-on-diff.mjs --select-only` through the link with an eligible fixture, and asserts positive output: exit 0 and `GITHUB_OUTPUT` equal to `run=true\n`.
- [ ] That test is written first and observed red against the unchanged guard (exit 0, empty stdout, empty `GITHUB_OUTPUT` — the verified no-op), then green after the guard change; the PR body names the red run.
- [ ] Importing each of the six modules from Vitest still does not run `main()`: the existing tests that import them (`scripts/__tests__/mutation-on-diff.test.ts`, `mutation-on-diff-select-only.test.ts`, `coverage-ratchet.test.ts`, `check-react-compiler-bailouts.test.ts`, `todo-scheduler.test.ts`, `verify-barcode-cache-candidates.test.ts`) pass unchanged — a guard that is wrongly true under import would `process.exit` the suite.
- [ ] `scripts/ci/mutation-on-diff.mjs` still imports only `node:` built-ins and `../../stryker.targets.mjs` (`realpathSync` and `fileURLToPath` are built-ins; the bare-tree spawn tests in the select-only file enforce it, since the script runs before `npm ci`).
- [ ] `docs/solutions/conventions/esm-direct-run-guard-no-ops-through-a-symlinked-path-2026-10-02.md` body is updated in the same PR: the quoted guard at :32-33 shows the realpath shape, rule 3 at :19-21 reads as the shipped convention rather than "if a guard is ever changed", and the "were not measured" sentence at :38-39 records the 2026-10-02 tsx 4.22.3 measurement (same false/true split). Frontmatter untouched (single-line `tags:`; `scripts/check-solution-frontmatter.js` runs in lint-staged; `docs/solutions/` is prettierignored).

## Implementation Notes

The guard is verbatim at each site; only the condition changes, the `if` body stays:

- `scripts/ci/mutation-on-diff.mjs:456-461` — body `main();`
- `scripts/mutation-explore.mjs:76-81` — body `main();`
- `scripts/check-react-compiler-bailouts.js:377-382` — body `process.exit(main(process.argv.slice(2)));`
- `scripts/coverage-ratchet.ts:581-586` — same body
- `scripts/todo-scheduler.ts:213-218` — body `process.exit(main());`
- `scripts/verify-barcode-cache-candidates.ts:366-373` — body `void (async () => { process.exit(await main(process.argv.slice(2))); })();`

Replacement, one shape for all six (`import.meta.main` is ruled out: true under node v24.20.0 but `undefined` under tsx 4.22.3, so it would break the three `.ts` guards; the symmetric realpath comparison is the only shape that works for all six):

```js
// Run only when executed directly, not when the unit tests import this file.
// Realpath BOTH sides: the ESM loader realpaths the main module (import.meta.url)
// but process.argv[1] keeps the path as given, so a launch through a symlink
// (macOS /var -> /private/var) made the old href comparison false and the
// script exited 0 having done nothing.
const isMain = (() => {
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
})();
if (isMain) {
  main();
}
```

`realpathSync(undefined)` throws (no `argv[1]` under `node -e` or a REPL) and lands in the catch, so the old `process.argv[1] &&` pre-check is subsumed; an `ENOENT` for a vanished script does too. Keep each file's existing one-line comment about why the guard exists (e.g. `scripts/check-react-compiler-bailouts.js:375-376` "must not scan the real tree or call process.exit").

Import delta per file (`pathToFileURL` is used only in the guard in every one of the six, so it must go or `no-unused-vars` fires):

- `scripts/ci/mutation-on-diff.mjs:26-32` — add `realpathSync` to the existing `node:fs` import block; `:34` becomes `import { fileURLToPath } from "node:url";`. Must stay dependency-free: the workflow runs it before `npm ci` (`.github/workflows/mutation-on-diff.yml:59`).
- `scripts/mutation-explore.mjs:9` — `import { fileURLToPath } from "node:url";` plus a new `import { realpathSync } from "node:fs";` (no `node:fs` import exists today).
- `scripts/check-react-compiler-bailouts.js:67-69` — `fs` default import and `fileURLToPath` already present; drop `pathToFileURL` from `:69`; use `fs.realpathSync`.
- `scripts/coverage-ratchet.ts:27-29` — `import * as fs` and `fileURLToPath` already present; drop `pathToFileURL` from `:29`; use `fs.realpathSync`.
- `scripts/todo-scheduler.ts:28-29` — add `realpathSync` to `:28`'s `node:fs` import; `:29` becomes `fileURLToPath`.
- `scripts/verify-barcode-cache-candidates.ts:29` — `import { fileURLToPath } from "node:url";` plus a new `import { realpathSync } from "node:fs";`.

The test, in `scripts/__tests__/mutation-on-diff-select-only.test.ts`, inside the existing `describe("mutation-on-diff.mjs on a tree with no node_modules", ...)` at `:115`, next to the eligible case at `:211`:

- Build the tree with `makeTree` (`:136`) using the same eligible fixture pair as `:211` (`server/lib/fixture-pure.ts` + `server/lib/__tests__/fixture-pure.test.ts`, changed list `[server/lib/fixture-pure.ts]`). Keep `makeTree`'s `realpathSync` at `:137-139`: the tree itself must be real so the link is the only symlink layer in this test.
- `const linkDir = mkdtempSync(path.join(tmpdir(), "mutation-link-")); dirs.push(linkDir);` then `const link = path.join(linkDir, "repo"); symlinkSync(tree.root, link);` and the regime assertion `expect(realpathSync(link)).not.toBe(link);`. On macOS `linkDir` is already under the `/var` symlink; the explicit `symlinkSync` makes the assertion hold on Linux CI too. `dirs` (`:117`) is swept by the `afterEach` at `:119`; `rmSync` on `linkDir` removes the link, not the real tree, which is in `dirs` on its own.
- Spawn as `run()` (`:166`, `spawnSync` at `:175-179`: `process.execPath`, `cwd: tree.root`, `env` carrying `GITHUB_OUTPUT`/`GITHUB_STEP_SUMMARY`, `encoding: "utf8"`, `timeout: 30_000`) but with the script path built from `link`: either give `run()` an optional root override (default `tree.root`) or spawn inline with `path.join(link, "scripts", "ci", "mutation-on-diff.mjs")`. `cwd` can stay `tree.root`; the script resolves fixture paths against cwd.
- Assert `status === 0`, `output === "run=true\n"` (the script appends `run=${run}\n` to `GITHUB_OUTPUT` at `scripts/ci/mutation-on-diff.mjs:409` and prints `select-only: 1 eligible module(s), run=true` at `:412`), `summary === ""` and `ranHarness === false` — the same positive-output assertions as the `:211` case, so the only new variable is the launch path. Against the unchanged guard this is the verified no-op: exit 0, empty stdout, `output === ""`.
- Add `symlinkSync` to the `node:fs` import at `:15-24`, and rewrite the `makeTree` comment at `:131-134` so it no longer claims the realpath is what keeps the guard true (it stays for the fixture-path reason the convention doc's Examples section gives alongside `check-rules-file-size.test.ts`'s `makeRepo`).

Doc update, body prose only, in `docs/solutions/conventions/esm-direct-run-guard-no-ops-through-a-symlinked-path-2026-10-02.md`: `:19-21` rule 3 → present tense (guards compare realpaths on both sides; a spawn test through an explicit symlink pins it, with the regime assertion); `:32-33` → quote the new `isMain` shape; `:38-39` → "Measured 2026-10-02 under tsx 4.22.3 as well: the same false/true split", dropping "were not measured". Rule 1 (realpath the tmpdir in spawn tests) stays: it is still right for path-prefix reasons and for any future script that copies the old shape.

Verification without the whole suite: `npx vitest run scripts/__tests__/mutation-on-diff-select-only.test.ts scripts/__tests__/mutation-on-diff.test.ts scripts/__tests__/coverage-ratchet.test.ts scripts/__tests__/check-react-compiler-bailouts.test.ts scripts/__tests__/todo-scheduler.test.ts scripts/__tests__/verify-barcode-cache-candidates.test.ts` (the related-tests gate in `preflight:fast` picks up the same set on push). Manual two-sided probe on macOS, if wanted: copy `scripts/ci/mutation-on-diff.mjs` and `stryker.targets.mjs` into `T=$(mktemp -d)` (under `/var`), add an eligible fixture pair and a list file, then run `node "$T/scripts/ci/mutation-on-diff.mjs" --select-only "$T/list.txt"` with `$T` as returned and again with `$(realpath "$T")`; before the fix only the second prints the `select-only:` line. Do not `rm -rf` the probe dir from an agent session (destructive-command rule); leave it under `$TMPDIR`.

## Scope Contract

- **Mechanisms to use:** `node:fs` `realpathSync` and `node:url` `fileURLToPath` (both built-ins; no new dependency in any of the six, and none at all in `scripts/ci/mutation-on-diff.mjs`); the existing `makeTree`/`run`/`dirs` machinery and `afterEach` sweep in the select-only test; a plain `symlinkSync` for the link. Nothing new.
- **Files in scope:** `scripts/ci/mutation-on-diff.mjs`, `scripts/mutation-explore.mjs`, `scripts/check-react-compiler-bailouts.js`, `scripts/coverage-ratchet.ts`, `scripts/todo-scheduler.ts`, `scripts/verify-barcode-cache-candidates.ts`, `scripts/__tests__/mutation-on-diff-select-only.test.ts`, `docs/solutions/conventions/esm-direct-run-guard-no-ops-through-a-symlinked-path-2026-10-02.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. #1224 (25fcf9da) is merged and shipped the convention doc this implements; no open todo overlaps (dedupe grep over `todos/*.md` for `pathToFileURL|import.meta.url|symlink` on 2026-10-02 matched only an unrelated line in `todos/P3-2026-10-02-eslint-tsconfig-ignore-dot-superpowers-scratch-dir.md`).

## Risks

- A guard that is wrongly true under import would `process.exit` the Vitest worker; the IIFE's catch → `false` default and the six existing import-based test files are the safety net, and CI shows it immediately.
- `scripts/` is HELD wholesale by `scripts/todo-automerge-guard.sh` (header comment `:19` and `:82`), so this P3's PR needs a human merge regardless of its low priority; the executor should report `MERGE_ELIGIBLE: held`, not treat it as a failure.
- The six other `isMain` substring guards (`scripts/cleanup-junk-recipes.ts:150`, `scripts/cleanup-junk-mealplan-recipes.ts:103`, `scripts/migrate-recipe-ingredients.ts:191`, `server/scripts/cleanup-retention.ts:388`, `server/scripts/cleanup-seed-recipes.ts:368`, `server/scripts/backfill-email-verified.ts:120`) are symlink-tolerant and out of scope; do not widen into them.
- `tsx` behaviour was measured at 4.22.3 under node v24.20.0 (`package.json` engines `24.x`, `.nvmrc` 24); a future tsx that sets `import.meta.main` does not change the realpath shape's correctness.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.
