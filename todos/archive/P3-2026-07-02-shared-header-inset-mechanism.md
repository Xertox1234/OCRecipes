<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Own the transparent-header content inset in one shared place instead of 23 per-screen workarounds"
status: done
priority: low
created: 2026-07-02
updated: 2026-07-02
assignee:
labels: [deferred, ui]
github_issue:

---

# Own the transparent-header content inset in one shared place

## Summary

`useScreenOptions()` defaults `headerTransparent: true` for every stack screen, so every scrollable screen must individually remember to offset its content below the header. 22 screens do this with `useHeaderHeight()` + `paddingTop`, and SettingsScreen became the 23rd in PR #483. Move this obligation into one shared mechanism so new list screens can't re-hit the hidden-first-row bug.

## Background

PR #483's review (2026-07-02) traced the "Edit Profile hidden behind Settings header" bug to its root cause: `client/hooks/useScreenOptions.ts:13` sets `transparent = true` unconditionally, and no shared container owns the resulting top inset. Each screen author rediscovers the overlap and hand-rolls `paddingTop: headerHeight + Spacing.*`. The initial PR fix even used an iOS-only prop (`contentInsetAdjustmentBehavior="automatic"`), showing how easy it is to pick a wrong per-screen fix — the class of bug persists as long as the default pushes the obligation outward.

## Acceptance Criteria

- [x] A single shared mechanism supplies the header inset for scrollable screens under transparent headers (e.g. a `ScreenScrollView`/container component, or a `useScreenOptions` change that removes the per-screen obligation)
- [x] SettingsScreen and at least a representative sample of the 22 `useHeaderHeight` screens are migrated to it (full migration may be staged)
- [x] Behavior is identical on iOS and Android (no iOS-only props as the sole mechanism)
- [x] A `docs/rules/` entry (react-native or design-system domain) states the canonical mechanism so new screens don't hand-roll insets

## Implementation Notes

- Root cause: `client/hooks/useScreenOptions.ts:13,20` (`transparent = true` default → `headerTransparent: transparent`)
- Current workaround census: 22 files under `client/screens/` import `useHeaderHeight` from `@react-navigation/elements` and apply `paddingTop: headerHeight + Spacing.*` (e.g. `client/screens/SavedItemsScreen.tsx:103,235`, `client/screens/HistoryScreen.tsx:608,747`); `contentInsetAdjustmentBehavior="never"` opt-outs exist in `client/screens/FeaturedRecipeDetailScreen.tsx` and `client/components/recipe/RecipeDetailContent.tsx`
- Options to weigh: (a) shared `ScreenScrollView` wrapper that reads `useHeaderHeight()` internally; (b) flip the `useScreenOptions` default to `transparent: false` and opt IN per screen that actually wants the effect; (c) keep transparency but register a default `contentStyle` inset at the navigator level
- Changing the `useScreenOptions` default touches all 5 navigators — audit which screens visually rely on content scrolling under the blurred header before flipping it
- Scope hard-stop: this is a refactor of layout plumbing only; do not change header visuals/blur styling

## Dependencies

- None blocking; coordinate with any in-flight PRs that add new screens to avoid churn

## Risks

- Wide visual blast radius (20+ screens) — needs screenshot-level verification on both platforms, staged migration preferred
- Screens that deliberately scroll content under the transparent header (hero images) must keep their opt-out

## Updates

### 2026-07-02

- Initial creation from PR #483 review finding (altitude: per-screen inset workarounds on a shared-default root cause)

### 2026-07-05

- Implemented: `client/hooks/useHeaderContentInset.ts` (canonical inset hook, wraps `useHeaderHeight()`) plus `client/components/ScreenScrollView.tsx` (ScrollView wrapper built on the hook, for the common single-ScrollView case).
- Migrated 5 screens spanning all three container types in use (`ScrollView`, `FlatList`, `SectionList`): `SettingsScreen.tsx` (mandatory), `GoalSetupScreen.tsx`, `ItemDetailScreen.tsx`, `SavedItemsScreen.tsx`, `client/screens/meal-plan/PantryScreen.tsx`. Every migrated call site preserves its exact pre-existing padding value (no visual change). Remaining ~18 screens keep using `useHeaderHeight()` directly for now — migration is staged per the acceptance criteria.
- `useScreenOptions.ts` and the two intentional opt-out screens (`FeaturedRecipeDetailScreen.tsx`, `RecipeDetailContent.tsx`) were left untouched, per the scope hard-stop.
- Added a `docs/rules/react-native.md` rule documenting the canonical mechanism, and updated the existing post-mortem `docs/solutions/logic-errors/ios-only-scroll-inset-prop-leaves-android-header-overlap-2026-07-02.md` to point at it instead of this (now-closed) todo.
