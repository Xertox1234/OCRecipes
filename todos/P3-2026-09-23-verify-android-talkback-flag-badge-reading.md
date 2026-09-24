---
title: "Verify on device whether TalkBack double-reads the allergen flag badges (audit claim contradicted by docs)"
status: backlog
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Verify on device whether TalkBack double-reads the allergen flag badges (audit claim contradicted by docs)

## Summary

The audit claimed that `accessible={true}` flag-badge containers are double-read on Android TalkBack. Research found no documentation support, so this todo is a device check, not a fix.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M12** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Sites: `client/screens/ScanScreen.tsx:1008-1043`, `client/camera/components/ProductChip.tsx:244-268`.
- Research: RN maps `accessible` → Android focusable with a contentDescription. Verdict `contradicted ⚠`.
- A separate real concern noted by research: both sites carry `accessibilityLiveRegion`, and a live-region content swap re-reads the whole chip.
- Method: `reference_talkback_emulator_verification` memory (uiautomator dump --compressed; adb input does NOT drive TalkBack).

## Acceptance Criteria

- [ ] uiautomator dump / TalkBack emulator check records whether children are separately focusable
- [ ] If double-read is confirmed: hide the children (`importantForAccessibility="no-hide-descendants"` on the inner content); if not, close as verified-false
- [ ] Live-region re-read behavior noted in Updates

## Implementation Notes

Verification-first todo. No code change unless the device check confirms the issue.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ScanScreen.tsx`
  - `client/camera/components/ProductChip.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Needs an Android emulator with TalkBack.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M12).
