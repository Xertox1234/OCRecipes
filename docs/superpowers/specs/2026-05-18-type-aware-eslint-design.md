# Type-Aware ESLint for OCRecipes — Design

- **Date:** 2026-05-18
- **Status:** Approved (brainstorm); pending implementation plan
- **Topic:** Adopt `@typescript-eslint` type-checked rules to catch unhandled async

## Goal

Add `@typescript-eslint` type-checked rules — primarily `no-floating-promises`, plus
`no-misused-promises`, `await-thenable`, `require-await` — to catch unhandled async,
the largest invisible-bug class in this async-heavy Expo/React Native + Express app.

## Current state (verified 2026-05-18)

- Monorepo: Expo/RN frontend + Express backend, ~981 TS/TSX files, TypeScript 5.9.3.
- ESLint config is a **flat config** at `eslint.config.js` (ESLint `^9.25.0`, `defineConfig`)
  extending `eslint-config-expo/flat`. `npm run lint` = `npx expo lint` resolves to it.
  A working custom plugin `eslint-plugin-ocrecipes/` provides route-scoped rules.
- `@typescript-eslint/parser` is already present transitively via `eslint-config-expo`,
  but **no type-checked rule configs are enabled** — linting is not type-aware today.
- **Single tsconfig:** one root `tsconfig.json` with `include: ["**/*.ts","**/*.tsx"]`
  covers client + server + shared + tests. `strict: true`, `incremental: true`,
  aliases `@/` → `./client`, `@shared/` → `./shared`. `tsconfig.check.json` extends it
  to exclude tests. No separate client/server tsconfig — one project covers everything.
- CI (`.github/workflows/ci.yml`) `checks` job runs `npm run lint` then `check:types`
  (separate steps), plus bespoke `check-*.js` pattern scripts and
  `build:copilot-instructions:check`. Tests run sharded in a later job.
- Pre-commit (Husky `.husky/pre-commit`) runs `lint-staged` — `*.{ts,tsx}` →
  `eslint --fix` + `prettier --write` — then a `kimi-review` staged-diff gate.

## Decisions (locked during brainstorm)

| Decision                   | Choice                                          |
| -------------------------- | ----------------------------------------------- |
| Backlog handling           | **Ratchet** via native ESLint bulk suppressions |
| Where type-aware lint runs | **CI only** — pre-commit stays non-type-aware   |
| Rule set                   | **Core 4 + 2 zero-noise wins**                  |

## Design

### 1. ESLint config changes

Add the `typescript-eslint` v8 unified meta-package to `devDependencies`, and append
one conditional block to `eslint.config.js` after the existing blocks:

```js
// Type-aware async-safety rules. Gated off for pre-commit (see section 3).
...(process.env.ESLINT_NO_TYPE_AWARE
  ? []
  : [{
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: __dirname },
      },
      plugins: { "@typescript-eslint": tseslint.plugin },
      rules: {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
        "@typescript-eslint/await-thenable": "error",
        "@typescript-eslint/require-await": "error",
        "@typescript-eslint/no-implied-eval": "error",
        "@typescript-eslint/prefer-promise-reject-errors": "error",
      },
    }]),
```

Notes:

- Rules are set directly to `"error"`. The ratchet (section 2), not a `warn` level, is
  what keeps the existing backlog non-blocking.
- `projectService: true` is the modern replacement for `parserOptions.project`. It
  auto-resolves the single root `tsconfig.json` for every file, including tests, and
  uses TypeScript's incremental ProjectService API.
- Flat config merges `languageOptions` across matching blocks, so this block only
  _adds_ `parserOptions.projectService` — the parser `eslint-config-expo/flat` already
  set for `.ts`/`.tsx` is preserved.
- The block is a spread of a conditional array (`...(cond ? [] : [block])`) so a single
  env var includes/excludes it without a second config file.

**Rule set rationale.** The bug-catching value is concentrated in `no-floating-promises`,
`no-misused-promises`, and `await-thenable`. `require-await` is stylistic and the weakest
of the four — kept as requested, but expected to be the largest contributor to the
suppressions file. The two extras are zero-noise wins: `no-implied-eval` (security,
expected ~0 violations) and `prefer-promise-reject-errors` (async correctness, low noise).

