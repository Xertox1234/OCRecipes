---
title: "Status-colour follow-ups from the accessibility audit"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client, design-system]
github_issue:
---

# Status-colour follow-ups from the accessibility audit

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

Parts of H1/H2/M11 left for a design pass: (1) other white-content fills still on `theme.success`/`theme.error` in dark mode (e.g. CoachMicButton, VoiceLogButton, swipe-delete backgrounds, CookSessionCapture / MenuScanResult toasts) — check each, use successSolid/errorSolid where white content sits on them; (2) CookSessionCapture's allergen-check banner text over the live camera (allowlisted in status-text-colour-guard.test.ts); (3) DidYouKnowCard's link-coloured eyebrow and action on backgroundSecondary (4.43:1) needs a mode-aware shade or a different card fill; (4) the theme.ts comment about textSecondary on tinted surfaces and badgeNeutralText (#656565) now being lighter than textSecondary (#626262).

## Acceptance Criteria

- [ ] Each listed site measured and fixed or declined with a reason
- [ ] status-text-colour-guard allowlist emptied or justified

## Implementation Notes

Use test/utils/wcag-contrast.ts for the maths. Files as listed plus `client/constants/theme.ts`.

## Updates

### 2026-11-21

- Filed from the accessibility audit
