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

| Trigger                                                 | Required feedback                                                                                                                 | House idiom                                                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Press in/out                                            | Visible response: scale 0.98 spring                                                                                               | `withSpring(pressSpringConfig)` gated `!reducedMotion` — `client/components/Button.tsx` (`handlePressIn`/`handlePressOut`). Prefer the shared `Button`; only hand-roll for non-button pressables                             |
| Input focus/blur                                        | 2px ring + warm fill on the visible field, following its corner radius (and floating label where the design uses in-field labels) | Shipped as `FocusField` + `useFieldFocus` (behind `FocusTextInput` / `FocusBottomSheetTextInput`) — see below for which to use and the boxed `TextInput`'s status; opt in with `label` where the design uses in-field labels |
| Selection (chips, pickers, toggles, segmented rows)     | `selection()` haptic + selected-state visual                                                                                      | `useHaptics().selection()`                                                                                                                                                                                                   |
| Submit start                                            | Button `loading` + `loadingText`, inputs `editable={false}`, concurrent-submit guard                                              | `Button` props; guard pattern in `client/components/ChangeEmailModal.tsx`                                                                                                                                                    |
| Success                                                 | A _moment_: success haptic + iOS announce + visible confirmation (toast or inline flash)                                          | `notification(Success)` + `AccessibilityInfo.announceForAccessibility` + `Toast` or a `FadeInDown` inline pill                                                                                                               |
| Error                                                   | Error haptic + `InlineError` (announces internally — never double-announce) + draft preserved; shake for validation rejects       | `notification(Error)`; shake pattern below                                                                                                                                                                                   |
| Celebratory confirm (favourite, goal hit, scan success) | Overshoot pop, not the clamped press spring                                                                                       | `successPopConfig` (bouncy) — press feedback uses `pressSpringConfig` (clamped). Two tiers; don't swap them                                                                                                                  |
| Expand/collapse                                         | Asymmetric timing (out-cubic in, in-cubic out)                                                                                    | `expandTimingConfig` / `collapseTimingConfig`                                                                                                                                                                                |

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

**The look:** on focus a 2px ring (`theme.focusRing`, `FOCUS_RING_WIDTH`) and a warm
fill (`theme.focusFill`, a low-opacity link tint over the field's own resting fill) fade
in over `focusTimingConfig` (reduced motion snaps, never drops). Both follow the
**visible field's** corner radius. The resting look (fill, edge, radius) stays the
caller's. An error keeps precedence: the ring shows in `theme.error` at full strength.

**The primitive:** `client/components/FocusField.tsx` draws the fill under and the ring
over its children; `client/components/useFieldFocus.ts` holds the state
(`{ focused, progress, onFocus, onBlur }`). Pure logic: `field-focus-utils.ts`
(`splitFieldStyle`, `resolveFieldRadius`, `labelFieldText`, `LABELLED_INPUT_TEXT`) and
`text-input-utils.ts` (`LABELLED_INPUT_GEOMETRY`). Every text primitive draws through
`FocusField` — there is no second focus look. Focus feedback is
NOT automatic for a bare react-native input — ESLint (`no-restricted-imports`, guard
test `scripts/__tests__/no-bare-text-input.test.ts`) forbids importing `TextInput` from
`react-native` or `BottomSheetTextInput` from gorhom in `client/`. Pick by **what draws
the visible field**:

- **The input itself** (its style has the fill/edge/radius) → `FocusTextInput`, or
  `FocusBottomSheetTextInput` inside a gorhom sheet. They split the style: box keys go on
  a `FocusField`, text keys stay on the input.
- **A wrapper `View`** around the input plus icons/buttons (search bars, Quick Log row,
  composers whose pill holds the send button, wizard rows/cells, stepper chips) → make
  the wrapper a `FocusField` with the wrapper's style, call `useFieldFocus()` once, and
  render the input with `focusRing={false}` + the field's `onFocus`/`onBlur` (pass your
  own handlers through `useFieldFocus({ onFocus, onBlur })`). Never a ring inside a ring.
  Reference: `client/components/meal-plan/QuickAddSheet.tsx`,
  `client/components/home/RecipeSearchDrawer.tsx`. `FocusField` takes no animation
  props — keep an outer `Animated.View` for `entering`/`exiting` and an outer `View` for
  accessibility roles/actions.
