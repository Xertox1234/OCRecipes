---
title: "Home: sections can show an expanded chevron with no rows on first load"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, react-native, ux]
github_issue:
---

# Home: sections can show an expanded chevron with no rows on first load

## Summary

After a cold launch, Home's collapsible sections (Nutrition & Health, Recipes, Planning) can
show the expanded chevron and report `expanded` to accessibility, but render no rows. Tapping
the header collapses it; a second tap shows the rows. Find the cause and make the first
render show the rows.

## Background

Seen three times on the iPhone 17 simulator on 2026-09-26, on both `main` and the Quick Log
branch, right after launching the dev client:

- First launch: Nutrition & Health and Recipes showed the down chevron (expanded), with no
  rows under them; Planning showed its rows.
- A later launch: Recipes and Planning were expanded and empty.
- Maestro's view tree listed the section headers as `expanded` but had no row elements
  under them.

It makes the page look short and hides actions. Not yet reproduced on a device; it may be
a simulator timing effect (the section body is height-animated and measured on layout).

## Acceptance Criteria

- [ ] Reproduce with a cold launch on the simulator (record how often, with screenshots) or
      show it does not reproduce on a device.
- [ ] If reproducible: record the cause in Updates, then fix it so an expanded section shows
      its rows on the first render.
- [ ] A test covers the fix where the logic is testable; otherwise simulator evidence.

## Implementation Notes

- Start in `client/components/home/CollapsibleSection.tsx` (height animation and measurement)
  and the persisted section state in `client/hooks/useHomeActions.ts` /
  `client/lib/home-actions-storage.ts`: the persisted "expanded" flag may apply before the
  body has measured, leaving a zero-height open section.
- Compare with `useCollapsibleHeight` (`client/hooks/useCollapsibleHeight.ts`), which the
  inline drawers use.

## Scope Contract

- **Mechanisms to use:** the existing collapsible-height measurement; no new animation
  mechanism.
- **Files in scope:**
  - `client/components/home/CollapsibleSection.tsx`
  - `client/hooks/useHomeActions.ts`, `client/lib/home-actions-storage.ts`
  - their co-located `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-09-26

- Filed while verifying the Quick Log fixes on the simulator.
