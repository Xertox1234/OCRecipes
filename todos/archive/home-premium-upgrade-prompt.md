---
title: "Show premium upgrade prompt for locked home actions"
status: backlog
priority: medium
created: 2026-03-19
updated: 2026-03-19
assignee:
labels: [home, premium, upsell]
---

# Show Premium Upgrade Prompt for Locked Home Actions

## Summary

Tapping a premium-locked action on the home page (e.g., Generate Recipe) currently only fires a haptic warning. It should show an upgrade modal explaining the feature and offering a path to subscribe.

## Acceptance Criteria

- [ ] Tapping a locked action opens an upgrade prompt/modal
- [ ] Modal explains what the feature does
- [ ] Modal has a CTA to navigate to subscription screen
- [ ] Dismiss option available

## Implementation Notes

There's a `TODO` comment in `HomeScreen.tsx` `handleActionPress` where the upgrade prompt should be triggered. The app likely already has an upgrade modal component — check `UpgradeModal` or similar.

## Dependencies

- Subscription/upgrade flow must exist
