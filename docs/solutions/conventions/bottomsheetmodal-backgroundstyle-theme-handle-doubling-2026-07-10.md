---
title: BottomSheetModal defaults to a white background and its own handle — every sheet host must set backgroundStyle and dedupe the handle
track: knowledge
category: conventions
module: client
tags: [bottom-sheet, gorhom, theming, dark-mode, backgroundstyle, handle, react-native]
symptoms: ['Bottom sheet renders white in dark mode while the rest of the screen is themed', 'Two stacked drag-indicator bars at the top of a bottom sheet']
applies_to: ['client/**/*.tsx']
created: '2026-07-10'
---

# BottomSheetModal defaults to a white background and its own handle — every sheet host must set backgroundStyle and dedupe the handle

## Rule

Every `BottomSheetModal` host must:

1. Set `backgroundStyle={{ backgroundColor: colors.background }}` (themed) — the library paints its own background, defaulting to white regardless of color scheme; the sheet does NOT inherit the app theme.
2. Render exactly one drag handle. The library draws a default indicator; if the sheet content draws its own bar, hide the library's with `handleComponent={null}` or `handleIndicatorStyle={{ display: 'none' }}`.

## Why

`@gorhom/bottom-sheet` composes its own background and handle layers above your content. A dark-mode user sees a glaring white sheet unless `backgroundStyle` is set per host, and a content-drawn bar plus the default indicator reads as a visual glitch (doubled bars). Hiding the library handle does not affect swipe-to-close gestures — the gesture surface is the sheet, not the indicator.

## Exceptions

Sheets that intentionally use the library's default light styling in both themes (none currently in this app).

## Related Files

- `client/components/` — BottomSheetModal hosts (grep `BottomSheetModal` for the current list)

## See Also

- [BottomSheetModal in child component silently fails to present](../runtime-errors/bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md) — presentation-side gotcha for the same library
- [gorhom onChange fires on animation complete, not start](../logic-errors/gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md)
