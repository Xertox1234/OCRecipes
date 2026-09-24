---
title: "expo-notifications and expo-application are on SDK 55 majors while the app runs Expo SDK 54"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
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

- [ ] A decision is recorded: align to SDK 54 versions (`npx expo install expo-notifications expo-application`) or document why SDK-55 majors are intentional (`expo.install.exclude`)
- [ ] If aligned: dev-client rebuilt and notification scheduling + tap verified on a device/simulator; `npx expo-doctor` no longer reports the major mismatch
- [ ] The other expo-doctor failures are triaged in this todo's Updates (fix trivial ones or file follow-ups)

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
