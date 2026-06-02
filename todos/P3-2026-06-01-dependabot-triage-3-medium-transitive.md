---
title: "Track 3 transitive Dependabot alerts (uuid / brace-expansion / esbuild) — triaged not-urgent"
status: backlog
priority: low
created: 2026-06-01
updated: 2026-06-01
assignee:
labels: [deferred, dependencies, security]
github_issue:
---

# Track 3 transitive Dependabot alerts (uuid / brace-expansion / esbuild)

## Summary

Three open Dependabot alerts (all **Medium**) were triaged on 2026-06-01 as **not urgent**: every one is a transitive dependency of dev/build/test tooling, none ships in the React Native bundle or the Express server runtime, and none has an attacker-reachable code path. This todo preserves that triage so the alerts aren't silently re-investigated, and records the revisit triggers + the one genuinely actionable item (an esbuild/vite lockfile mis-resolution that is a hygiene fix, not a CVE patch).

## Background

Triaged after merging PRs #317/#318. The GitHub push surfaced "3 moderate vulnerabilities on the default branch." Foundational reason none are urgent: the app has **no production deployment yet** (no prod build/DB), so there is no shipped artifact for any of these to reach — and even post-launch all three are build/dev/test-only.

Why no Dependabot fix PRs auto-opened: all three are **transitive-only** with no safe _direct_ bump for Dependabot to make.

**The discriminating axis was reachability, not severity.** Each alert fails both:
production-reachability (not in the RN bundle / server runtime) AND attacker-reachability
(no path takes attacker-controlled input). Dependabot's "runtime" scope labels on uuid and
brace-expansion are misleading — it infers scope from `package-lock.json` and can't see that
`@expo/ngrok` and `eslint` are tooling.

Per-alert (from `npm ls`, 2026-06-01):

- **#4 `uuid` (CVE-2026-41907, GHSA-w5hq-g745-h8pq) — defer to upstream.**
  Instances: `@expo/ngrok@4.1.3 → uuid@3.4.0` and `expo → @expo/config-plugins → xcode@3.0.1 → uuid@7.0.3`.
  Both are CLI/native-prebuild tooling, never bundled. Vuln triggers only on `v3()/v5()/v6()`
  _with a `buf` arg_; these generate v4 random IDs. **Blunt override is unsafe** — forcing
  `uuid@^11` breaks the v3/v7 API these packages expect. Wait for `@expo/ngrok` + `xcode` to bump.

- **#2 `brace-expansion` (CVE-2026-33750, GHSA-f886-m6hf-6m8v) — low priority.**
  Only the `1.1.12` instance under `eslint@9 → minimatch@3.1.5` is flagged; the `2.1.0`/`5.0.6`
  instances (Expo, typescript-eslint) are already patched. ReDoS/process-hang on a zero-step
  brace sequence, reachable only when eslint expands a **developer-authored** glob — no attacker
  path. **Blunt override is unsafe** — forcing all `brace-expansion` to 1.1.13 breaks the
  `minimatch@10` (2.x/5.x) consumers. A _scoped nested_ override could bump just the 1.x
  instance, but value is near-zero for a dev-only linter.

- **#1 `esbuild` (GHSA-67mh-4wv8-2f99) — lockfile hygiene, but blocked on upstream (see 2026-06-02 update).**
  The dev-server CORS CVE needs `esbuild serve`, which vite/vitest/drizzle-kit do not use.
  The _real_ signal is the `npm ls` `ELSPROBLEMS`: **`vite@8.0.14` declares `esbuild ^0.27||^0.28`
  but resolved to `0.18.20`** — because the deprecated `@esbuild-kit/*` chain (under `drizzle-kit`)
  hoisted `esbuild@0.18.20` to root `node_modules`. So vitest runs on a 7-major-stale esbuild
  regardless of security. **Blunt override is unsafe** — forcing `esbuild@^0.25` won't satisfy
  vite@8's `^0.27||^0.28` and risks transform breakage.

## Acceptance Criteria

