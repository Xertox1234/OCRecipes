---
title: "Maestro on Android: list content below the fold is absent from the hierarchy — reach it with scrollUntilVisible, and keep the list under the screen's centre"
track: knowledge
category: conventions
module: client
tags: [testing, maestro, e2e, android, accessibility]
symptoms: ['A Maestro wait or tapOn passes on the iOS simulator and times out on Android with the element plainly reachable by scrolling', 'scrollUntilVisible times out although the target is a few rows down', 'Hierarchy dump on Android has no node for a button that renders below a list']
applies_to: ['e2e/**']
created: '2026-11-02'
---

# Maestro on Android: list content below the fold is absent from the hierarchy — reach it with scrollUntilVisible, and keep the list under the screen's centre

## Rule

1. Any Maestro wait or tap on content that can render below the fold of a list (buttons under a results
   list, the last card of a chat) uses `scrollUntilVisible`, never a plain `extendedWaitUntil` /
   `assertVisible` / `tapOn`.
2. Before a `scroll` / `scrollUntilVisible`, make sure the scrollable list covers the vertical centre of the
   screen — fold or dismiss fixed content above it first.

## Why

- **Android omits off-screen content.** iOS reports every mounted view in the accessibility hierarchy,
  scrolled away or not; Android reports attached, on-screen views — and `FLATLIST_DEFAULTS` turns on
  `removeClippedSubviews`, which detaches off-screen cells entirely. Measured on a Galaxy A37 (2026-11-02):
  "Search with these", "Get ideas for you" and "Generate" had **0** hierarchy matches before one swipe and
  **2** after. A plain wait can never see them on Android, however long it waits. `scrollUntilVisible`
  waits AND scrolls; on iOS it matches immediately without scrolling.
- **Maestro scrolls through the screen's middle.** With Coach's dashboard open, the middle of the screen is
  the dashboard, not the chat list, so `scrollUntilVisible` swiped a non-scrolling area and timed out with
  the list unmoved. Folding the dashboard ("Collapse dashboard") put the list under the centre and the same
  step passed.

## Examples

```yaml
# Fold fixed content so the list owns the screen's centre (a user choice — it stays folded).
- runFlow:
    when:
      visible: "Collapse dashboard"
    commands:
      - tapOn: "Collapse dashboard"
# Buttons under a results list.
- scrollUntilVisible:
    element:
      text: "Get ideas for you"
      enabled: true # older lists keep their buttons disabled
    direction: DOWN
    timeout: 20000
- tapOn:
    text: "Get ideas for you"
    enabled: true
```

Diagnose before editing: `maestro --device <id> hierarchy | grep -c "<label>"`, then one
`adb shell input swipe` inside the list, then count again. 0 → >0 is this convention; 0 → 0 means the swipe
missed the list (rule 2) or the label is wrong.

## Exceptions

- Content guaranteed to be on screen (a header, a fixed composer) needs no scroll.
- A screen without a scrollable container: fix the selector, not the scroll.

## Related Files

- `e2e/manual/recipe-finder.yaml` — every rule above in use (passed 53/0 on the A37)
- `client/constants/performance.ts` — `FLATLIST_DEFAULTS` (`removeClippedSubviews`)

## See Also

- [remove-clipped-subviews-hides-offscreen-cards-from-screen-readers](../logic-errors/remove-clipped-subviews-hides-offscreen-cards-from-screen-readers-2026-10-23.md) — the same Android mechanism, as seen by TalkBack
- [maestro-text-matching-is-full-string-regex](../logic-errors/maestro-text-matching-is-full-string-regex-2026-08-30.md) — selector syntax
- [removing-ui-text-sweep-maestro-assertvisible](removing-ui-text-sweep-maestro-assertvisible-2026-07-10.md) — keeping flows in step with UI text
