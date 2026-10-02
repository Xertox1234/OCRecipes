---
title: "A function headerTitle makes native-stack title the screen with its route NAME, and iOS copies it into the next screen's back button, VoiceOver label and history menu"
track: bug
category: logic-errors
module: client
severity: low
tags: [react-native, react-navigation, native-stack, navigation, accessibility, ios]
applies_to: ["client/hooks/useScreenOptions.ts", "client/navigation/*StackNavigator.tsx"]
symptoms: ["The iOS back button next to a pushed screen's title reads the previous route's internal name (GroceryLists, MealPlanHome, CookbookList) instead of a human label", "VoiceOver reads the raw route name for the back button", "Long-pressing the iOS back button lists raw route names in its history menu", "headerBackButtonDisplayMode minimal hides the visible back label but VoiceOver still reads the raw route name"]
created: '2026-10-02'
---

# A function headerTitle leaks the route name into the iOS back button

## Problem

Almost every pushed screen in the Plan, Coach and Profile stacks sets `headerTitle`
to a function (`() => <HeaderTitle title="Plan" />`), and the header-hidden screens
set none. On iOS the back button on a pushed screen then showed the PREVIOUS route's
internal name — `< MealPlanHome`, `< GroceryLists`, `< CookbookList` — instead of
anything a user would read. Nothing is wrong with the button itself; it navigates
correctly. (A string `headerTitle`, such as the Chat screen's "NutriCoach", is used
as the title as-is and does not leak.)

## Symptoms

- The visible back label is a camel-cased route name.
- The back button's VoiceOver label is the same raw name (Maestro
  `hierarchy` `accessibilityText`, resource-id `BackButton`).
- Long-pressing the back button opens a history menu whose entries are raw route
  names.
- `headerBackButtonDisplayMode: "minimal"` removes only the visible label; the
  other two surfaces keep the raw name.

## Root Cause

`useHeaderConfigProps` (native-stack) computes the native `title` as
`getHeaderTitle({ title, headerTitle }, route.name)`, which returns the ROUTE NAME
when `headerTitle` is a function and `title` is unset. react-native-screens'
`configureBackItem` (`RNSScreenStackHeaderConfig.mm`) then writes
`prevItem.backButtonTitle = <the pushed screen's headerBackTitle> ?? prevItem.title`,
so the previous screen's title lands on its `backButtonTitle`. UIKit takes three
separate surfaces from it: the visible label, the back button's VoiceOver label,
and the history menu entries (measured: setting only `headerBackTitle` changed all
three while the screens' `title` stayed the route name).

Header-hidden parents (`headerShown: false`, e.g. ChatList, CoachPro, Profile) have
no title either, so their route name is used the same way.

Measured on the iOS 26.5 simulator (iPhone 17 Pro), Plan > Grocery Lists > list
and Profile > Cookbooks > cookbook:

| Config                                    | Visible label  | VoiceOver label | History menu            |
| ----------------------------------------- | -------------- | --------------- | ----------------------- |
| none (before)                             | `< GroceryLists` | `GroceryLists`  | `CookbookList`, `Profile` |
| `headerBackButtonDisplayMode: "minimal"`  | chevron only   | `MealPlanHome` (raw) | not measured       |
| `headerBackTitle: "Back"` (after)         | `< Back`       | `Back`          | `Back`, `Back`          |

A per-screen `headerBackTitle` can name the previous screen: it is read from the
pushed screen's own config and labels that screen's back button, which goes back
there. The catch is that it must name the screen below, which is not fixed: the same
screens are registered in the Plan, Coach and Profile stacks, some with a different
screen below them in each (CookbookList is pushed from MealPlanHome, CoachPro and
Profile), so each stack needs its own label, and a screen reached from several
screens in one stack (RecipeCreate) has no single right label.

## Solution

One shared option in `useScreenOptions` (every stack passes it as `screenOptions`):

```ts
headerBackTitle: "Back",
```

It overrides `backButtonTitle` for every pushed screen, including ones added later
and ones whose parent has a hidden header. It does not change `backTitleVisible`:
that is unset on the normal path (react-native-screens defaults it to true) and
explicitly `true` where the back-button menu is disabled, which native-stack does on
screens with an active `usePreventRemove`, so those screens keep their existing
menu-hidden custom back item and only get the new text (source-read; on RecipeCreate
the label and VoiceOver text were checked on the simulator, the hidden menu was not).
Android ignores it (iOS and web only).

Checked on the Plan, Profile and Coach stacks. The Coach case has a header-hidden parent:
`xcrun simctl openurl booted ocrecipes://chat/1` pushes Chat over CoachPro, and its back
button reads `< Back` with VoiceOver label `Back`.

For real names instead of a generic label ("< Grocery Lists"), set `title:` beside each
function `headerTitle` and on each header-hidden parent, and remove the shared
`headerBackTitle` from `useScreenOptions` in the same change: react-native-screens
prefers a non-blank `headerBackTitle` over the previous screen's title, so while it is
set the `title:` edits leave every back button and history-menu entry at "Back".
Once it is gone, `title` feeds both `navitem.title` and `backButtonTitle` and fixes
all three surfaces, but it is one edit per screen and a new screen without it leaks
again. UIKit may still shorten a long back title to "Back", or hide it, when the bar
is short of space (except on `usePreventRemove` screens, whose custom back item
overrides that), so a full name is not guaranteed on narrow devices. Decision (user
ruling 2026-10-02): keep the shared "Back"; this per-screen upgrade is optional.

## Prevention

- When a stack's screens use a function `headerTitle`, decide the back label on
  purpose: a shared `headerBackTitle`, or a per-screen `title`.
- Check the back button's accessibility label, not only a screenshot. The visible
  label and the VoiceOver label are separate surfaces, and `minimal` splits them.
- A vitest assertion can only pin the option value; the native label needs the
  simulator (`maestro hierarchy` shows `accessibilityText`).
- Do not reach for `headerBackButtonDisplayMode: "minimal"` as the fix. Beyond
  leaving the VoiceOver label raw (measured), the source suggests a second
  problem that was NOT verified on a device: on a screen with an active
  `usePreventRemove`, native-stack forces `headerBackButtonMenuEnabled: false`,
  which makes `minimal` take react-native-screens' `backTitleVisible: false` path,
  and that path ignores `disableBackButtonMenu`, so the long-press history menu
  would come back on the screens that deliberately disable it.

## Related Files

- `client/hooks/useScreenOptions.ts`
- `client/hooks/__tests__/useScreenOptions.test.ts`
- `client/navigation/MealPlanStackNavigator.tsx`
- `todos/archive/P3-2026-10-01-back-button-shows-raw-route-names.md`

## See Also

- [native-stack-back-dispatches-pop-not-goback-2026-07-07.md](native-stack-back-dispatches-pop-not-goback-2026-07-07.md) — the same back button's other trap: it dispatches POP, not GO_BACK
- [headerbackvisible-boolean-toggle-needs-three-state-value-2026-09-16.md](headerbackvisible-boolean-toggle-needs-three-state-value-2026-09-16.md) — how `headerBackVisible` and a custom `headerLeft` interact in the same header config
- `node_modules/@react-navigation/native-stack/src/views/useHeaderConfigProps.tsx` and `node_modules/react-native-screens/ios/RNSScreenStackHeaderConfig.mm` (`configureBackItem`) — the two places the behaviour comes from
