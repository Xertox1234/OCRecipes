---
title: "An Android background focus-trap applied only to the ScrollView misses a sibling that has its own, independent visibility condition"
track: bug
category: logic-errors
module: client
tags: [accessibility, talkback, android, importantForAccessibility, bottom-sheet, focus-trap, sibling]
symptoms: ["A screen's Android TalkBack background trap (importantForAccessibility=\"no-hide-descendants\" while a sheet/overlay is open) is applied to the screen's main ScrollView, but a Pressable OUTSIDE that ScrollView stays reachable by TalkBack while the sheet is open", "The reachable element is gated by its OWN unrelated visibility condition (e.g. a scroll-collapse threshold) that has nothing to do with the sheet", "The gap only manifests under a realistic interaction sequence — e.g. the action that opens the sheet is far down the page, so the very act of scrolling to reach it puts the screen into the state that exposes the untrapped sibling"]
severity: medium
created: '2026-09-23'
---

# An Android background focus-trap applied only to the ScrollView misses a sibling that has its own, independent visibility condition

## Problem

When adding an Android TalkBack background focus-trap (`importantForAccessibility="no-hide-descendants"` while a sheet/overlay is open, released to `"auto"` when it closes), it's natural to apply the prop to "the screen's background content" — meaning the primary `ScrollView`. That is correct for every element that is a **descendant** of the ScrollView (they inherit the ancestor's exclusion regardless of their own toggles), but it does nothing for a **sibling** of the ScrollView that renders outside it.

## Symptoms

- The trap works for the obvious case (scroll through the screen, sheet open, main content hidden from TalkBack) but a specific element — often a collapsed/persistent header bar, a floating action button, or any element conditionally rendered as a JSX sibling rather than inside the scroll container — stays reachable.
- The untrapped element already has ITS OWN accessibility-hiding logic (e.g. `importantForAccessibility={isBarVisible ? "auto" : "no-hide-descendants"}`), driven by a condition completely unrelated to the sheet (scroll position, a feature flag, etc.). It is easy to read that existing logic as "this element already handles its own accessibility" and stop looking.
- The realistic trigger sequence often requires scrolling: if the action that opens the sheet lives far down the page, reaching it puts the screen into exactly the state (e.g. header collapsed to its persistent bar form) that exposes the untrapped sibling — so a shallow manual/mental walkthrough ("open the sheet from the top of the screen") misses it entirely.

## Root Cause

`importantForAccessibility="no-hide-descendants"` excludes the subtree of the element it's set on — nothing else. A screen's return tree is rarely a single element; a `<>` fragment or an outer `<View>` commonly contains the primary `ScrollView` AND one or more siblings (a collapsed header bar, a FAB, a toast) that render outside the scroll container for layout reasons. Gating only the ScrollView's own prop, without auditing every other top-level sibling of the sheet's host for its own independent accessibility state, leaves those siblings' reachability entirely up to whatever condition already drove their own prop — which was never designed with "a sheet might currently be open" in mind.

Found in `client/screens/HomeScreen.tsx` during
`todos/archive/P2-2026-09-20-android-talkback-background-trap-missing-on-bottomsheetmodal-sites.md`:
the screen's `return` is a `<>` fragment containing, as siblings, a collapsed summary bar
(`Animated.View`, visible once the user scrolls past the header-collapse threshold) and the main
`Animated.ScrollView`. The new `isImportSheetOpen`-driven trap was applied only to the ScrollView.
The collapsed bar's own `importantForAccessibility={isBarVisible ? "auto" : "no-hide-descendants"}`
was untouched — so with the bar visible (the likely state, since the sheet-opening action sits in a
`CollapsibleSection` far down the page) and the sheet open, the bar's "Tap for details" `Pressable`
stayed in the Android accessibility tree, reachable behind the open sheet. Caught independently by
both reviewers in the same review round (one CRITICAL, one WARNING) — not by the author during
implementation, nor by the jsdom test suite, since the pre-existing tests for the ScrollView's own
prop never exercised `isBarVisible=true`.

## Solution

Before applying a background trap to "the ScrollView," enumerate every top-level element the sheet's host screen's `return` renders — every sibling of the ScrollView (and of the sheet itself, since the `BottomSheetModal` is usually portal-rendered and not a true tree sibling despite the JSX placement — see `a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md`). For each sibling that carries its own interactive content (a `Pressable`, a button, anything with an `accessibilityRole`), compose the sheet-open condition into that sibling's own accessibility props rather than assuming the ScrollView's trap covers it:

```tsx
// ✗ misses the collapsed bar — it's a sibling, not a ScrollView descendant
<Animated.View importantForAccessibility={isBarVisible ? "auto" : "no-hide-descendants"}>
  <Pressable onPress={handleCalorieTap} accessibilityRole="button" ... />
</Animated.View>
<Animated.ScrollView
  importantForAccessibility={isSheetOpen ? "no-hide-descendants" : "auto"}
>
  ...
</Animated.ScrollView>

// ✓ the sibling's own condition is ANDed with the new one — hidden if EITHER
// reason applies, visible only when NEITHER does
<Animated.View
  importantForAccessibility={
    isBarVisible && !isSheetOpen ? "auto" : "no-hide-descendants"
  }
>
  <Pressable onPress={handleCalorieTap} accessibilityRole="button" ... />
</Animated.View>
<Animated.ScrollView
  importantForAccessibility={isSheetOpen ? "no-hide-descendants" : "auto"}
>
  ...
</Animated.ScrollView>
```

Compose with `&&`/`||`, don't replace: the sibling's existing condition still needs to govern its own baseline visibility state — the sheet-open flag only ever ADDS a reason to hide, never removes an existing one.

## Prevention

- When a todo/PR's acceptance criteria describe a background trap as covering "the screen" or "content behind the sheet," read that as **every top-level sibling in the return tree**, not just the element that happens to hold most of the content. Grep the `return (` block's direct children before writing the fix.
- Write a regression test for each such sibling in the SAME state matrix as the primary element (before-open / during-open / after-release), with the sibling's own independent condition set to its "would otherwise be reachable" value — a test that only ever renders the sibling in its default-hidden state (e.g. `isBarVisible: false` throughout) cannot catch this, since the sibling would already read as "correctly hidden" for the wrong reason.
- During review, a reviewer that traces the diffed screen's actual JSX tree (not just the lines the diff touched) rather than trusting the PR's own framing of "the background is now trapped" is what caught this — do the same when reviewing a background-trap change: read the whole `return` block, not only the touched lines.

## Related Files

- `client/screens/HomeScreen.tsx` — the collapsed summary bar (`~line 406`) and the trapped `Animated.ScrollView` (`~line 449`), the sibling pair this bug was found in
- `client/screens/__tests__/HomeScreen.test.tsx` — the `describe("HomeScreen — Android TalkBack background trap also covers the collapsed bar sibling")` block: isolates `isBarVisible` from `isImportSheetOpen` to pin all four truth-table cells
- `docs/solutions/conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md` — the general Android-trap mechanism this bug was found while applying
- `docs/solutions/conventions/a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md` — why the `BottomSheetModal` itself is not a true tree sibling despite the JSX placement

## See Also

- [accessibilityviewismodal-later-siblings-stay-accessible](accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md) — a related but distinct sibling-scoping trap: `accessibilityViewIsModal` only suppresses EARLIER siblings on iOS, so a partial flag is its own failure mode
