---
title: "Consolidate CoachChat and CoachOverlayContent into shared base"
status: in-progress
priority: low
created: 2026-04-29
updated: 2026-04-29
assignee:
labels: [coach, architecture, refactor]
---

# Consolidate CoachChat and CoachOverlayContent into shared base

## Summary

`CoachChat.tsx` (full-screen tab experience) and `CoachOverlayContent.tsx` (modal overlay from other screens) duplicate the message rendering tree and streaming wiring. A shared base would eliminate this at the component level.

## Background

As part of the coach chat feel/pacing redesign (2026-04-29 session), we extracted streaming logic into a `useCoachStream` hook — that removed the most impactful duplication. But the two components still have separate rendering trees (FlatList vs ScrollView, different nav shapes, different header treatments). Unifying them fully is a larger refactor deferred to its own session.

## Acceptance Criteria

- [ ] Identify the rendering surface differences (FlatList vs ScrollView, modal nav vs stack nav)
- [ ] Design a shared `<CoachChatBase>` that accepts the surface-specific parts as props or slots
- [ ] Migrate `CoachChat.tsx` to use the shared base
- [ ] Migrate `CoachOverlayContent.tsx` to use the shared base
- [ ] All existing tests pass; no regressions in either modal or full-screen flow

## Implementation Notes

- The main divergence is the scroll container: `CoachChat` uses `FlatList` (better for long history), `CoachOverlayContent` uses `ScrollView` (simpler modal). The shared base could accept a `scrollComponent` prop or render the list via a render-prop.
- Header and close button differ — easy to slot in via props.
- The `useCoachStream` hook (added in the feel/pacing session) already provides the unified streaming interface — the base component just consumes it.
- CoachOverlayContent also lacks voice input and retry — decide whether to add parity or keep it intentionally lighter.

## Dependencies

- Requires `useCoachStream` hook to be implemented first (coach feel/pacing session)

## Risks

- Modal and full-screen nav behaviours are subtly different; regression risk is moderate
- Keep the scope strictly to structural unification — don't layer new features in the same PR

## Updates

### 2026-04-29

- Initial creation — flagged during coach chat feel/pacing design session as future work