- [ ] **uuid (#4):** confirm `@expo/ngrok` and/or `xcode` (via `@expo/config-plugins`) have bumped their `uuid` dep (likely on the next Expo SDK upgrade); re-check `npm ls uuid`. Do NOT force `uuid@^11` via overrides.
- [ ] **brace-expansion (#2):** re-check `npm ls brace-expansion` after the next `eslint` upgrade — newer eslint drops the ancient `minimatch@3`. Only if it persists AND becomes worth it, add a _scoped nested_ override for the 1.x instance (first verify the GHSA's full affected ranges so a single scoped bump is actually complete). Do NOT blanket-override.
- [ ] **esbuild (#1) — blocked on upstream (re-verified 2026-06-02):** the `vite@8`→`esbuild@0.18.20` mis-resolution can't be cleanly fixed yet. `drizzle-kit@0.31.10` is already the latest published version and **still** declares `@esbuild-kit/esm-loader: ^2.5.5`, so there is no newer release to bump to; and `npm dedupe --dry-run` proposes churning ~63 packages without re-nesting vite's esbuild. **Revisit when `drizzle-kit` drops `@esbuild-kit`** (watch its changelog/releases) — then re-check `npm ls esbuild` resolves cleanly (no `ELSPROBLEMS`, vite gets `^0.27||^0.28`) AND `npm run test:run` still passes before asserting the fix works. Do NOT blunt-override (vite wants `^0.27||^0.28`, the `@esbuild-kit` chain wants `~0.18` — no single pin satisfies both). Fold the eventual fix into the postcss bundler-verify todo (same bundler/lockfile neighborhood).
- [ ] **Pre-launch gate:** before the first production build/deploy, re-triage all three against the _shipped_ artifact (RN bundle + bundled Express server) — production-reachability is the assumption that makes "not urgent" true.
- [ ] Optionally dismiss #4 and #2 in the GitHub Dependabot UI as "no production exposure / dev-tooling only" to clear the default-branch noise (keep #1 open as the actionable lockfile item).

## Implementation Notes

- Existing `overrides` block: `package.json → "overrides": { "postcss": "^8.5.10" }`. Any new pin goes here — but per the triage, **none of these three warrant a blunt entry**; the failure mode is "just override it," which breaks consumers in all three cases.
- Dependabot config: `.github/dependabot.yml` (security-only/grouped/version-off, with `expo >=55` + zod pin ignores). See memory `project_dependabot_ci_security_posture`.
- The esbuild item overlaps the bundler-verify todo (`todos/2026-05-31-postcss-override-bundler-verify.md`) — both are build-tooling/lockfile hygiene; consolidate there when actioned.
- Alert numbers map to GitHub Dependabot alert IDs: #4 uuid, #2 brace-expansion, #1 esbuild. Re-pull live state with `gh api /repos/Xertox1234/OCRecipes/dependabot/alerts?state=open`.

## Dependencies

- Several criteria are gated on upstream/SDK upgrades (uuid, brace-expansion) — only the esbuild lockfile fix and the GitHub-UI dismissals are actionable today.
- esbuild item: see `todos/2026-05-31-postcss-override-bundler-verify.md`.

## Risks

- Low. The standing risk is the **process** one: blunt `overrides` entries that break Expo/minimatch/vite consumers. The triage's explicit "blunt override unsafe" per item is the guardrail against that.
- Severity could change if/when a production deployment exists — hence the pre-launch re-triage criterion.

## Updates

### 2026-06-01

- Filed after triaging the 3 default-branch Dependabot alerts surfaced by the PR #317/#318 merges. Recommendation: leave for Dependabot/upstream; track here so they aren't lost. Advisor-reviewed triage.

### 2026-06-02

- Attempted to pick up the esbuild item; **it is not cleanly actionable yet.** Live re-verification confirmed the `ELSPROBLEMS` persists: `vite@8.0.14` still resolves to the root-hoisted `esbuild@0.18.20` (from `drizzle-kit → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2`), against vite's `^0.27 || ^0.28` peer range.
- **Both proposed fixes are dead today:** (1) `drizzle-kit` is already on the latest published version (`0.31.10`) and still declares `@esbuild-kit/esm-loader: ^2.5.5` — there is no newer release that drops the deprecated chain; (2) `npm dedupe --dry-run` proposes changing ~63 packages (and re-adding many nested copies) without cleanly re-nesting vite's esbuild — too broad a churn to the test toolchain for a harmless dev-only issue.
- **Reclassified the esbuild item from "the one actionable item" to "blocked on upstream"** — revisit when `drizzle-kit` drops `@esbuild-kit`. Updated the Background bullet and AC accordingly.
