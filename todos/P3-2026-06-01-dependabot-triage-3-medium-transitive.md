---
title: "Track 3 transitive Dependabot alerts (uuid / brace-expansion / esbuild) — triaged not-urgent"
status: blocked
priority: low
created: 2026-06-01
updated: 2026-06-02
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
- [ ] **esbuild (#1) — blocked on upstream (re-verified 2026-06-02):** the `vite@8`→`esbuild@0.18.20` mis-resolution can't be cleanly fixed yet. `drizzle-kit@0.31.10` is already the latest published version and **still** declares `@esbuild-kit/esm-loader: ^2.5.5`, so there is no newer release to bump to; and `npm dedupe --dry-run` proposes churning ~63 packages without re-nesting vite's esbuild. **Revisit when `drizzle-kit` 1.0 ships stable** — registry check (2026-06-02) confirms the `1.0.0-beta/rc` line already dropped `@esbuild-kit` (moved to `jiti@^2.6.1` + `esbuild@^0.25.10`); `0.31.10` is the end of the stable 0.x line and still carries the deprecated chain. **Correction (2026-06-02 empirical eval — see Updates):** the earlier claim that this trigger is "independent of the drizzle-orm/zod work because drizzle-kit declares no `drizzle-orm` dep" is **wrong**. drizzle-kit declares no drizzle-orm dep _in its manifest_, but drizzle-kit 1.0 has a **runtime** coupling: it `import`s `drizzle-orm/_relations`, an internal subpath that exists only in the unreleased drizzle-orm 1.0 line (our `drizzle-orm@0.45.2` lacks it → `drizzle-kit --version` itself crashes `ERR_PACKAGE_PATH_NOT_EXPORTED`). So the trigger is **drizzle-kit 1.0 stable AND drizzle-orm 1.0 (both currently pre-release), adopted together** — not drizzle-kit alone. drizzle-orm 1.0 is a _separate_ pre-release major from the held zod-4 / drizzle-zod hold; whether adopting it re-entangles that hold is unverified (verify on revisit). Then re-check `npm ls esbuild` resolves cleanly (no `ELSPROBLEMS`, vite's `^0.27||^0.28` peer gets a valid copy) AND `npm run test:run` still passes before asserting the fix works. Do NOT blunt-override (vite wants `^0.27||^0.28`, the `@esbuild-kit` chain wants `~0.18` — no single pin satisfies both). (The postcss bundler-verify todo was closed/archived 2026-06-02 — `todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`; this todo is now the single home for the esbuild item.)
- [ ] **Pre-launch gate:** before the first production build/deploy, re-triage all three against the _shipped_ artifact (RN bundle + bundled Express server) — production-reachability is the assumption that makes "not urgent" true.
- [x] **Done (2026-06-02):** #4 (uuid) and #2 (brace-expansion) dismissed in the GitHub Dependabot UI — reason `tolerable_risk`, `dismissed_at` 2026-06-02T00:04 UTC. #1 (esbuild) correctly left **open** as the actionable lockfile item.

## Implementation Notes

- Existing `overrides` block: `package.json → "overrides": { "postcss": "^8.5.10" }`. Any new pin goes here — but per the triage, **none of these three warrant a blunt entry**; the failure mode is "just override it," which breaks consumers in all three cases.
- Dependabot config: `.github/dependabot.yml` (security-only/grouped/version-off, with `expo >=55` + zod pin ignores). See memory `project_dependabot_ci_security_posture`.
- The postcss bundler-verify todo (`todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`) was **closed/archived 2026-06-02** (postcss path resolved by analysis). This todo is now the single home for the esbuild item — do NOT consolidate into the archived one.
- Alert numbers map to GitHub Dependabot alert IDs: #4 uuid, #2 brace-expansion, #1 esbuild. Re-pull live state with `gh api /repos/Xertox1234/OCRecipes/dependabot/alerts?state=open`.

## Dependencies

- Several criteria are gated on upstream/SDK upgrades (uuid, brace-expansion) — only the esbuild lockfile fix and the GitHub-UI dismissals are actionable today.
- esbuild item: the related postcss bundler-verify todo is now closed (`todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`). Trigger is **drizzle-kit 1.0 stable _and_ drizzle-orm 1.0 (both currently pre-release), adopted together** — drizzle-kit 1.0 runtime-requires `drizzle-orm/_relations` (1.0-only). Independent of any Expo SDK upgrade; a _separate_ pre-release major from the held zod-4 / drizzle-zod hold (re-entanglement unverified). See the 2026-06-02 empirical-eval Update. The scoped-nested-override path (below) remains the only near-term route to dropping `@esbuild-kit`/`esbuild@0.18.20` without the dual major upgrade.

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
- **Pinned the esbuild trigger to `drizzle-kit` 1.0 (research).** Registry check: `drizzle-kit@0.31.10` = latest stable and still declares `@esbuild-kit/esm-loader: ^2.5.5`; the `@esbuild-kit` removal happened only in `drizzle-kit@1.0.0-beta/rc` (now `jiti@^2.6.1` + `esbuild@^0.25.10`). `@esbuild-kit/core-utils@3.3.2` hard-pins `esbuild ~0.18.20` and is deprecated ("Merged into tsx"). `drizzle-kit` has **no** `drizzle-orm` dep — so the trigger is drizzle-kit's own 1.0 stable release, independent of the held zod-4 / `drizzle-orm` coupling (which is itself now down to just the zod major; the drizzle-orm 0.45 migration shipped in PR #315). Confirmed `db:push` exposure is low: the deprecated `@esbuild-kit/esm-loader` is likely vestigial (drizzle-kit 0.31.10 also ships `tsx` + `esbuild@^0.25.4` directly).
- **Repaired stale cross-references:** the postcss bundler-verify todo this item pointed to ("consolidate there when actioned") was closed/archived earlier on 2026-06-02 to `todos/archive/P3-2026-05-31-postcss-override-bundler-verify.md`. Updated the esbuild AC, Implementation Notes, and Dependencies references — this todo is now the single home for the esbuild item.
- **Live re-verification (later 2026-06-02, `/todo` run):** all three triggers still unfired and on-disk resolution unchanged — `npm ls` shows `uuid@3.4.0`/`7.0.3`, `brace-expansion@1.1.12` under `eslint@9.39.1 → minimatch@3.1.5`, and `vite@8.0.14 → esbuild@0.18.20` `ELSPROBLEMS` via the deprecated `@esbuild-kit` chain. Upstream: `drizzle-kit` `latest`=`0.31.10` (1.0 only at `1.0.0-rc.3`, not stable), `expo` still 54, `eslint` still 9 (10 exists but not adopted). GitHub alert state: #4 uuid + #2 brace-expansion now **dismissed** (`tolerable_risk`); #1 esbuild remains **open**. No code change actionable — todo stays `backlog` as a standing watchpoint until a trigger fires or the pre-launch gate.
- **Empirical eval of `drizzle-kit@1.0.0-rc.3` (2026-06-02, isolated worktree + scratch DB, since removed).** Two-arm fresh-resolve A/B (control = current versions, treatment = RC), then a faithful full install:
  - **esbuild benefit is REAL:** the RC drops the `@esbuild-kit` chain entirely → **0 occurrences of `esbuild@0.18.20`** (control fresh-resolve still had 23, all nested under `@esbuild-kit`). It also showed the committed lockfile's _root_-hoisted `0.18.20` is stale — a fresh resolve already moves root to `0.25.12` — but a plain lockfile refresh does **not** remove `0.18.20` (still nested) and leaves vite outside `^0.27||^0.28`. So a refresh/dedupe is not a fix; only removing `@esbuild-kit` is.
  - **HARD BLOCKER — RC is dead on arrival with our drizzle-orm:** `drizzle-kit --version` (not just `push`) crashes `ERR_PACKAGE_PATH_NOT_EXPORTED: ./_relations is not defined by exports in drizzle-orm`. Our `drizzle-orm@0.45.2` exports `./relations` but not `./_relations`; that internal subpath ships only in the unreleased drizzle-orm 1.0 line. It's a top-level `import`, so no flag/config/scratch-DB state routes around it. **Verdict: adopting drizzle-kit 1.0 requires simultaneously adopting drizzle-orm 1.0 — i.e., two pre-release majors of the core DB layer at once, to fix a cosmetic dev-only lockfile warning. Clear no-go** (stronger reason than "it's just an RC"). `db:push` + vitest checks were therefore moot and skipped.
  - **Corrected the trigger** in Background AC and Dependencies: not "drizzle-kit 1.0 alone, independent of drizzle-orm" but "drizzle-kit 1.0 stable AND drizzle-orm 1.0, together." drizzle-orm 1.0 is a separate pre-release major from the held zod-4 / drizzle-zod hold (re-entanglement unverified — check on revisit).
  - **Open question for the scoped-override route (flagged, not tested):** once `@esbuild-kit` is gone, vite's `esbuild ^0.27||^0.28` _peer_ had no esbuild in scope (no root copy, none nested under vite/vitest — it's an optional peer). A scoped-nested-override that drops `@esbuild-kit` may _also_ need to hand vite a valid esbuild or risk breaking the vitest transform toolchain. Verify before pursuing that path.
