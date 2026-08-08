---
title: "A disclaimer living inside one claim surface disappears when that surface renders nothing"
track: bug
category: logic-errors
tags: [accessibility, react-native, compliance, disclaimer, conditional-rendering, health-claims]
module: client
applies_to: ["client/components/nutrition/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["A legal or safety qualifier is present in most states and absent in one nobody looked at", "Health claims render while the text that qualifies them does not", "Tests covering the empty state assert the section is gone and pass — because the qualifier went with it", "grep for the disclaimer string finds it inside exactly one component, but claims are made by several"]
severity: high
created: 2026-08-05
---

# A disclaimer living inside one claim surface disappears when that surface renders nothing

## Problem

`NutritionDetailScreen` makes health claims from three components: `FlagSections`
badges, `NutritionSummaryCard`'s Nutri-Score ring and standout copy, and
`NutritionPanel`'s FSA traffic lights. The `Informational only — not medical
advice.` disclaimer lived inside `FlagSections` — duplicated once per section.

Slice 2c re-gated the "Heads up" section from `partition.universal.length > 0`
to `universalToShow.length > 0`, where `universalToShow` is the output of
`dropPanelBandedFlags` — a filter whose entire job is to drop badges the panel
is already banding, and which is therefore *designed* to reach zero.

A product whose only universal flags are `nutrient:sugar` / `nutrient:sodium`
at a HIGH band now drops every badge. `FlagSections` renders `null`, and the
user gets a Nutri-Score ring, "High in sugar" standout copy and red traffic-light
pills with no disclaimer anywhere on the screen.

## Symptoms

- The qualifier is visible in every state a developer thinks to open, and gone
  in the one produced by a filter working correctly
- Existing tests render the exact broken state and stay green: they assert the
  section heading is absent, which is the same condition that removed the
  qualifier
- `grep -rn "<disclaimer text>" client/` returns hits in one component while
  the claims it qualifies are spread across several

## Root Cause

The qualifier was attached to a **badge list**, not to the **claims**. Those are
different things, and they diverged the moment a second and third component
started making claims of their own.

The gate change itself was correct — an empty "Heads up" heading is worse than
no section. What made it a defect is that the disclaimer was a passenger inside
the thing being gated, so a change reasoned about entirely in terms of badges
silently re-gated a compliance string.

Duplication hid it further. With a copy in each section, losing one still left
the other rendering in the common case, so the coupling never announced itself
until the case where *both* sections were empty.

## Solution

Render it once, unconditionally, from the composition root — the only place that
knows every claim surface is present:

```tsx
{/* Unconditional, and owned by the screen rather than by any one of the
    components above ... Anything that can return null is the wrong owner.
    Keep this outside every conditional — its correctness is that it has
    no gate. */}
<ThemedText type="caption" style={[styles.medicalDisclaimer, { color: theme.textSecondary }]}>
  Informational only — not medical advice.
</ThemedText>
```

and delete it from the component that could return `null`. Assert the string
directly in the state that empties each claim surface in turn, plus a
`queryAllByText(...)` length check so it cannot silently go back to one copy
per section.

## Prevention

- A qualifier belongs to the **claim**, not to whichever component happened to
  introduce it. If a component can `return null`, it is the wrong owner.
- Duplicating a compliance string per section is not redundancy, it is a
  **masking** mechanism — it guarantees the coupling stays invisible until every
  copy is gone at once.
- When you change a render gate, ask what else is inside the thing being gated.
  The reasoning that justifies the gate ("an empty heading is worse than none")
  says nothing about the other contents.
- A test that asserts a section is ABSENT is not coverage for what vanished with
  it. Pair every "X is gone" assertion with an explicit "Y is still here".

## Related Files

- `client/screens/NutritionDetailScreen.tsx` — owns the disclaimer, ungated
- `client/components/nutrition/FlagSections.tsx` — no longer owns it; docblock records why
- `client/components/nutrition/FlagSections-utils.ts` — `dropPanelBandedFlags`, the filter that reaches zero
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the emptied-section state, now asserting the string

## See Also

- [value promoted to a new role](value-promoted-to-a-new-role-misses-its-guarding-invariant-2026-08-05.md) — the sibling defect in the same slice: a responsibility moved and its protection did not follow
- [truthiness guard deletion](truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30.md) — removing a condition drops its decision about cases you never considered
- [fixture stops guarding when its defect is fixed](../conventions/fixture-stops-guarding-when-its-defect-is-fixed-2026-08-05.md) — the same shape in test data: green while guarding nothing
