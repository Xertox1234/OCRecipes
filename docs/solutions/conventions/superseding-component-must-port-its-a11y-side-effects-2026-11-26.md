---
title: "A component that supersedes another must port every accessibility side effect it had, not just the ones its brief names"
track: knowledge
category: conventions
tags: [accessibility, react-native]
module: client
applies_to: ["client/components/**/*.tsx", "client/camera/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-11-26
---

# A component that supersedes another must port every accessibility side effect it had, not just the ones its brief names

## Rule

When a new component replaces an old one (a rewrite, a redesign, a "replaces X" task), list the old component's accessibility side effects first — every `announceForAccessibility` call and its trigger, every `accessibilityLiveRegion`, label composition, state flags, focus traps — and port each one or record an explicit decision to drop it. Delete the old component only after that list is accounted for.

## Why

Side effects are invisible in the UI and rarely in a task brief. In the guided scan camera stage 1, `StepTabs` replaced `StepPill`. The brief's test list named only the "<label> step complete" announcement, so the new component shipped without `StepPill`'s iOS "<label> step in progress" announcement (fired when a step became active, including on mount) and without its `accessibilityLiveRegion="polite"`. The visible step bar looked complete; VoiceOver and TalkBack users silently lost the "you are now on step N" cue. Both task reviewers caught it only because the plan's global constraints said "the existing StepPill announcements are carried over". The same carry-over then exposed a second interaction: two tabs changing in one commit fired two announcements, and iOS kept only the last (see See Also).

## Examples

- `client/camera/shell/StepTabs.tsx` ports both `StepPill` announcements (iOS only), the live region, and composes the visible sublabel into the label ("Front, optional, done"). The two per-tab announcements go through `announceTogether` so a two-tab transition is one utterance.
- Write the carry-over list into the plan's constraints ("X's announcements and live-region behaviour carry over") so the reviewer has something to check the diff against.

## Exceptions

- Dropping a side effect on purpose is fine when the replacement covers it another way (e.g. a screen-level announcement). Say so in the commit or PR body; an undocumented drop is the defect.

## Related Files

- `client/camera/shell/StepTabs.tsx`
- `client/lib/announce-together.ts`

## See Also

- [two-announceforaccessibility-same-commit-collide-ios](../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md) — why the ported per-tab announcements had to be merged
- [on-open-announce-must-delay-past-modal-present-focus-shift](on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md) — the Alert-to-in-app-dialog case of the same rule
