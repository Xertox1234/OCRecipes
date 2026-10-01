---
title: "Composing onto a shared height-clamp shell silently clips unbounded child content"
track: bug
category: logic-errors
tags: [react-native, ui, refactoring, drawer, accessibility]
module: client
applies_to: [client/components/home/**/*.tsx]
symptoms: [Trailing list rows and a submit button become untappable with no scroll affordance, A refactor that composes a shared UI shell silently changes clipping behavior versus the pre-refactor component, Content beyond a computed maxHeight is invisible with no error or warning to the user]
created: '2026-09-25'
severity: high
---

# Composing onto a shared height-clamp shell silently clips unbounded child content

## Problem

Composing a child component onto a shared "collapsible drawer" shell that enforces a `maxHeight` clip can silently truncate the child's content once the child's list is not structurally bounded — with no scroll affordance to reach the hidden rows or a trailing action button.

## Symptoms

- A drawer/accordion body renders correctly for a small amount of content but hides trailing rows (and any button below them) once content grows past a certain size, with no error, warning, or scroll indicator.
- The hidden content is reachable in code (state still holds it, `removeItem`/edit affordances still work in theory) but unreachable in the UI.
- The bug only appears on small-screen devices or with above-average content length, so it is easy to miss in normal manual testing.

## Root Cause

`HomeInlineDrawer`'s body is an absolutely-positioned `View` inside an `overflow: "hidden"` `Animated.View` clip container; `useCollapsibleHeight` measures the body's natural content height on `onLayout` and clamps it via `clampDrawerHeight(measured, maxHeight)` (`client/components/home/inline-drawer-utils.ts`) before animating to it. When `maxHeight` is supplied, content past that ceiling is not scrolled into view — it is permanently clipped, because the body has no internal `ScrollView`.

`RecipeSearchDrawer` and `GenerateRecipeDrawer` (the shell's original two consumers) never hit this because their content is structurally bounded — a `.slice(0, 8)` recent-search list, a horizontal `ScrollView` for the trending-chip carousel, and a fixed idea-chip list — so the clamp is a no-op for them in practice.

A third consumer, `QuickLogDrawer`, was refactored to compose the same shell (`todos/archive/P2-2026-09-23-quicklogdrawer-compose-homeinlinedrawer.md`) but renders `session.parsedItems`, a list whose length is **not** bounded until submit time: `MAX_LOG_ITEMS` in `client/hooks/useQuickLogSession.ts` only slices the array when logging (`.slice(0, MAX_LOG_ITEMS)` inside `logAllMutation`), never when displaying it. A single natural-language or dictated food description can plausibly parse into a dozen or more discrete items — the food-parsing prompt explicitly instructs the model to split compound foods into separate items — comfortably crossing the clamp's ceiling (`HomeScreen`'s `DRAWER_MAX_HEIGHT = screenHeight * 0.75`, ≈500px on an iPhone SE) once roughly 13-14 items are parsed. Two independent code reviews computed the same crossover arithmetic (row height × N + fixed padding vs. the clamp) and reached the same conclusion.

## Solution

Before wiring a `maxHeight` prop into a new consumer of `HomeInlineDrawer` (or any shared height-clamped shell), verify the consumer's rendered content is actually structurally bounded — a fixed-size list, a `.slice()`'d preview, or content with its own internal scroll. If it is not:

- Prefer making the shell's `maxHeight` prop **optional** and simply omit it for that consumer. `clampDrawerHeight`'s `maxHeight != null` guard already treats an omitted/`undefined` maxHeight as a pure no-op ceiling, so this exactly restores whatever unclamped behavior the consumer had before composition, with no new mechanism and no risk of a mismatched internal-scroll implementation.
- Only reach for an internal `ScrollView` around the unbounded section if the consumer genuinely needs the clamp to engage for OTHER (bounded) parts of its body — that adds real layout complexity (a nested scroll region inside an animated, auto-measuring, absolutely-positioned parent) that a "just don't clamp this one" fix avoids entirely.
- Do **not** cap the *displayed* list to match a submit-time cap as a shortcut — that silently makes trailing items invisible and unremovable even though the underlying state still holds them, which is a product-behavior change a maintainability refactor has no mandate to make.

## Prevention

- When composing a component onto ANY shared height-clamping shell, explicitly answer "is this content's length bounded?" before wiring the clamp prop through — don't assume parity with the shell's other consumers just because they share the same component.
- A height-clamp mechanism paired with `overflow: hidden` and no internal `ScrollView` is a silent-truncation trap for any future unbounded consumer. If you own such a shell, keep its `maxHeight` prop optional so a consumer can deliberately opt out rather than being forced to guess a "safe" ceiling.
- When a reviewer's finding depends on a threshold (a buffer size, a truncation cap, a retry count, a computed content height), compute the actual crossover point using the real style constants rather than eyeballing "should be fine for realistic content" — that is exactly the false claim this bug's own earlier commit message made before two independent reviews recomputed it and found the crossover at N≈13-14 items on the smallest supported device.

## Related Files

- `client/components/home/HomeInlineDrawer.tsx` — the shared shell; `maxHeight` is optional so a consumer can opt out of the clamp
- `client/components/home/QuickLogDrawer.tsx` — the consumer that hit this; composes the shell without passing `maxHeight`
- `client/components/home/inline-drawer-utils.ts` — `clampDrawerHeight`, the pure-ceiling clamp function
- `client/hooks/useCollapsibleHeight.ts` — the hook that measures and clamps the body's content height
- `client/hooks/useQuickLogSession.ts` — `MAX_LOG_ITEMS`, the submit-time (not display-time) cap that made the list's true length invisible from the shell's perspective

## See Also

- None yet.
