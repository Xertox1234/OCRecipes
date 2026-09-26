---
title: "expo-notifications and expo-application are on SDK 55 majors while the app runs Expo SDK 54"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-26
assignee:
labels: [deferred, audit, dependencies]
github_issue:
---

# expo-notifications and expo-application are on SDK 55 majors while the app runs Expo SDK 54

## Summary

`expo-notifications` `^55.0.14` and `expo-application` `~55.0.10` are SDK-55 majors, while Expo SDK 54's `bundledNativeModules.json` expects `~0.32.17` and `~7.0.8`. `npx expo-doctor` lists both under major version mismatches.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M27** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `package.json:115` (expo-notifications), expo-application; pinned since #31.
- `npx expo-doctor` (run 2026-09-23, read-only) also reports minor skews (reanimated 4.3.1 vs ~4.1.1, worklets 0.8.3 vs 0.5.1, slider, svg; possibly deliberate for VisionCamera v5), patch skews, and 4 other failed checks (config schema, direct-install packages, duplicate deps, non-CNG sync). Those are out of front-end audit scope, but record them here.
- Risk: native/JS API mismatch in EAS builds; OTA runtime-version drift.

## Acceptance Criteria

- [x] A decision is recorded: align to SDK 54 versions (`npx expo install expo-notifications expo-application`) or document why SDK-55 majors are intentional (`expo.install.exclude`)
- [x] **N/A** — nothing was aligned (the decision was to KEEP the SDK-55 majors, not realign them), so there is no dev-client rebuild or device verification to do. See Updates for the reason.
- [x] The other expo-doctor failures are triaged in this todo's Updates (fix trivial ones or file follow-ups)

## Implementation Notes

Native dependency change means a new dev-client/EAS build is required and OTA compatibility must be checked (see reference_eas_update_ota memory). Do not bundle with unrelated work.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `package.json`
  - `package-lock.json`
  - `app.json (only if expo-doctor config fixes are in scope)`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Native module version changes require a store/dev-client build — cannot ship via OTA alone.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M27).

### 2026-09-26

**Decision (recorded via the orchestrator, resolves AC #1): KEEP the SDK-55 majors.**

`expo-notifications` stays at `^55.0.14` and `expo-application` stays at `~55.0.10`. Reason:
aligning them to SDK 54's expected versions (`~0.32.17` / `~7.0.8`) is a native-code change and
cannot ship via OTA. The user's installed preview build 5 (runtime `1.2.0`, per `app.json`) is
currently the only way fixes reach their device, via preview OTA — a native realignment would
need a brand-new EAS build first, which is out of scope for this todo. Documented instead of
aligned, per `docs/rules` — verified the correct opt-out key against current Expo docs (Context7,
`/expo/expo` sdk-54 branch, `docs/pages/versions/unversioned/config/package-json.mdx`): the
project-level `expo.install.exclude` array in `package.json` (not `app.json`). Added:

```json
"expo": {
  "install": {
    "exclude": ["expo-notifications", "expo-application"]
  }
}
```

**Before/after `npx expo-doctor` (read-only, no install/build run):**

Before — "Check that packages match versions required by installed Expo SDK" failed with a
`❗ Major version mismatches` table listing both packages, and reported "10 packages out of date":

```
❗ Major version mismatches
package                         expected  found
expo-application                ~7.0.8    55.0.10
expo-notifications              ~0.32.17  55.0.14
```

After — the `❗ Major version mismatches` table is gone entirely and the same check now reports
"8 packages out of date" (exactly two fewer — the excluded packages, not a resolution of the
other skews). `npx expo-doctor` still reports `5 checks failed` overall (unchanged) because the
other four failures below are unrelated to this exclusion.

**Revisit trigger:** re-evaluate this exclusion the next time an EAS native build is cut for this
app (post preview build 5 / runtime 1.2.0) — either realign the versions then, or re-confirm the
exclusion is still wanted.

**AC #3 — triage of the other 4 expo-doctor failures (assessed only; none fixed — each requires a
change outside this todo's Scope Contract or the hard "no dependency/node_modules/lockfile
change" constraint given for this run):**

1. **Config schema — icon files are JPEG bytes with a `.png` extension** (`./assets/images/icon.png`,
   `./assets/images/android-icon-foreground.png`). Fixing this means re-encoding/replacing binary
   image assets, not editing `package.json`/`package-lock.json`/`app.json` — outside this todo's
   Scope Contract file list. Not fixed.
2. **`expo-modules-core` installed directly.** `expo-modules-core` is declared directly in
   `package.json`'s top-level `dependencies` (`^3.0.29`) — that literal declaration is exactly
   what expo-doctor's "packages that should not be installed directly" check flags, independent
   of whether any app file imports it. No app code does: `grep -rn "expo-modules-core" client/
shared/ server/` finds only comments, so it may be a removable direct dependency the Expo core
   packages already provide transitively — but removing it is still a `package.json`/
   `package-lock.json`/`node_modules` change, which the run's hard constraints forbid. Not fixed.
3. **Duplicate native deps.** The `expo-constants@55.0.16` duplicate (nested under
   `expo-notifications/node_modules`) is a direct consequence of keeping `expo-notifications` on
   its SDK-55 major above — not an independent bug. The `expo-image-loader@6.0.0` ×2 duplicate is
   an ordinary node_modules dedupe artifact needing `npm dedupe`/reinstall. Both require
   `package-lock.json`/`node_modules` changes, forbidden this run. Not fixed.
4. **Non-CNG app-config sync.** `android/` and `ios/` are git-tracked native folders (74 tracked
   paths — bare/Prebuild workflow) alongside CNG-style properties (`orientation`, `icon`, `scheme`,
   etc.) in `app.json`. Resolving this is an architecture decision (drop the native folders vs.
   accept the non-sync), not a trivial/safe config fix. Not fixed.
5. **Remaining minor/patch version skews** (`react-native-reanimated`, `react-native-worklets`,
   `@react-native-community/slider`, `react-native-svg`, and patch skews on `expo`,
   `expo-constants`, `expo-font`, `expo-updates`). All require version bumps
   (`package.json`/`package-lock.json`/`node_modules` changes), forbidden this run. The todo's own
   Background note already flags the reanimated/worklets/slider/svg skew as "possibly deliberate
   for VisionCamera v5" — left as-is, no ruling sought.

Per the standing "do not file todos" ruling for this run, none of items 1–5 above were filed as
follow-up todos; they are reported to the user as `DEFERRED_WARNINGS` by the executor instead.
