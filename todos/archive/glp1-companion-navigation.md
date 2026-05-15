---
title: "Surface GLP-1 companion screen in navigation"
status: done
priority: medium
created: 2026-03-20
updated: 2026-03-24
assignee:
labels: [ui, navigation, health]
---

# Surface GLP-1 Companion Screen in Navigation

## Summary

The GLP1CompanionScreen exists and is functional but is hidden from the settings menu and main navigation. Users have no way to discover or access it.

## Background

The screen supports logging GLP-1 medication doses (semaglutide, tirzepatide, liraglutide, dulaglutide), tracking side effects, appetite levels, and generating insights. It's accessible via ProfileStackNavigator but isn't listed in the Profile/Settings menu.

## Acceptance Criteria

- [x] GLP-1 Companion is accessible from Profile/Settings screen
- [x] Entry point has appropriate icon and description
- [x] Only shown to users who have indicated GLP-1 medication use (or available as opt-in)
- [x] Navigation works correctly (back button returns to settings)

## Implementation Notes

- Screen already exists: `GLP1CompanionScreen`
- Route is registered in `ProfileStackNavigator`
- Consider whether this should be conditionally shown based on user's health conditions in dietary profile
- May need a settings entry in `ProfileScreen.tsx`

## Dependencies

- None — screen and route already exist

## Risks

- None significant — this is primarily a navigation/discoverability fix

## Updates

### 2026-03-20

- Initial creation from feature audit

### 2026-03-24

- Added "GLP-1 Companion" SettingsItem with "activity" icon to ProfileScreen SettingsSection
- Positioned between Dietary Profile and Nutrition Goals (health-related grouping)
- Wired navigation handler to existing GLP1Companion route in ProfileStackNavigator
- Always visible (backend gates behind premium; no client-side glp1Mode query needed)
- Back button navigation works via native-stack default behavior