- **A boxed form field** → `client/components/TextInput.tsx`. It draws its box as a
  `FocusField` (1px edge at rest, the ring over it on focus or error) and lines the
  label up past its left icon itself.

**Floating label (the split):** labelled = the field's plain name — the `label` prop on
`TextInput`, `FocusTextInput` and `FocusBottomSheetTextInput` (they do the rest), or on
`FocusField` for the wrapper pattern. Example text stays the `placeholder`, suppressed
while the label rests (the primitives do this; a wrapper calls
`resolvePlaceholder(label, placeholder, shouldFloatLabel(focused, value))`). Pass `value`
to the primitives, or `hasValue` to `FocusField`, so the label stays floated after blur.
A labelled field is at least 56px (`FocusField` adds the minHeight; a taller caller
`minHeight` wins). Labelled text sits under the label's row: the primitives apply
`labelFieldText`; a wrapper's inner input drops any fixed height and spreads
`LABELLED_INPUT_TEXT` (the `LABELLED_INPUT_GEOMETRY` padding: top 26, bottom 10, line
height 18) into its style. The label sits at the field's numeric `paddingLeft` (else
16); pass `labelLeft` when the text starts further in (an inner inset, a left icon).
**No label** on chat composers, tiny inline number boxes, and repeated rows/grid boxes
(wizard rows, nutrition cells) — ring + fill only; they keep their placeholder, unit or
caption. The label is hidden from screen readers — the input's `accessibilityLabel`
carries the name. The label scale uses `transformOrigin: "left"`. If you're writing
`onFocus` state or a border interpolation in a screen file, stop — use the primitive.

## Shipped shake pattern (extend, don't re-implement)

Validation reject only (not server errors), paired with the error haptic. `InlineError`
takes a `shakeKey` counter; bump it in the reject branch, next to the haptic:

```tsx
const [shakeKey, setShakeKey] = useState(0);
// in the validation-reject branch:
setError(message);
setShakeKey((k) => k + 1);
haptics.notification(Haptics.NotificationFeedbackType.Error);
// render:
<InlineError message={error} shakeKey={shakeKey} />;
```

A counter, not the message: `setError("")` + `setError(sameMessage)` batches to no change,
so a message-keyed shake would never repeat. Mounting and message-only changes never
shake; reduced motion skips it (the error still shows). The sequence lives in
`client/hooks/useShake.ts` — reuse it for anything else that shakes, and call `shake()`
from an effect, never the event handler (a shared-value write before the view's first
commit is lost).

## Common mistakes

| Mistake                                             | Fix                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Task didn't say "polished," so the form ships inert | The inventory is unconditional — walk it for every interactive element                                                    |
| Focus ring hand-rolled per screen with `useState`   | Delete the hand-rolled version — `FocusField` + `useFieldFocus` already animate focus; extend them if something's missing |
| `await`-less `onSave(...)` then immediate clear     | `await`, show `loading`, clear only on success, preserve draft on failure                                                 |
| Silent success (form just resets)                   | Success is a moment: haptic + announce + visible confirmation                                                             |
| `Haptics.impactAsync()` called directly             | `useHaptics()` — Android toggle + reduced-motion gating live there                                                        |
| One spring config for everything                    | Press = clamped `pressSpringConfig`; celebration = overshoot `successPopConfig`                                           |

## Verify

After implementing, re-read the inventory and name each element's feedback per trigger.
For visual confirmation on device-shaped work, use the `verify-ui` skill (iOS Simulator).
