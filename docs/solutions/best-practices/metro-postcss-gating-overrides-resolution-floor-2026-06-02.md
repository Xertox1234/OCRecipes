---
title: 'Expo metro''s postcss path is gated on a postcss.config — an overrides.postcss pin is a resolution floor, not a live code path'
track: knowledge
category: best-practices
module: shared
tags: [dependencies, expo, metro, postcss, lightningcss, overrides, build-tooling, web, security]
applies_to: [package.json, .github/dependabot.yml]
created: '2026-06-02'
---

# Expo metro's postcss path is gated on a postcss.config — an `overrides.postcss` pin is a resolution floor, not a live code path

## When this applies

- You forced a transitive dep via npm `overrides` to dodge a CVE (e.g. `postcss ^8.5.10`)
  and want to know whether the *bundler* actually runs the patched code.
- You're about to "verify postcss under the web export" or add Tailwind/autoprefixer for web.
- You're lifting the Expo SDK pin and wondering whether an `overrides` entry is still needed.

## The metro web CSS pipeline (Expo SDK 54, @expo/metro-config 54.0.15)

A web export transforms CSS files through `build/transform-worker/transform-worker.js`:

1. `transformCss()` runs **only** on the `web` platform (native returns an empty module).
2. It calls `transformPostCssModule()` (`build/transform-worker/postcss.js`) **first**, which
   calls `resolvePostcssConfig(projectRoot)` and **early-returns `{ hasPostcss: false }` when
   there is no `postcss.config.*` at the project root** — `require('postcss')` and
   `processor.process()` (the advisory's vulnerable stringify) are never reached.
3. The real CSS work is then done by **lightningcss** (`require('lightningcss').transform(...)`),
   not postcss.

`resolvePostcssConfig` reads the **project** root, so installing a dependency (e.g.
`react-native-web`) cannot introduce a config. postcss therefore sits behind three gates:
**web platform** + a **`.css` in the bundle** + a **`postcss.config` with a plugin**.

## Why an `overrides.postcss` pin is a *resolution floor*, not a live code path

OCRecipes has no `postcss.config.*`, no `metro.config.*`, and no `.css` imports in
`client/`, `shared/`, or `server/`. So a vanilla `npx expo export --platform web` — even with
`react-native-web` installed — routes CSS through lightningcss and **never calls postcss**.

The `overrides: { "postcss": "^8.5.10" }` pin is thus a *dependency-resolution floor*: it
guarantees that *if* a `postcss.config` is ever added (Tailwind-for-web, autoprefixer) the
version metro resolves is ≥ 8.5.10. Its API compatibility is already exercised on **every CI
run** via `vitest → vite → postcss` (vite calls the same postcss `process()` API), so an
API-breaking bump would fail tests even though the CSS stringify never fires.

## How to actually exercise postcss under metro (only if you ever need to)

You must deliberately wake all three gates: install `react-native-web`, add a
`postcss.config.js` with ≥1 plugin, import a `.css` from a web entry, then
`npx expo export --platform web`. This proves "a stable postcss processes trivial CSS" —
it does **not** reflect this project's real bundler behavior, which never calls postcss.

## How this was verified (2026-06-02)

```
npm ls postcss   → expo→@expo/metro-config→postcss@8.5.15
                   vitest→vite→postcss@8.5.15 (deduped) ; single node_modules/postcss
npm ls react-native-web → (empty, not installed)
expo@54.0.34 (SDK 54)
```

Code: `@expo/metro-config/build/transform-worker/transform-worker.js` (`transformCss`,
lightningcss at the "Global CSS" block) and `build/transform-worker/postcss.js`
(`transformPostCssModule`, `resolvePostcssConfig`).

## See also

- Closure: `todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`
- Removal trigger: comment in `.github/dependabot.yml` `expo >=55.0.0` ignore block
- Related: `docs/solutions/best-practices/auditing-dependencies-expo-drizzle-zod-stack-2026-05-23.md`
