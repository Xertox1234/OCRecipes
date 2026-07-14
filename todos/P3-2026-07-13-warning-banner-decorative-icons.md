<!-- Filename: P3-2026-07-13-warning-banner-decorative-icons.md -->

---

title: "Add accessible={false} to decorative icons in LabelAnalysisScreen warning banners"
status: backlog
priority: low
created: 2026-07-13
updated: 2026-07-13
assignee:
labels: [deferred, accessibility]
github_issue:

---

# Add accessible={false} to decorative icons in LabelAnalysisScreen warning banners

## Summary

Both the new `uploadFailed` warning banner and the pre-existing confidence-indicator banner in `LabelAnalysisScreen.tsx` render a decorative `<Feather name="alert-triangle" .../>` icon without `accessible={false}`, letting VoiceOver/TalkBack focus it as a separate, redundant node alongside the adjacent text.

## Background

Flagged by mobile-reviewer during the PR #617 code review. The new banner copied the pre-existing gap rather than introducing it — both should be fixed together in one pass per the project's accessibility rule ("Decorative icons inside labeled Pressables must have `accessible={false}`").

## Acceptance Criteria

- [ ] Both `Feather name="alert-triangle"` icons in `LabelAnalysisScreen.tsx` (the `uploadFailed` banner and the confidence-indicator banner) get `accessible={false}`
- [ ] No change to visual appearance; VoiceOver/TalkBack no longer double-focuses the icon + text

## Implementation Notes

- `client/screens/LabelAnalysisScreen.tsx` — search for `alert-triangle`
- See `docs/rules/accessibility.md` for the established pattern

## Dependencies

- None

## Risks

- None — purely additive a11y prop

## Updates

### 2026-07-13

- Filed from PR #617 mobile-reviewer finding
