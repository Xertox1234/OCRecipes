---
title: Restore state affordance when an AA fix collapses a luminance cue
track: knowledge
category: conventions
module: client
tags: [accessibility, dark-mode, affordance, disabled-state, ui, wcag]
created: '2026-06-22'
---

# Restore state affordance when an AA fix collapses a luminance cue

## Rule

When an accessibility fix changes a color and thereby FLATTENS the visual axis that
distinguished two states (enabled/disabled, selected/unselected, active/inactive),
restore the distinction on an ORTHOGONAL axis the constraint doesn't touch — hue
and/or icon/foreground contrast — rather than re-dimming the same color.

## Smell patterns

- An enabled/disabled (or selected/unselected) pair distinguished ONLY by background
  lightness, where an a11y change just darkened the "on" state.
- A disabled fill defined as `withOpacity(activeColor, x)` of the active fill, after the
  active fill was darkened for AA — both now read as the same dark color.

## Why

Making the active send-button fill AA-compliant required darkening it
(`link #E07050` → `accentSolid #B5451C`). The disabled state was a dim tint of the
SAME color (`withOpacity(link, 0.3)`), and the send icon was ALWAYS white — so
background lightness was the only enabled/disabled cue, and once the active fill went
dark, active vs disabled separated by only ~2:1. Re-dimming the disabled state further
doesn't help (both stay dark on one axis).

The fix gives the disabled state a NEUTRAL background (`withOpacity(theme.text, 0.12)`)
plus a MUTED icon (`theme.textSecondary`). State now reads on two axes AA did not
constrain: hue (saturated terracotta active vs desaturated neutral disabled) and icon
contrast (white active vs muted disabled). Disabled controls are WCAG 1.4.3-exempt, so
the muted-on-neutral contrast (still 3.4–5.5:1, legible) is fine. The non-visual cue —
`accessibilityState={{ disabled }}` + the native `disabled` prop — must remain so the
affordance is never color-only.

## Examples

```tsx
// before: only background lightness distinguished the states (collapsed after AA)
backgroundColor: canSend ? theme.accentSolid : withOpacity(theme.link, 0.3),
<Feather name="send" color={theme.buttonText} />            // always white

// after: hue + icon contrast carry the state
backgroundColor: canSend ? theme.accentSolid : withOpacity(theme.text, 0.12),
<Feather name="send" color={canSend ? theme.buttonText : theme.textSecondary} />
```

## Exceptions

- If state is already conveyed by a second non-color cue (a visible label that greys
  out, a border, an icon swap), a background-only luminance change may be acceptable —
  but verify the distinction is still perceptible in both light and dark.

## Related Files

- `client/screens/ChatScreen.tsx`, `client/screens/RecipeChatScreen.tsx`,
  `client/components/coach/CoachChatBase.tsx` — send-button enabled/disabled state

## See Also

- [dark-mode accent token split](dark-mode-accent-token-foreground-vs-fill-split-2026-06-22.md) — the AA fix that darkened the active fill and triggered the collapse
