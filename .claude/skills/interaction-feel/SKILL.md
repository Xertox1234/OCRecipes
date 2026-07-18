---
name: interaction-feel
description: Use when creating or modifying client/ UI that has interactive elements — inputs, buttons, chips, cards, sheets, list rows — even when the task doesn't mention polish. Also when UI works but feels flat, static, or dead (taps give no visible response, tapping an input shows only a cursor, saves complete silently), or when the user asks for premium, polished, delightful, or alive UI, microinteractions, haptics, focus states, or floating labels.
---

# interaction-feel — every interactive element answers back

Functionally correct UI that gives no feedback reads as broken-adjacent: the user tapped,
and nothing acknowledged it. In this codebase the infrastructure for feedback already
exists (motion tokens, haptics hook, reduced-motion gating) — flat UI happens when new
components simply don't wire into it. This skill makes that wiring a required step, not
an optional flourish reserved for tasks that say "polished."

**Core rule: interaction feedback is part of the component's contract, not decoration.**
A form task that never mentions feel still gets the full inventory below.

## The Interaction Inventory (required)

For every interactive element you build or touch, walk this table and implement each
applicable row. A row you skip must be a deliberate N/A (e.g. no async work → no
loading row), not an omission.

| Trigger                                                 | Required feedback                                                                                                           | House idiom                                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Press in/out                                            | Visible response: scale 0.98 spring                                                                                         | `withSpring(pressSpringConfig)` gated `!reducedMotion` — `client/components/Button.tsx` (`handlePressIn`/`handlePressOut`). Prefer the shared `Button`; only hand-roll for non-button pressables |
| Input focus/blur                                        | Animated border-color transition (and floating label where the design uses in-field labels)                                 | Shipped in the shared `client/components/TextInput.tsx` — see below; opt in with the `label` prop where the design uses in-field labels                                                          |
| Selection (chips, pickers, toggles, segmented rows)     | `selection()` haptic + selected-state visual                                                                                | `useHaptics().selection()`                                                                                                                                                                       |
| Submit start                                            | Button `loading` + `loadingText`, inputs `editable={false}`, concurrent-submit guard                                        | `Button` props; guard pattern in `client/components/ChangeEmailModal.tsx`                                                                                                                        |
| Success                                                 | A _moment_: success haptic + iOS announce + visible confirmation (toast or inline flash)                                    | `notification(Success)` + `AccessibilityInfo.announceForAccessibility` + `Toast` or a `FadeInDown` inline pill                                                                                   |
| Error                                                   | Error haptic + `InlineError` (announces internally — never double-announce) + draft preserved; shake for validation rejects | `notification(Error)`; shake pattern below                                                                                                                                                       |
| Celebratory confirm (favourite, goal hit, scan success) | Overshoot pop, not the clamped press spring                                                                                 | `successPopConfig` (bouncy) — press feedback uses `pressSpringConfig` (clamped). Two tiers; don't swap them                                                                                      |
| Expand/collapse                                         | Asymmetric timing (out-cubic in, in-cubic out)                                                                              | `expandTimingConfig` / `collapseTimingConfig`                                                                                                                                                    |

## House rules

- **Haptics only via `useHaptics()`** (`client/hooks/useHaptics.ts`). Import `expo-haptics`
  for enum constants only. Direct `Haptics.impactAsync` calls bypass the Android
  system-vibration toggle and the reduced-motion gate.
- **Motion configs come from `client/constants/animations.ts`.** Reuse an existing config
  first; a genuinely new one gets a named, doc-commented export there — never inline
  `{ damping: …, stiffness: … }` literals in components.
- **Every animation and haptic is reduced-motion gated** via `useAccessibility()`
  (`useHaptics` gates itself). Reduced motion ≠ no state change: snap to the end value
  (`duration: 0` or conditional `entering`), don't drop the feedback entirely.
- **Shared component first.** If you're writing `onFocus={() => setFocused(...)}` in a
  screen file, stop — that behavior already ships in `client/components/TextInput.tsx`;
  extend the shared primitive (there or the relevant sibling) if it lacks something, so
  every screen inherits it.
- React Compiler is ACTIVE — no manual `useCallback`/`memo` for animation identity.
- Worklet gotcha: an imported function called inside a worklet needs its own
  `"worklet"` directive — see `docs/rules/react-native.md` (silent release-build crash).
- A11y announce rules (iOS imperative vs Android live region) are in
  `docs/rules/accessibility.md` — follow them, don't re-derive.

## Shipped focus patterns (extend, don't re-implement)

The animated focus border and floating label live in the shared
`client/components/TextInput.tsx` (pure logic: `client/components/text-input-utils.ts`;
timing token: `focusTimingConfig` in `client/constants/animations.ts`). Every screen gets
the focus border automatically. Opt into the floating label with the `label` prop — it
doubles as the input's accessible name unless `accessibilityLabel` is set, and suppresses
the `placeholder` while resting. The label scale uses the `transformOrigin: "left"` style
prop (supported on RN 0.81/Fabric). If you're writing `onFocus` state or a border
interpolation in a screen file, stop — extend the shared component instead.

## Missing pattern (not yet implemented): error shake

Validation reject only (not server errors), paired with the error haptic:

```tsx
shakeX.value = withSequence(
  withTiming(-6, { duration: 50 }),
  withTiming(6, { duration: 50 }),
  withTiming(-3, { duration: 50 }),
  withTiming(0, { duration: 50 }),
); // skip entirely under reducedMotion — InlineError still shows
```

(One-shot sequence steps like these may inline their durations — the named-token rule
targets reusable configs.)

## Common mistakes

| Mistake                                             | Fix                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Task didn't say "polished," so the form ships inert | The inventory is unconditional — walk it for every interactive element                                           |
| Focus ring hand-rolled per screen with `useState`   | Delete the hand-rolled version — the shared `TextInput` already animates focus; extend it if something's missing |
| `await`-less `onSave(...)` then immediate clear     | `await`, show `loading`, clear only on success, preserve draft on failure                                        |
| Silent success (form just resets)                   | Success is a moment: haptic + announce + visible confirmation                                                    |
| `Haptics.impactAsync()` called directly             | `useHaptics()` — Android toggle + reduced-motion gating live there                                               |
| One spring config for everything                    | Press = clamped `pressSpringConfig`; celebration = overshoot `successPopConfig`                                  |

## Verify

After implementing, re-read the inventory and name each element's feedback per trigger.
For visual confirmation on device-shaped work, use the `verify-ui` skill (iOS Simulator).
