---
title: "Clear the dev-tooling npm audit alerts (drizzle-kit's esbuild chain, @expo/ngrok's uuid)"
status: done
priority: low
created: 2026-11-18
updated: 2026-11-18
assignee:
labels: [deferred, security, dependencies]
github_issue:
---

# Clear the dev-tooling npm audit alerts (drizzle-kit's esbuild chain, @expo/ngrok's uuid)

## Summary

`npm audit` reports 6 moderate advisories, all in dev tooling that never ships to production: drizzle-kit's `@esbuild-kit/*` → `esbuild <=0.24.2` (dev-server CORS) and `@expo/ngrok` → `uuid <11.1.1` (v3/v5/v6 buffer bounds). Bump or override them so the security scanner runs clean.

## Background

Security audit 2026-11-18 (`docs/audits/2026-11-18-security.md`, rows SCAN-NPMA-1…6). The owner chose one tracking todo (2026-11-18). Nothing in the server or app bundle uses these packages at runtime: esbuild's advisory is about its dev server, which this project never runs; uuid's is in versions only @expo/ngrok (the `--tunnel` helper) pulls in.

## Acceptance Criteria

- [x] `npm audit --json` shows none of: `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`, `esbuild` (<=0.24.2), `@expo/ngrok`, `uuid` (<11.1.1) — or each remaining one is recorded here with why it can't move yet.
- [x] `npm run db:push` / drizzle-kit commands still work after the change.
- [x] No runtime dependency changes (check `git diff package-lock.json` touches only the dev chains).

## Implementation Notes

- Check whether a current drizzle-kit release has dropped `@esbuild-kit/*`; otherwise an `overrides` entry for `esbuild` under drizzle-kit.
- `@expo/ngrok` is used only by `expo start --tunnel`; an `overrides` for `uuid` may be enough. Confirm `expo start --tunnel` still starts.
- Re-run: `npx tsx scripts/audit-scanners.ts security`.

## Scope Contract

- **Mechanisms to use:** version bumps or `overrides` in `package.json` — nothing new
- **Files in scope:** `package.json`, `package-lock.json`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- drizzle-kit majors change CLI behaviour; read its changelog before bumping.

## Updates

### 2026-11-18

- Initial creation from the 2026-11-18 security audit.

### 2026-11-18 (done)

- No drizzle-kit release drops `@esbuild-kit/*` (latest stable is 0.31.11, already installed), so both fixes are nested `overrides`:
  - `@esbuild-kit/core-utils` → `esbuild ^0.25.12`. drizzle-kit only declares `@esbuild-kit/esm-loader`; no file in the package except its `package.json` names it (it loads TS through its own `tsx`/`esbuild`), so this code never runs and `db:push` is unaffected.
  - `@expo/ngrok` → `uuid ^11.1.1`, the newest line that still ships CommonJS. ngrok's only use is `require("uuid").v4()` (`index.js:28`), checked working on 11.1.1.
- `npm audit`: 6 moderate → 0. Every changed lockfile entry is `dev: true` (the nested esbuild + platform binaries, and uuid).
