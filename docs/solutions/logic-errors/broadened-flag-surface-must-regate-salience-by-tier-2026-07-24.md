---
title: "When a safety-only display surface broadens to mixed-tier content, re-gate every salience signal by tier — and rename the field"
track: knowledge
category: logic-errors
tags: [client, accessibility, scan-flags, live-region, severity, tier, naming]
module: client
applies_to: [client/screens/ScanScreen.tsx, client/screens/ScanScreenConfirmOverlay-utils.ts, client/camera/components/ProductChip.tsx]
created: '2026-07-24'
---

# When a safety-only display surface broadens to mixed-tier content, re-gate every salience signal by tier — and rename the field

## Rule

A badge/announcement surface originally built for one content class (here:
safety-tier allergen flags) usually hardcodes that class's salience —
`accessibilityLiveRegion="assertive"`, danger-shaped iconography, a Warning
haptic, an error palette keyed on `severity` alone. When a refactor broadens
what flows into it (the `pickTopDisplayFlag` parity change let warn-level
**nutrition** flags reach the confirm card), every one of those signals must be
**re-gated by tier**, and the field holding the value must be **renamed** to
its broadened meaning. A comment saying "despite the name…" is documentation
of a bug, not a fix.

## The incident

PR #710 fixed a real parity gap (confirm card vs scan-lock chip composed their
top flag differently) by routing the shared `pickTopDisplayFlag` result into
the confirm card's `safetyFlag` field. Post-change, an ordinary "High in
sugar" heads-up rendered with an interrupting assertive TalkBack announcement
and an alert-triangle glyph — error-grade salience for informational content,
contradicting the assertive-polarity rule (assertive = errors/safety; polite =
informational) the same PR added to the mobile-reviewer checklist. And because
the danger checks tested `severity === "danger"` with no `tier === "safety"`
guard, a future danger-severity nutrition flag would have fired the allergen
Warning haptic + error palette inside a safety-critical allergen feature.

## How to apply

1. **Inventory the salience signals** on the surface: live-region politeness,
   icon shape, palette, haptics, imperative announcements. Each one keyed on
   `severity` alone must gain a tier dimension when content broadens.
2. **Centralize as a pure presentation helper** (`getConfirmFlagPresentation`)
   returning `{ liveRegion, icon, colorKey }`, unit-tested per (tier ×
   severity) cell — including the impossible-today cells (danger-severity
   nutrition) so the producer invariant is enforced consumer-side too.
3. **Rename the field** (`safetyFlag` → `topDisplayFlag`) so every downstream
   `.severity === "danger"` check fails to typecheck-by-intuition and gets
   revisited. The sibling surface (ProductChip) modeled this correctly from
   the start by keeping `safetyFlag` and `topFlag` as separate values.
4. Safety-tier presentation must stay byte-identical through the change —
   assertive + triangle is CORRECT for allergen content; the fix is gating,
   not blanket softening. (An earlier attempt to downgrade the chip's
   assertive announce for mild *safety* flags was reverted for exactly this
   reason — it would have weakened the sole Android signal for mild
   allergens.)

Sibling lesson: `docs/solutions/logic-errors/duplicated-flag-composition-desyncs-display-surfaces-2026-07-24.md`
(the same PR's finding that duplicated inline composition desyncs surfaces —
composition and salience are the two halves of a shared-flag display).
