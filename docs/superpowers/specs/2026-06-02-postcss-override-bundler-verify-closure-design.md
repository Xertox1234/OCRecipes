# Design: Close the postcss-override bundler-verification todo

- **Date:** 2026-06-02
- **Status:** Approved (design); ready for implementation plan
- **Source todo:** `todos/P3-2026-05-31-postcss-override-bundler-verify.md`
- **Related:** PR #315 (postcss override), PR #312 (declined SDK 54→56 jump)

## Problem

PR #315 fixed the `postcss <8.5.10` advisory by forcing `postcss ^8.5.10` through
an npm `overrides` block, deliberately avoiding the Expo SDK 54→56 jump Dependabot
proposed in #312. The todo's primary acceptance criterion (AC #1) was to run
`npx expo export --platform web` and confirm the bundle builds with no
postcss-related errors — but that was blocked on `react-native-web`, which the
project has deliberately not installed (web frontend is planned, not built).

The verification was therefore stuck waiting on a dependency that doesn't exist.

## Key finding (the reason the export was never the right test)

A code-read of `@expo/metro-config@54.0.15` shows a vanilla web export would **not
exercise postcss at all**, even with `react-native-web` installed:

- `build/transform-worker/transform-worker.js` → `transformCss()` runs only on the
  **web** platform. It calls `transformPostCssModule()` first, then does the real
  CSS work with **lightningcss** (`require('lightningcss').transform(...)`).
- `build/transform-worker/postcss.js` → `transformPostCssModule()` calls
  `resolvePostcssConfig(projectRoot)` and **early-returns `hasPostcss: false`**
  when no `postcss.config.*` exists at the project root — `require('postcss')` and
  `processor.process()` (the advisory's vulnerable stringify path) are never reached.
- `resolvePostcssConfig` reads the **project** root, so installing
  `react-native-web` cannot introduce a config.

OCRecipes has **no `postcss.config.*`, no `metro.config.*`, and no `.css` imports**
anywhere in `client/`, `shared/`, or `server/`. So the pinned postcss sits behind
three gates (web platform **+** a `.css` in the bundle **+** a `postcss.config`
with a plugin), none of which this app trips.

**Reframing:** the `overrides.postcss` pin is a **dependency-resolution floor**, not
a live bundler code path. It guarantees that _if_ a `postcss.config` is ever added
(e.g. Tailwind-for-web, autoprefixer) the version metro resolves is ≥ 8.5.10. Its
API compatibility is already exercised on **every CI run** via
`vitest → vite → postcss@8.5.15` (vite calls the same postcss `process()` API).

## Decision

Close AC #1 **by analysis** rather than by running an export or building a synthetic
postcss harness. A synthetic `postcss.config` + `.css` + minimal web entry would only
prove "a stable postcss release processes a trivial CSS file" — nothing about
OCRecipes' real configuration, and nothing CI's vite path doesn't already cover. That
is machinery with ~zero new information on a `priority: low` item, so it is rejected.

Fork chosen for the deferred AC #3: **(A) archive the todo and move the trigger into
`dependabot.yml`** — the reminder lives where the triggering action (lifting the SDK
pin) actually happens.

## Acceptance-criteria resolution

| AC                                               | Resolution                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| #1 metro web-export check                        | **Satisfied by analysis** (gating finding above).                                                                     |
| #2 `npm ls postcss` ≥ 8.5.10                     | **Passes.** `8.5.15` on both `expo→@expo/metro-config` and `vitest→vite`, deduped to a single `node_modules/postcss`. |
| #3 drop override on next SDK upgrade             | **Deferred; trigger made durable** via a `dependabot.yml` comment.                                                    |
| #4 `expo >=55.0.0` dependabot guard still wanted | **Confirmed.** `expo@54.0.34`; project intends to stay on SDK 54.                                                     |

## Deliverables

1. **`docs/solutions/best-practices/<slug>.md`** — codify the reusable finding: how
   Expo's metro postcss path is gated, that lightningcss is the real web CSS
   transformer, and why an `overrides.postcss` pin is a resolution floor, not a live
   code path. (Final subdir chosen by the codify skill.)
2. **Trigger comment in `.github/dependabot.yml`** — one line in the `expo`
   `>=55.0.0` ignore block: when the SDK pin is lifted, check whether
   `@expo/metro-config` ships postcss ≥ 8.5.10 natively and, if so, drop the
   `overrides.postcss` pin; then re-run `npm ls postcss`.
3. **Archive the todo** — append a 2026-06-02 `Updates` entry recording the analysis
   - evidence, check off AC #1/#2/#4, then move the file to `todos/archive/`.

## Out of scope

- Installing `react-native-web` or scaffolding any web target.
- Any synthetic `postcss.config` / `.css` / minimal web-entry harness.
- Any change to the `overrides.postcss` pin itself (it stays; only its _removal
  trigger_ is documented).
- Lifting the Expo SDK 54 pin.

## Closure acceptance criteria (for this work)

- [ ] Solution doc exists and states the gating + resolution-floor finding with file
      references into `@expo/metro-config`.
- [ ] `dependabot.yml` carries the override-removal trigger comment and remains valid
      YAML (comment-only edit; not a copilot-instructions source, so no build coupling).
- [ ] Todo has the 2026-06-02 `Updates` entry with AC #1/#2/#4 checked, and is moved
      to `todos/archive/`.
- [ ] No `react-native-web`, `postcss.config`, `metro.config`, or `.css` added; `git
    status` shows only the doc, the todo move, and the `dependabot.yml` comment.

## Evidence (captured 2026-06-02)

```
$ npm ls postcss
├─┬ expo@54.0.34 → @expo/metro-config@54.0.15 → postcss@8.5.15
└─┬ vitest@4.1.7 → vite@8.0.14 → postcss@8.5.15 deduped
$ npm ls react-native-web        # (empty) — not installed
node_modules/postcss → 8.5.15    # single resolved install
```

Code references: `@expo/metro-config/build/transform-worker/transform-worker.js`
(`transformCss`, lightningcss at the "Global CSS" block) and
`build/transform-worker/postcss.js` (`transformPostCssModule`, `resolvePostcssConfig`).
