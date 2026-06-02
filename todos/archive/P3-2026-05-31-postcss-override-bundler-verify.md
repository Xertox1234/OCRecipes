---
title: "Verify postcss override under the metro bundler (web export) + revisit when SDK upgrades"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-06-01
assignee:
labels: [deferred, dependencies, build-tooling]
github_issue:
---

# Verify postcss override under the metro bundler (web export) + revisit when SDK upgrades

## Summary

The postcss `<8.5.10` advisory was fixed (PR #315) by forcing `postcss ^8.5.10`
through an npm `overrides` block, deliberately avoiding the Expo SDK 54 → 56 jump
Dependabot proposed in #312. The fix is proven statically, but its runtime effect
under the **metro bundler** was never exercised. This todo closes that gap.

## Background

- The vulnerable `postcss@8.4.49` entered via
  `expo@54 → @expo/metro-config → postcss` — a **build-time, web/CSS** code path
  (postcss CSS _stringify_, the advisory's vulnerable function). A **second**
  consumer also pulls postcss: `vitest → vite → postcss` (the test runner; Vite
  uses postcss as its default CSS transformer). The `overrides` pin covers both,
  and npm dedupes them to a single install.
- That path is **dormant**: `react-native-web` is not installed (the web frontend
  is planned, not built), so metro never invokes postcss's CSS pipeline today.
- Because web isn't set up, `npx expo export --platform web` fails early with
  "install react-native-web" — i.e. the bundler check could not be run. Validation
  to date is: `npm ls postcss` shows all installs ≥ 8.5.10, the lockfile diff is
  surgical (4 add / 33 del), and `expo` stayed on SDK 54.
- Net: a build-time security fix merged without an end-to-end bundler confirmation.
  Risk is low (semver-minor bump on a dormant dep) but unverified.

## Acceptance Criteria

- [x] When `react-native-web` is added (web frontend work), run
      `npx expo export --platform web` and confirm the bundle builds with **no
      postcss-related errors** and CSS is emitted correctly.
      _(N/A — resolved by analysis 2026-06-02: a web export can't reach postcss in
      this project; the export was not run. See the 2026-06-02 Updates entry.)_
- [x] Re-run `npm ls postcss` and confirm every instance still resolves to
      ≥ 8.5.10 (the override survived any interim `expo`/metro-config patch).
- [ ] On the next Expo SDK upgrade: check whether `@expo/metro-config` now ships
      postcss ≥ 8.5.10 natively. If so, **remove** the `overrides.postcss` entry
      in `package.json` (don't carry a now-redundant pin) and drop the matching
      note. Re-verify `npm ls postcss` afterward.
      _(Open by design — this trigger is now mirrored as a comment in
      `.github/dependabot.yml` and fires at the next SDK-pin lift.)_
- [x] Confirm the `expo >=55.0.0` ignore in `.github/dependabot.yml` is still the
      desired guard (remove/adjust if/when an intentional SDK upgrade happens).

## Implementation Notes

- Override lives in `package.json` → `"overrides": { "postcss": "^8.5.10" }`.
- Guard lives in `.github/dependabot.yml` → `ignore` entry for `expo >=55.0.0`.
- Two consumers pull postcss, both build/test-time: `@expo/metro-config` (web
  export CSS, dormant until `react-native-web` lands) and `vite` via `vitest`
  (test runner; its postcss CSS pipeline is inert for a CSS-less RN/node suite).
  There is no runtime app code to test; the verification vehicle is the
  bundler/export. Note: the vitest/vite path IS exercised on every CI run, so an
  API-breaking postcss bump would surface at test time even though its CSS
  pipeline never fires.
- CI (Vitest/lint/tsc) does **not** exercise metro, so it cannot validate this —
  the export must be run manually (or wired into the manual `e2e-smoke` flow).

## Dependencies

- Blocked on `react-native-web` being installed / the web frontend being scaffolded
  (see project plan: web frontend planned). Until then only the static re-checks
  (`npm ls postcss`, SDK-upgrade revisit) are actionable.

## Risks

- An `overrides` pin can mask a future legitimate postcss change or fight a
  metro-config that later requires a different range — hence the "remove when
  redundant" criterion.
- Forgetting to drop the override after an SDK upgrade leaves a silent, stale pin.

## Updates

### 2026-05-31

- Created after PR #315 merged. Fix verified statically; bundler-level
  verification deferred until web tooling exists.

### 2026-06-01

- Corrected the "only consumer" claim. `npm ls postcss` shows **two** paths:
  `expo → @expo/metro-config → postcss@8.5.15` and
  `vitest → vite → postcss@8.5.15 (deduped)`. Both ≥ 8.5.10; the `overrides` pin
  covers both and they collapse to one install. AC #2's static recheck passes as
  of today (every instance resolves to 8.5.15). AC #1 remains blocked —
  `react-native-web` is still absent from the tree, so `expo export --platform
web` can't be run yet.

### 2026-06-02

- **Closed (AC #1 satisfied by analysis).** Code-read of `@expo/metro-config@54.0.15`:
  a web export would not exercise postcss in this project regardless of
  `react-native-web`. `transform-worker.js → transformCss()` invokes postcss only via
  `transformPostCssModule()`, which early-returns `hasPostcss:false` when no
  `postcss.config.*` exists at the project root (none does; `resolvePostcssConfig` reads
  the project root, so installing react-native-web can't add one). The web CSS transformer
  is **lightningcss**. The `overrides.postcss` pin is a dependency-resolution floor, not a
  live bundler code path; its API compat is exercised every CI run via
  `vitest → vite → postcss@8.5.15`.
- **AC #2 passes:** `npm ls postcss` → 8.5.15 on both paths, single dedupe.
- **AC #4 confirmed:** `expo@54.0.34`; the `expo >=55.0.0` dependabot guard is still wanted.
- **AC #3 deferred; trigger made durable:** the override-removal reminder now lives as a
  comment in `.github/dependabot.yml` (edited whenever the SDK pin is lifted).
- Finding codified in `docs/solutions/best-practices/metro-postcss-gating-overrides-resolution-floor-2026-06-02.md`
  (local-only). Archiving this todo.

## Copilot Delegation

Copilot delegation is **parked** for routine todo work (see CLAUDE.md). Complete
this via the `/todo` skill locally. Do not run `copilot:delegate`.
