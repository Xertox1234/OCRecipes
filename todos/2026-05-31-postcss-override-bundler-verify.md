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

- [ ] When `react-native-web` is added (web frontend work), run
      `npx expo export --platform web` and confirm the bundle builds with **no
      postcss-related errors** and CSS is emitted correctly.
- [ ] Re-run `npm ls postcss` and confirm every instance still resolves to
      ≥ 8.5.10 (the override survived any interim `expo`/metro-config patch).
- [ ] On the next Expo SDK upgrade: check whether `@expo/metro-config` now ships
      postcss ≥ 8.5.10 natively. If so, **remove** the `overrides.postcss` entry
      in `package.json` (don't carry a now-redundant pin) and drop the matching
      note. Re-verify `npm ls postcss` afterward.
- [ ] Confirm the `expo >=55.0.0` ignore in `.github/dependabot.yml` is still the
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

## Copilot Delegation

Copilot delegation is **parked** for routine todo work (see CLAUDE.md). Complete
this via the `/todo` skill locally. Do not run `copilot:delegate`.
