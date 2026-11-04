---
title: "Fixed content above a KeyboardAvoidingView can leave the chat input no room — the input sits under the keyboard"
track: bug
category: logic-errors
module: client
tags: [react-native, design-system, accessibility, keyboard, android, small-screen]
symptoms: ['Chat input hidden under the keyboard on a small Android phone or small iPhone, while the same screen works on a large iPhone', 'Only a sliver of the input bar shows above the keyboard; Send is covered', 'An empty band of exactly keyboardVerticalOffset height between the input and the keyboard']
applies_to: ['client/screens/**/*.tsx', 'client/components/**/*.tsx']
created: '2026-11-02'
severity: high
---

# Fixed content above a KeyboardAvoidingView can leave the chat input no room — the input sits under the keyboard

## Problem

On the Coach Pro tab, the chat (`CoachChat` → `CoachChatBase`'s `KeyboardAvoidingView`) sits below a fixed
dashboard card. On a Galaxy A37 (Android 16, 832 dp window) opening the keyboard left the input bar under
the keyboard: you could not see what you typed or reach Send. iPhone-sized simulators looked fine.

## Symptoms

- Keyboard open: the input bar is reduced to a 20 dp sliver at the keyboard's top edge.
- Fixed by folding the content above; then a ~90-unit empty gap above the keyboard on BOTH platforms.

## Root Cause

Measured on the device with temporary `onLayout`/`measureInWindow` + `keyboardDidShow` logging:

| | top | bottom |
|---|---|---|
| KAV (below the open dashboard) | 453 | 832 |
| keyboard | 473.6 | 817 |
| input bar, keyboard open | 453 | 592.7 (139.7 tall) |

1. **No room to give.** `behavior="height"` (Android) shrinks the KAV by the keyboard overlap, but the KAV's
   top is fixed by the content above it. With 453 dp of dashboard and a keyboard starting at 474, the KAV can
   shrink to only ~20 dp — it stops at its content height (the input bar) and the keyboard covers that.
   Nothing in the KAV is wrong; the screen simply has more fixed content than space. The arithmetic fails the
   same way on a small iPhone (SE: 667 pt, ~260 pt keyboard).
2. **Padding for a bar the keyboard hides.** The input bar carried `paddingBottom: tabBarHeight` (80+ dp)
   permanently — even while the keyboard covers the tab bar.
3. **A fudge offset.** `keyboardVerticalOffset={90}`. RN computes the overlap as
   `frame.y + frame.height - (keyboard.screenY - offset)`, where `frame` is relative to the KAV's PARENT. The
   offset must equal the distance from the window top to that parent — a navigation header's height, or 0.
   Coach has no header (`frame.y` 453 = window y 453), so 90 only added a gap above the keyboard.

## Solution

`fix(coach)` PR #1694 (owner ruling: fold the dashboard while typing, both platforms):

- `CoachDashboard` takes `forceCollapsed`; the visible state is `userExpanded && !forceCollapsed`, so the
  user's own fold choice returns when the keyboard closes. While forced, the Expand toggle calls
  `Keyboard.dismiss()` instead of being a dead control.
- `CoachProScreen` drives it from `useKeyboardVisible()` and swaps the input's `paddingBottom` from
  `tabBarHeight` to `Spacing.sm` while the keyboard is up.
- `CoachChat` drops `keyboardVerticalOffset={90}` (`CoachChatBase` defaults it to 0).

## Prevention

- For a keyboard-avoiding chat below fixed content, check the arithmetic on the smallest supported screen:
  fixed-content height + keyboard height + input-bar height ≤ window height. If not, the fixed content must
  yield while typing (fold, or move inside the scrolling area).
- `keyboardVerticalOffset` is the height ABOVE the KAV's parent: `headerHeight` from
  `@react-navigation/elements` on a screen with a header, 0 without one. Never a tuned constant.
- Padding that clears a tab bar is wrong while the keyboard covers the tab bar.
- Verify on a short Android device or a small-iPhone simulator, not only on a large iPhone.

## Related Files

- `client/screens/CoachProScreen.tsx` — `useKeyboardVisible`, `forceCollapsed`, input padding swap
- `client/components/coach/CoachDashboard.tsx` — `forceCollapsed`, Expand dismisses the keyboard
- `client/components/coach/CoachChatBase.tsx` — the `KeyboardAvoidingView`
- `client/hooks/useKeyboardVisible.ts` — `will*` events on iOS, `did*` on Android

## See Also

- [validation-error-row-pushes-submit-under-the-ios-keyboard](validation-error-row-pushes-submit-under-the-ios-keyboard-2026-09-05.md) — another way a control ends up under the keyboard
- [scroll-inset-that-follows-the-ios-keyboard-snaps-the-page-back-on-hide](scroll-inset-that-follows-the-ios-keyboard-snaps-the-page-back-on-hide-2026-10-01.md) — keyboard-following layout on iOS
- [synthesize-ios-keyboard-events-over-cdp-when-the-sim-has-a-hardware-keyboard](../best-practices/synthesize-ios-keyboard-events-over-cdp-when-the-sim-has-a-hardware-keyboard-2026-10-01.md) — the simulator hides the software keyboard by default (⌘K shows it)
