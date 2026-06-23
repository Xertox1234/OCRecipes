---
title: "RESOLVED: esbuild/vite root-hoist mis-resolution — fixed by declaring esbuild as a direct devDependency"
status: done
priority: low
created: 2026-06-01
updated: 2026-06-23
assignee:
labels: [deferred, dependencies]
github_issue:
---

# Track esbuild/vite lockfile mis-resolution (esbuild@0.18.20)

## Summary

A dev-only lockfile mis-resolution: **`vite@8.0.14` declares `esbuild ^0.27 || ^0.28` but resolves to a root-hoisted `esbuild@0.18.20`**, dragged in by the deprecated `@esbuild-kit/*` chain under `drizzle-kit`. So vitest's transform toolchain runs on a 7-major-stale esbuild and `npm ls` reports a standing `ELSPROBLEMS`. This is **lockfile hygiene, not a live CVE** — the related esbuild dev-server CORS advisory (`GHSA-67mh-4wv8-2f99`) was dismissed `not_used` because vitest uses vite as a transform library and never runs `esbuild serve`. The clean fix is **blocked on upstream**: removing `@esbuild-kit` requires adopting **drizzle-kit 1.0 _and_ drizzle-orm 1.0 together**, both still pre-release.

> **Scope narrowed 2026-06-22.** This todo previously triaged + tracked three (later expanded to a larger set of) transitive Dependabot alerts. That work is **done**: the full backlog is **0 open** (17 fixed / 10 dismissed), with uuid #4 and brace-expansion #2 dismissed `tolerable_risk`. The general pre-launch re-triage of the runtime-adjacent dismissed alerts is a launch-checklist concern, not a dependency-hygiene watchpoint, and is **no longer tracked here**. This file is now the single home for **just the esbuild lockfile-hygiene item**. The pre-narrowing history (uuid / brace-expansion / undici / form-data / ws / vite triage) is preserved in git (last full version at commit `f7489469`).

## Background

The discriminating fact for the dismissed CORS advisory was **reachability**: esbuild is a build/dev/test-only tool, never bundled into the RN client or emitted into `server_dist/`, and the CVE needs `esbuild serve` (which vite/vitest/drizzle-kit do not invoke). So the _security_ dimension is closed.

What remains is the resolution defect (`npm ls`, re-verified 2026-06-22):

- `vite@8.0.14` declares `esbuild ^0.27 || ^0.28` but resolves to a root-hoisted `esbuild@0.18.20` → `esbuild@0.18.20 invalid: "^0.27.0 || ^0.28.0"` under `vitest → vite`.
- Root cause: the deprecated `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2` chain hard-pins `esbuild ~0.18.20` and hoists it to root `node_modules`.
- **Blunt override is unsafe** — forcing `esbuild@^0.25` won't satisfy vite@8's `^0.27 || ^0.28` peer and risks transform breakage; the `@esbuild-kit` chain wants `~0.18`, so no single pin satisfies both.

## Acceptance Criteria

