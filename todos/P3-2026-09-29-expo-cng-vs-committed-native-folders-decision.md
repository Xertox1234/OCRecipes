<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Decide: drop the committed android/ios native folders for CNG, or accept the config-sync gap"
status: backlog
priority: low
created: 2026-09-29
updated: 2026-09-29
assignee:
labels: [deferred, harness, architecture]
github_issue:
human_led: true
blocked_reason: "Architecture decision between the Continuous Native Generation (CNG/managed) workflow and the current bare/Prebuild workflow with committed native folders — an executor must not pick a side. Needs the user's explicit ruling before any code changes."

---

# Decide: drop the committed android/ios native folders for CNG, or accept the config-sync gap

## Summary

`npx expo-doctor`'s "Check for app config fields that may not be synced in a non-CNG project" check fails because this project commits native `android/` and `ios/` folders (74 tracked paths — a bare/Prebuild workflow) while `app.json` also carries CNG-style properties (`orientation`, `icon`, `scheme`, `userInterfaceStyle`, `ios`, `android`, `plugins`, `androidStatusBar`). When the native folders are present, EAS Build does not sync those `app.json` properties into the native projects — so the two can silently drift out of sync. Resolving this is an architecture decision, not a bug fix: drop the native folders and move to the CNG/managed workflow (letting `expo prebuild` regenerate them from `app.json`), or keep the bare workflow and accept that `app.json`'s CNG-style properties are informational only for the native side.

## Background

Split out of `todos/archive/P3-2026-09-26-expo-doctor-dependency-hygiene.md` (item 4) on
2026-09-29, per that todo's orchestrator instructions: item 4 is explicitly the user's call, not
an executor decision, so it was carried forward here rather than resolved inline. The sibling
finding was first raised in the 2026-09-23 front-end audit (M27) and re-confirmed in the
2026-09-26 triage (#1106) and the 2026-09-29 dependency-hygiene pass — `npx expo-doctor` has
reported this check failing on all three occasions, unchanged.

Current `npx expo-doctor` output for this check (2026-09-29, read-only):

```
✖ Check for app config fields that may not be synced in a non-CNG project
This project contains native project folders but also has native configuration properties in
app.json, indicating it is configured to use Prebuild. When the android/ios folders are present,
EAS Build will not sync the following properties: orientation, icon, scheme, userInterfaceStyle,
ios, android, plugins, androidStatusBar.
```

Two paths, each with real tradeoffs:

1. **Adopt CNG (managed workflow).** Delete the committed `android/`/`ios/` folders, rely on
   `app.json` + config plugins + `npx expo prebuild` to regenerate native projects on demand (EAS
   Build does this automatically). Pro: single source of truth (`app.json`), no drift possible,
   smaller repo, standard Expo workflow. Con: any hand-edited native code (check for
   customizations beyond what `plugins/strip-push-entitlement.js` and the declared config plugins
   already cover) would need to be ported to a config plugin or lost; this project uses
   `react-native-vision-camera` and other native modules whose native-side setup should be
   re-verified survives a clean `prebuild`.
2. **Keep the bare workflow, accept the gap.** Continue committing `android/`/`ios/`, and treat
   `app.json`'s CNG-style properties as either dead/informational or as the values that were
   already baked into the native projects at some past `prebuild` — with the risk that a future
   `app.json` edit to one of the listed properties (`orientation`, `icon`, `scheme`,
   `userInterfaceStyle`, `ios`, `android`, `plugins`, `androidStatusBar`) silently does nothing on
   native builds unless someone remembers to also hand-edit the native project. This is the
   current de facto state; expo-doctor will keep failing this check indefinitely unless it's
   explicitly excluded or the workflow changes.

## Acceptance Criteria

- [ ] The user makes and records an explicit decision: adopt CNG (drop `android/`/`ios/`) or keep
      the bare workflow (accept the config-sync gap).
- [ ] If CNG is chosen: a follow-up todo is created scoping the migration (verify all native
      customizations are captured in config plugins, run `expo prebuild --clean`, rebuild via EAS,
      re-test on a device) — this todo itself does not perform the migration.
- [ ] If the bare workflow is kept: record the reasoning, and decide whether to silence the
      expo-doctor check (there is no documented `expo.install.exclude`-equivalent for this
      specific check — a plain acceptance/no-op may be the only option) or leave it failing as a
      known, permanent finding.

## Implementation Notes

- This is a **decision todo**, not an implementation todo. Do not autonomously pick a side.
- See `todos/archive/P3-2026-09-26-expo-doctor-dependency-hygiene.md` Updates (2026-09-29) for the
  sibling items (1–3) that were resolved in the same triage pass.
- See `docs/solutions/conventions/expo-doctor-intentional-major-skew-exclude-2026-09-26.md` for
  how _version-skew_ findings are documented — note its own scope is major-version skews via
  `expo.install.exclude`, which does not cover this check.

## Scope Contract

- **Mechanisms to use:** the standard `human_led: true` frontmatter gate — nothing new.
- **Files in scope:** none yet — this todo only records a decision. A follow-up implementation
  todo (if CNG is chosen) would scope `android/`, `ios/`, `app.json`, and EAS build config.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Whichever direction is chosen, this is effectively irreversible without significant rework:
  dropping the native folders means regenerating them from `app.json` + plugins in the future;
  keeping them means the config-sync gap persists indefinitely.
- A CNG migration is a native-code change and would require a new EAS build/dev-client before it
  reaches the user's device (same "preview build 5" constraint noted throughout the sibling todo).

## Updates

### 2026-09-29

- Split out from `todos/archive/P3-2026-09-26-expo-doctor-dependency-hygiene.md` item 4, per that
  todo's orchestrator instructions (item 4 is the user's decision, not an executor call).