### 2. Backlog ratchet — native ESLint bulk suppressions

No third-party baseline tooling. ESLint 9.24+ ships bulk suppressions natively.

1. Land the config block with rules at `error`.
2. Run the suppression snapshot once → writes `eslint-suppressions.json`, a per-file +
   per-rule **count** of current violations.
3. Commit `eslint-suppressions.json`. CI's `npm run lint` consults it: existing
   violations are suppressed and CI passes, but any _new_ violation fails CI immediately.
4. Burn down over time (see Burndown plan): a developer genuinely fixes a violation, or
   marks an intentional fire-and-forget per the `void` policy, then prunes the file.

**Count-based granularity — and the prune gate that closes it.** Bulk suppressions track
"N violations of rule R in file F," not specific lines. In a file that already has
suppressions, a developer can remove one old violation and add a new one with the count
unchanged — CI passes and the new bug is masked. `--prune-suppressions` rewrites the file
to the _current_ count; once a fix takes a file 3 → 2 and the file is pruned, the gate
re-tightens at 2.

To keep the ratchet honest, add a **CI staleness gate** mirroring the existing
`build:copilot-instructions:check` pattern: a step that runs prune and fails if
`eslint-suppressions.json` would change. This forces the committed file to always reflect
the actual current count, closing most of the count-masking hole. Files with zero
suppressions are fully gated regardless.

**npm scripts:**

- `lint:suppress` — regenerate `eslint-suppressions.json` (snapshot all current violations).
- `lint:suppress:prune` — prune unused suppressions; run after fixing violations.

Exact ESLint CLI flag surface (`--suppress-all`, `--prune-suppressions`, default
auto-load location for `eslint-suppressions.json`) is **verified in the spike** against
the project's installed ESLint version before the scripts and CI step are finalized — if
an explicit `--suppress-location` is required it is added consistently to the scripts and
the CI lint step.

### 3. Where it runs

- **CI** — `npm run lint` in the `checks` job runs the type-aware block. It builds a TS
  program; CI is a fresh `npm ci` checkout with no incremental cache, so the lint step
  grows by roughly one `tsc` pass (estimate ~20–60s for ~981 files). `check:types`
  already does equivalent work as a separate step. Paying for two TS program builds in CI
  is accepted; the steps are independent and the cost is reasonable. Not pre-optimized —
  if CI time gets tight later, merging the two is a known future option.
- **Pre-commit** — `lint-staged`'s `*.{ts,tsx}` entry changes from `eslint --fix` to
  `ESLINT_NO_TYPE_AWARE=1 eslint --fix`. The env var makes the config omit the type-aware
  block, so commits stay as fast as today. POSIX-only env prefix is acceptable —
  development is macOS, CI is Ubuntu, no Windows in play.
- **Dev loop** — the ESLint editor extension keeps a warm TS program, giving developers
  live type-aware feedback in-editor. Pre-commit is intentionally not the feedback path
  for these rules; CI is the enforcement point.

### 4. `void` policy

`void someAsyncCall()` silences `no-floating-promises` whether the fire-and-forget is
genuinely intentional or a real unhandled-error bug. Without a policy, a burndown drains
the suppressions file by `void`-prefixing everything, converting latent bugs from
"documented in JSON" to "permanently invisible" — strictly worse.

**Policy:** `void` is acceptable only when **either**

- the promise has its own internal error handling (`try/catch` or a `.catch` on the
  promise), **or**
- the failure mode is provably safe to drop.

A bare `void asyncCall()` with neither condition is a review reject. This applies both to
new code and to burndown of the suppressed backlog.

### 5. Rollout sequence

A **single PR**: ESLint config block, `eslint-suppressions.json`, `lint-staged` tweak,
`package.json` (dependency + scripts), and the CI staleness-gate step. The ratchet means
there is no separate warn period and no backlog-fixing PR — CI gates from the moment it
merges.

The implementation plan's **first step is a measurement spike**, completed before the
final config and suppressions file land:

