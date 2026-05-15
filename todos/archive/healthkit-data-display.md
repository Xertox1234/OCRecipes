---
title: "Cross-platform health data sync and display"
status: backlog
priority: medium
created: 2026-03-20
updated: 2026-03-25
assignee:
labels: [ui, health-data, data-display, cross-platform, android, ios]
---

# Cross-Platform Health Data Sync and Display

## Summary

HealthKit integration syncs steps, sleep, workouts, and active energy from Apple Health, but the app never displays this data to users. Additionally, Android users have no health data integration at all. This todo covers both surfacing synced data and making the feature cross-platform via Google Health Connect on Android.

## Background

`HealthKitSettingsScreen` lets iOS users enable syncing for weight, steps, workouts, active energy, and sleep. The `healthkit-sync.ts` service reads this data. However:

1. **No screen or component surfaces the synced data** — it's collected but invisible
2. **Android has no equivalent** — `healthKitAvailable` hard-gates to `Platform.OS === "ios"`, so Android users see nothing
3. **The native module isn't installed yet** — `client/lib/healthkit.ts` is a stub, making now the right time to build the abstraction layer before committing to a single-platform implementation

## Acceptance Criteria

### Cross-platform abstraction

- [ ] Create platform-agnostic health data layer (`client/lib/health-data.ts`) with `.ios.ts` and `.android.ts` platform extensions
- [ ] Rename `useHealthKit` hook → `useHealthData` (or similar) importing from the abstraction layer
- [ ] iOS implementation wraps HealthKit (via `react-native-health` or similar)
- [ ] Android implementation wraps Health Connect (via `react-native-health-connect`)
- [ ] Add Health Connect permissions to `app.json` Android config
- [ ] Settings screen shows "Apple Health" on iOS, "Health Connect" on Android
- [ ] Android gracefully handles Health Connect unavailability (Android < 14 without the app installed)

### Data display

- [ ] Users can view synced step counts somewhere in the app (Profile section)
- [ ] Users can view synced workout sessions
- [ ] Users can view active energy / calories burned
- [ ] Sleep data is surfaced if synced
- [ ] Data display updates when user manually triggers sync
- [ ] Clear empty states when no data is synced yet

### Backend

- [ ] Server stores steps, sleep, and active energy data (currently only weight is persisted)
- [ ] Consider renaming `/api/healthkit/*` → `/api/health/*` (source-agnostic)

## Implementation Notes

- **Platform extensions**: Use `.ios.ts` / `.android.ts` file extensions — RN bundler resolves automatically, no `Platform.OS` checks in consuming code
- Place health data display in **Profile** as a lightweight summary card, not a dedicated tab (camera/OCR is the app's identity)
- Keep it informational — avoid scope creep into health dashboard territory
- Consider whether exercise calories should factor into the daily calorie budget display
- The `healthkit_sync` table is settings/metadata only — actual health data needs domain-specific tables (steps, sleep, etc.)

## Dependencies

- HealthKit sync infrastructure exists (settings screen, server endpoint, sync service)
- Needs native packages installed: `react-native-health` (iOS) + `react-native-health-connect` (Android)
- Backend needs new storage for steps/sleep/active energy (only weight is persisted today)

## Risks

- Scope creep into health-tracker territory — keep display minimal and informational
- HealthKit permission edge cases on different iOS versions
- Health Connect requires Android 14+ natively, or a separate app install on Android 9-13
- Two native health packages to maintain and keep compatible

## Updates

### 2026-03-25

- Expanded scope to cross-platform: added Android Health Connect support, platform abstraction layer, and backend storage gaps
- Renamed from "Display synced HealthKit data" to "Cross-platform health data sync and display"

### 2026-03-20

- Initial creation from feature audit
