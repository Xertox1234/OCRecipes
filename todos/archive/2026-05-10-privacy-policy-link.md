---
title: "Privacy Policy link in app (CCPA/App Store requirement)"
status: backlog
priority: high
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [compliance, privacy, ui, deferred]
github_issue:
---

# Privacy Policy Link In-App

## Summary

Surface a tappable Privacy Policy link inside the app (Profile/Settings screen) so users can access it without leaving to an external browser search. Required by CCPA, PIPEDA, App Store guidelines, and Google Play policies.

## Background

Both Apple App Store (section 5.1.1) and Google Play (Data safety requirements) require that apps provide a link to their Privacy Policy accessible from within the app. CCPA requires the link to be "conspicuous." PIPEDA requires it to be "readily available." Currently no such link exists in the app UI. The Privacy Policy URL itself must be created separately (legal work, outside scope of this todo) and provided via an env var or hardcoded constant.

## Acceptance Criteria

- [ ] "Privacy Policy" tappable link exists in the Profile tab → Settings section
- [ ] "Terms of Service" tappable link exists alongside it (same row or adjacent)
- [ ] Tapping either link opens the URL in the system browser via `Linking.openURL()`
- [ ] URLs are sourced from a single constants file (e.g. `client/constants/legal.ts`) so they can be updated without touching screen code
- [ ] Links are accessible: `accessibilityRole="link"` and descriptive label
- [ ] App version and build number displayed nearby (common App Store requirement alongside legal links)

## Implementation Notes

- Read `docs/patterns/react-native.md` MUST CHECK section before writing JSX
- Profile settings screen: find the correct file under `client/screens/` — likely `ProfileScreen.tsx` or a settings sub-screen
- Constants file: `client/constants/legal.ts` — export `PRIVACY_POLICY_URL` and `TERMS_URL`, defaulting to `https://ocrecipes.app/privacy` and `https://ocrecipes.app/terms`
- Use `Linking` from `react-native` for `openURL`
- App version: use `expo-constants` (`Constants.expoConfig?.version`) for display
- Eligible for Copilot delegation (pure UI, no auth/health-data logic)

## Dependencies

- Privacy Policy and Terms of Service pages must be live at the configured URLs before the app ships
- Profile/Settings screen file path must be confirmed before implementation

## Risks

- If the Privacy Policy URL changes post-launch, a new app release is needed unless the URL is fetched from a remote config. Consider a remote config approach if the URL may change.

## Updates

### 2026-05-10

- Created from compliance review (North America launch planning)