- [x] **esbuild — RESOLVED 2026-06-23 (NOT blocked on upstream after all):** fixed by declaring `esbuild: ^0.28.0` as a **direct devDependency** (see the 2026-06-23 resolution entry below). The "blocked on drizzle-kit/drizzle-orm 1.0" framing was wrong — it assumed the only fix was _removing_ `@esbuild-kit`. The original (now-falsified) note is preserved here for history: ~~the `vite@8`→`esbuild@0.18.20` mis-resolution can't be cleanly fixed yet.~~ `drizzle-kit@0.31.10` is the latest stable and **still** declares `@esbuild-kit/esm-loader: ^2.5.5`, so there's no newer stable release to bump to. The `@esbuild-kit` removal landed only in the `drizzle-kit@1.0.0-beta/rc` line (now `jiti@^2.6.1` + `esbuild@^0.25.10`). **Revisit when `drizzle-kit` 1.0 ships stable _and_ `drizzle-orm` 1.0 ships stable, adopted together** — drizzle-kit 1.0 has a **runtime** coupling: it `import`s `drizzle-orm/_relations`, an internal subpath that exists only in the unreleased drizzle-orm 1.0 line (our `drizzle-orm@0.45.2` lacks it → `drizzle-kit --version` itself crashes `ERR_PACKAGE_PATH_NOT_EXPORTED`). drizzle-orm 1.0 is a _separate_ pre-release major from the held zod-4 / drizzle-zod hold; whether adopting it re-entangles that hold is **unverified** (verify on revisit). On revisit, confirm `npm ls esbuild` resolves cleanly (no `ELSPROBLEMS`, vite's `^0.27||^0.28` peer gets a valid copy) **and** `npm run test:run` still passes before asserting the fix works. Do NOT blunt-override.
- [x] **Done (2026-06-22):** the esbuild Dependabot alert (#1, `GHSA-67mh-4wv8-2f99`) is dismissed `not_used` — a _reachability_ dismissal, **not** a fix; the on-disk `esbuild@0.18.20` mis-resolution still persists. Tracking continues as a lockfile-hygiene watchpoint, above.

## Implementation Notes

- Existing `overrides` block: `package.json → "overrides"`. Any new pin would go here — but per the triage a blunt entry is **unsafe** (vite wants `^0.27||^0.28`, the `@esbuild-kit` chain wants `~0.18` — no single pin satisfies both). The failure mode is "just override it."
- **Scoped-nested-override route (open question, flagged not tested):** once `@esbuild-kit` is gone, vite's `esbuild ^0.27||^0.28` is an _optional peer_ with no esbuild in scope (no root copy, none nested under vite/vitest). A scoped-nested override that drops `@esbuild-kit` may _also_ need to hand vite a valid esbuild or risk breaking the vitest transform toolchain. Verify before pursuing.
- Dependabot config: `.github/dependabot.yml` (security-only/grouped/version-off, with `expo >=55` + zod pin ignores). See memory `project_dependabot_ci_security_posture`.

## Dependencies

- **Trigger:** `drizzle-kit` 1.0 stable **and** `drizzle-orm` 1.0 (both currently pre-release), adopted **together** — drizzle-kit 1.0 runtime-requires `drizzle-orm/_relations` (1.0-only). Independent of any Expo SDK upgrade; a _separate_ pre-release major from the held zod-4 / drizzle-zod hold (re-entanglement unverified — see memory `project_drizzle_zod_zod4_coupling`). The scoped-nested-override path (above) is the only near-term route to dropping `@esbuild-kit` without the dual major upgrade.

## Risks

- Low. The standing risk is the **process** one: a blunt `overrides` entry that breaks vite's transform toolchain. The "blunt override unsafe" note is the guardrail. Severity does not change at production launch — esbuild never ships in the RN bundle or `server_dist/`.

## Updates

### 2026-06-01

- Filed after triaging the default-branch Dependabot alerts surfaced by the PR #317/#318 merges. esbuild flagged as the one genuinely actionable lockfile-hygiene item. Advisor-reviewed triage.

### 2026-06-02

- Attempted to pick up the esbuild item; **not cleanly actionable.** Live re-verification confirmed the `ELSPROBLEMS` persists: `vite@8.0.14` still resolves to the root-hoisted `esbuild@0.18.20` (from `drizzle-kit → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2`), against vite's `^0.27 || ^0.28` peer range.
- **Both proposed fixes dead today:** (1) `drizzle-kit` is already on latest published (`0.31.10`) and still declares `@esbuild-kit/esm-loader: ^2.5.5`; (2) `npm dedupe --dry-run` proposes churning ~63 packages without cleanly re-nesting vite's esbuild. Reclassified from "the one actionable item" to "blocked on upstream."
- **Empirical eval of `drizzle-kit@1.0.0-rc.3`** (isolated worktree + scratch DB, since removed). Two-arm fresh-resolve A/B (control = current versions, treatment = RC):
  - **esbuild benefit is REAL:** the RC drops the `@esbuild-kit` chain entirely → **0 occurrences of `esbuild@0.18.20`** (control fresh-resolve still had 23, all nested under `@esbuild-kit`). A plain lockfile refresh/dedupe does **not** remove `0.18.20` (still nested) and leaves vite outside `^0.27||^0.28` — only removing `@esbuild-kit` is a real fix.
  - **HARD BLOCKER — RC is dead on arrival with our drizzle-orm:** `drizzle-kit --version` (not just `push`) crashes `ERR_PACKAGE_PATH_NOT_EXPORTED: ./_relations is not defined by exports in drizzle-orm`. Our `drizzle-orm@0.45.2` exports `./relations` but not `./_relations`; that internal subpath ships only in the unreleased drizzle-orm 1.0 line. It's a top-level `import`, so no flag/config routes around it. **Verdict: adopting drizzle-kit 1.0 requires simultaneously adopting drizzle-orm 1.0 — two pre-release majors of the core DB layer at once, to fix a cosmetic dev-only lockfile warning. Clear no-go.**
  - **Open question for the scoped-override route (flagged, not tested):** once `@esbuild-kit` is gone, vite's `esbuild ^0.27||^0.28` _peer_ had no esbuild in scope (optional peer). A scoped-nested override may _also_ need to hand vite a valid esbuild or risk breaking the vitest transform toolchain. Verify before pursuing.

### 2026-06-22 (`/todo` re-verification, then scope-narrowed)

- Re-pulled live state (`gh api .../dependabot/alerts`, `npm ls`, `npm view`). **esbuild trigger still UNFIRED:** `drizzle-kit` latest = `0.31.10` (1.0 only at `1.0.0-rc.4`, pre-release), `drizzle-orm` latest = `0.45.2` (1.0 still pre-release). The dual pre-release-major adoption documented in the 2026-06-02 eval is still required and still a no-go.
- On-disk **unchanged**: `npm ls` still reports `esbuild@0.18.20 invalid: "^0.27.0 || ^0.28.0"` under `vitest → vite@8.0.14`, hoisted via `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2` (ELSPROBLEMS persists).
- The esbuild Dependabot alert (#1) is now dismissed `not_used` — a _reachability_ dismissal, **not** a fix.
- **Scope narrowed to esbuild-only.** The Dependabot alert backlog this todo originally tracked is fully cleared (0 open; uuid #4 + brace-expansion #2 dismissed `tolerable_risk`; expanded undici/form-data/ws/vite set fixed-or-dismissed). The general pre-launch re-triage of dismissed runtime-adjacent alerts is reclassified as a launch-checklist item and dropped from this todo. Retitled; Summary/Background/AC/Notes/Dependencies/Risks rewritten to the esbuild lockfile-hygiene item alone. Pre-narrowing history preserved in git (commit `f7489469`). Status remains `blocked` — genuinely blocked on upstream, kept as the standing watchpoint for the esbuild fix.

### 2026-06-23 (RESOLVED — the "blocked on upstream" framing was wrong)

The blocker was **misdiagnosed**. The prior triage assumed the only fix was _removing_ the `@esbuild-kit` chain, which requires the drizzle-kit + drizzle-orm 1.0 dual pre-release adoption. That premise was false.

**Actual root cause:** `vite@8.0.14` declares `esbuild` as a **`peerDependency`** (`^0.27 || ^0.28`), not a regular dependency — so it resolves the _root-hoisted_ `node_modules/esbuild`. **Nothing in the repo declared esbuild directly**, so the root slot was filled by accident with the `0.18.20` that the deprecated `@esbuild-kit/core-utils` chain hoists. Worse: `server:build` invokes the **esbuild CLI directly** (`esbuild server/index.ts …`) with esbuild undeclared, so the _production server bundler_ was also silently running on that accidental, 9-major-stale `0.18.20`.

**Fix (one line):** declare `esbuild: ^0.28.0` as a direct **devDependency**. A direct dep deterministically claims the root `node_modules` slot — the hoist lever that `overrides` cannot pull (overrides control version, not placement; and a `vite > esbuild` override can't inject a _peer_, both empirically confirmed). `@esbuild-kit/core-utils` then auto-nests its own `0.18.20` (still valid for its `~0.18.20`), so drizzle-kit's `db:push` loader is untouched. **No `overrides` entry needed.**

**Verified:** `npm ls esbuild` clean (exit 0, no `invalid:`/`ELSPROBLEMS`); vite resolves `0.28.1` (in peer range); `@esbuild-kit` keeps nested `0.18.20`; `drizzle-kit --version` works (no `ERR_PACKAGE_PATH_NOT_EXPORTED`); `server:build` produces a valid 874kb ESM bundle on `0.28.1`; `npm run preflight` passes (full suite + coverage). Audit posture improved: GHSA-67mh-4wv8-2f99 is now confined to the dev-only nested `@esbuild-kit` copy (the already-dismissed `not_used`/unreachable item); the root esbuild that `server:build` + vitest actually use is patched `0.28.1`.

Status → `done`. Archived. The drizzle-kit/drizzle-orm 1.0 dual-major upgrade remains tracked separately under the zod-4/drizzle-zod hold (memory `project_drizzle_zod_zod4_coupling`) — it is **no longer a prerequisite for anything in this todo**.
