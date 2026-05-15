---
title: "Finalize home page after feature gaps are filled"
status: backlog
priority: medium
created: 2026-03-19
updated: 2026-03-19
assignee:
labels: [home, finalize]
---

# Finalize Home Page After Feature Gaps

## Summary

The home page redesign shipped with placeholder behavior in a few spots that depend on features being built separately. Once those features exist, the home page itself needs updates to wire them in.

## Acceptance Criteria

- [ ] `HomeScreen.tsx` `handleActionPress` — replace TODO with actual premium upgrade modal call (depends on `home-premium-upgrade-prompt.md`)
- [ ] `HomeScreen.tsx` `handleCalorieTap` — update navigation from Profile placeholder to new daily nutrition detail screen (depends on `home-daily-nutrition-detail.md`)
- [ ] `action-config.ts` — add Create Cookbook entry once cookbook screen exists (depends on `home-create-cookbook-action.md`)
- [ ] Verify Adaptive Goal Card appears contextually in nutrition flows launched from home (depends on `home-adaptive-goal-contextual.md`)
- [ ] Verify recent actions icon-only transition works end-to-end (depends on `home-recent-actions-icon-transition.md`)

## Implementation Notes

All changes are in `client/screens/HomeScreen.tsx` or `client/components/home/action-config.ts`. The config-driven architecture means most updates are single-line changes.

This todo should be the **last** one completed — after all 5 dependency todos are done.

## Dependencies

- All 5 `home-*.md` todos must be completed first