1. `npm install -D typescript-eslint`, then
   `npm ls @typescript-eslint/parser @typescript-eslint/eslint-plugin typescript-eslint`
   — confirm a single resolved version of each. `eslint-config-expo` pins
   `@typescript-eslint/*` transitively; if there is a version skew (which can silently
   no-op rules on some files), add a `package.json` `overrides` entry to force alignment.
2. Verify the ESLint bulk-suppressions CLI surface and default file location against the
   installed version (`npx eslint --help`).
3. Run `eslint .` with the type-aware block and read the **raw violation report** before
   generating the suppressions file. Use the per-rule counts to settle the two tuning
   knobs below.

### 6. Tuning knobs (decided from spike numbers)

- **`no-misused-promises` → `checksVoidReturn.attributes`.** This is what flags `async`
  functions passed where a `void`-returning callback is expected — RN `onPress`,
  `onChange`, etc. — one of the most common silent-failure patterns in React Native.
  **Default: keep it on**, snapshot the resulting violations into suppressions, and burn
  them down. Relax to `attributes: false` _only_ if the spike shows the backlog is
  clearly dominated by handlers that already wrap their body in `try/catch`. Relaxing it
  permanently turns off floating-promise detection on JSX handlers — treat that as a
  coverage loss, not a noise dial.
- **`require-await` in tests.** Expected to be the largest suppressions contributor. If
  the spike shows it is pure noise in `**/*.test.{ts,tsx}`, scope it off for test files
  via a dedicated config block. Otherwise leave it global.

### 7. Burndown plan

The ratchet stops new violations but does not fix the existing backlog — `eslint-suppressions.json`
is tracked technical debt, not a resolution. Burndown priority, highest first:

1. `server/routes/**` — request handlers; a dropped promise here is a silent 500 or a
   half-completed mutation.
2. `server/services/**` — business logic, including the AI services with intentional
   fire-and-forget background work; each needs the `void` policy applied deliberately.
3. `client/**` — RN screens, components, hooks.
4. Tests — lowest risk; many entries will be `require-await` noise.

#### Cadence and ownership

- **Ownership:** solo — this is a single-developer project; burndown is the project
  owner's, no team hand-off.
- **Tracking:** when the adoption PR merges, each of the four tiers above becomes a
  backlog todo in `todos/` (`labels: [deferred, code-quality]`), with the spike's
  measured per-tier violation count recorded in the todo's Background section.
- **Cadence:**
  - Tier 1 (`server/routes/**`) — burned down within **2 weeks** of the adoption PR
    merging. A dropped promise in a request handler is the highest silent-failure risk
    and should not sit suppressed.
  - Tiers 2–4 — **one tier per calendar month** thereafter, in priority order.
  - After each tier, run `lint:suppress:prune` and commit the updated
    `eslint-suppressions.json` so the CI staleness gate re-tightens at the lower count.
- **Target:** `eslint-suppressions.json` reaches zero entries (file deleted) within
  **~4 months** of the adoption PR merging.
- These intervals are calibrated to a not-yet-measured backlog; if the spike (section 5)
  reveals a count far outside the expected range, the cadence is adjusted at todo-filing
  time and this section updated to match.

## Out of scope

- Enabling the full `recommendedTypeChecked` config (considered and declined — far larger
  noisy backlog).
- Refactoring the existing `eslint-plugin-ocrecipes` rules.
- Merging the `lint` and `check:types` CI steps into one TS program build.

## Risks

| Risk                                                                                                      | Mitigation                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `typescript-eslint` v8 vs `eslint-config-expo`'s pinned `@typescript-eslint/*` skew silently no-ops rules | Spike step 1 verifies single resolved versions; `package.json` `overrides` if needed |
| Bulk-suppression CLI surface differs from assumed                                                         | Spike step 2 verifies against installed ESLint version before scripts/CI finalize    |
| Count-based suppressions mask new bugs in already-suppressed files                                        | CI staleness gate enforces pruned, current-count suppressions file                   |
| Burndown via careless `void` hides real bugs                                                              | `void` policy (section 4); bare `void` is a review reject                            |
| Type-aware lint slows CI                                                                                  | Accepted (~20–60s estimate); merge with `check:types` is a known future option       |
